"""Protected directory listing and provider mutation smoke tests."""
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.models import Artist, Event, Performance, TicketSale, Source
from app.admin_directory import router as directory_router
from app.routes import router as public_router


def test_directory_and_provider_management(monkeypatch):
    monkeypatch.setenv("TIXBAM_ADMIN_API_KEY", "test-admin-key")
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    with Session() as db:
        artist = Artist(name="DAY6", country="KR")
        db.add(artist)
        db.flush()
        event = Event(artist_id=artist.id, title="Hong Kong", city="Hong Kong", country="HK")
        db.add(event)
        db.flush()
        show = Performance(event_id=event.id, session_key="first")
        db.add(show)
        db.add(Source(name="Approved", url="https://example.org/feed"))
        db.commit()
        artist_id, event_id, show_id = artist.id, event.id, show.id

    app = FastAPI()
    app.include_router(directory_router)
    app.include_router(public_router)
    def override():
        with Session() as db:
            yield db
    app.dependency_overrides[get_db] = override

    with TestClient(app) as client:
        root = "/v1/admin/directory"
        assert client.get(root + "/artists").status_code == 401
        headers = {"X-Admin-Key": "test-admin-key"}
        listing = client.get(root + "/artists?limit=1", headers=headers)
        assert listing.status_code == 200
        assert listing.json()["total"] == 1
        assert listing.json()["items"][0]["name"] == "DAY6"
        assert client.get(root + "/artists/" + artist_id, headers=headers).status_code == 200
        assert client.get(root + "/events/" + event_id, headers=headers).status_code == 200
        performance = client.get(root + "/performances/" + show_id, headers=headers)
        assert performance.json()["eventTitle"] == "Hong Kong"
        assert client.get(root + "/artists/missing", headers=headers).status_code == 404
        assert client.get(root + "/sources?limit=25", headers=headers).json()["total"] == 1
        assert client.get(root + "/crawl-runs", headers=headers).json()["total"] == 0
        bad = client.post(root + "/providers", headers=headers, json={
            "id": "unsafe", "name": "Unsafe", "url": "http://example.org",
        })
        assert bad.status_code == 422
        provider = {"id": "new-provider", "name": "New Provider", "url": "https://tickets.example.org",
                    "country": "NZ", "allowed_hosts": ["tickets.example.org"],
                    "capabilities": ["browser"], "published": False}
        created = client.post(root + "/providers", headers=headers, json=provider)
        assert created.status_code == 201, created.text
        assert created.json()["id"] == provider["id"]
        assert client.post(root + "/providers", headers=headers, json=provider).status_code == 409
        assert client.get(root + "/providers?limit=1", headers=headers).json()["total"] == 1
        assert client.get(root + "/addons", headers=headers).json()["total"] == 1
        assert client.get("/v1/providers").json()["items"] == []
        provider["name"] = "Updated Provider"
        provider["published"] = True
        modified = client.put(root + "/providers/new-provider", headers=headers, json=provider)
        assert modified.status_code == 200, modified.text
        assert modified.json()["name"] == "Updated Provider"
        assert client.get("/v1/providers").json()["items"][0]["id"] == "new-provider"
        provider["id"] = "changed-id"
        assert client.put(root + "/providers/new-provider", headers=headers, json=provider).status_code == 422
    engine.dispose()
