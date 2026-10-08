from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


def test_isolated_accounts_and_cloud_favorites(monkeypatch):
    monkeypatch.setenv("TIXBAM_SESSION_SECRET", "development-only-session-secret-over-32-chars")
    monkeypatch.setenv("TIXBAM_AUTH_MODE", "development")
    monkeypatch.setenv("TIXBAM_DEV_AUTH_ENABLED", "false")
    from app.accounts import router
    from app.db import Base, get_db
    from app.models import Artist, Event
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    with Session() as db:
        artist = Artist(name="Account Test Artist")
        db.add(artist)
        db.flush()
        event = Event(artist_id=artist.id, title="Account Test Event")
        db.add(event)
        db.commit()
        artist_id, event_id = artist.id, event.id
    app = FastAPI()
    app.include_router(router)
    def override():
        with Session() as db:
            yield db
    app.dependency_overrides[get_db] = override
    with TestClient(app) as client:
        assert client.get("/v1/auth/methods").json()["developmentLogin"] is False
        assert client.post("/v1/auth/dev", json={}).status_code == 404
        assert client.get("/v1/me").status_code == 401
        assert client.post("/v1/auth/social", json={"provider": "google", "idToken": "any-token-longer-than-20-characters"}).status_code == 503
        monkeypatch.setenv("TIXBAM_DEV_AUTH_ENABLED", "true")
        a = client.post("/v1/auth/dev", json={"account": "fan-one"}).json()
        b = client.post("/v1/auth/dev", json={"account": "fan-two"}).json()
        again = client.post("/v1/auth/dev", json={"account": "fan-one"}).json()
        assert a["user"]["id"] != b["user"]["id"]
        assert again["user"]["id"] == a["user"]["id"]
        ah = {"Authorization": "Bearer " + a["accessToken"]}
        bh = {"Authorization": "Bearer " + b["accessToken"]}
        assert client.put(f"/v1/me/artists/{artist_id}", headers=ah).status_code == 204
        assert client.put(f"/v1/me/artists/{artist_id}", headers=ah).status_code == 204
        assert client.put(f"/v1/me/events/{event_id}", headers=ah).status_code == 204
        assert artist_id in client.get("/v1/me", headers=ah).json()["favoriteArtistIds"]
        assert event_id in client.get("/v1/me", headers=ah).json()["favoriteEventIds"]
        assert client.get("/v1/me", headers=bh).json()["favoriteArtistIds"] == []
        assert client.get("/v1/me", headers=bh).json()["favoriteEventIds"] == []
        assert client.put(f"/v1/me/artists/{artist_id}").status_code == 401
        item_id = str(uuid4())
        item = {"artist": "DAY6", "title": "Concert", "city": "Seoul", "providerId": "cityline",
                "saleAt": "", "url": "https://www.cityline.com.hk/",
                "addedAt": "2026-10-09T00:00:00Z"}
        assert client.put(f"/v1/me/watchlist/{item_id}", headers=ah, json=item).status_code == 200
        assert len(client.get("/v1/me", headers=ah).json()["watchlist"]) == 1
        assert client.get("/v1/me", headers=bh).json()["watchlist"] == []
        assert client.delete(f"/v1/me/watchlist/{item_id}", headers=bh).status_code == 204
        assert len(client.get("/v1/me", headers=ah).json()["watchlist"]) == 1
        assert client.put(f"/v1/me/watchlist/{item_id}", headers=ah,
                          json={**item, "url": "http://unsafe.example"}).status_code == 422
        assert client.delete(f"/v1/me/watchlist/{item_id}", headers=ah).status_code == 204
        assert client.delete(f"/v1/me/artists/{artist_id}", headers=ah).status_code == 204
        assert client.delete(f"/v1/me/events/{event_id}", headers=ah).status_code == 204
        snap = client.get("/v1/me", headers=ah).json()
        assert snap["watchlist"] == []
        assert snap["favoriteArtistIds"] == []
        assert snap["favoriteEventIds"] == []
        assert client.get("/v1/me", headers={"Authorization": "Bearer fake"}).status_code == 401
    engine.dispose()


def test_mock_signin_cannot_run_in_production(monkeypatch):
    from app.accounts import demo_enabled
    monkeypatch.setenv("TIXBAM_AUTH_MODE", "production")
    monkeypatch.setenv("TIXBAM_DEV_AUTH_ENABLED", "true")
    assert demo_enabled() is False
