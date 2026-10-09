from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


def setup_api(monkeypatch):
    monkeypatch.setenv("TIXBAM_SESSION_SECRET", "safe-development-only-secret-for-tests-12345")
    from app.accounts import create_session, router as accounts
    from app.booking_plans import router as plans
    from app.db import Base, get_db
    from app.models import Artist, Event, Performance, Provider, TicketSale, User

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    app = FastAPI()
    app.include_router(accounts)
    app.include_router(plans)

    def db_override():
        with Session() as db:
            yield db

    app.dependency_overrides[get_db] = db_override
    with Session() as db:
        users = [User(display_name="Fan A"), User(display_name="Fan B")]
        db.add_all(users)
        artist = Artist(name="Ticketing Artist")
        db.add(artist)
        db.flush()
        event = Event(artist_id=artist.id, title="Test Hong Kong Concert")
        db.add(event)
        db.flush()
        performance = Performance(event_id=event.id, session_key="one")
        db.add(performance)
        provider = Provider(id="cityline", name="Cityline", url="https://www.cityline.com.hk/")
        db.add(provider)
        db.flush()
        sale = TicketSale(event_id=event.id, provider_id=provider.id,
                          booking_url="https://www.cityline.com.hk/")
        db.add(sale)
        db.commit()
        ids = (performance.id, sale.id)
        headers = [{"Authorization": "Bearer " + create_session(u)["accessToken"]} for u in users]
    return TestClient(app), Session, engine, ids, headers


def test_booking_plan_cloud_isolation_and_unsupported_secrets(monkeypatch):
    client, Session, engine, (performance_id, sale_id), (a, b) = setup_api(monkeypatch)
    payload = {
        "artist": "Ticketing Artist", "title": "Test Hong Kong Concert",
        "city": "Hong Kong", "providerId": "cityline",
        "bookingUrl": "https://www.cityline.com.hk/",
        "quantity": 2, "budgetMinor": 250000, "currency": "HKD",
        "requireTogether": True, "allowFallback": False,
        "accountReady": True, "paymentReady": False, "preferencesReady": True
    }
    plan_id = str(uuid4())
    with client:
        assert client.get("/v1/me", headers=a).json()["bookingPlans"] == []
        assert client.put(f"/v1/me/plans/{plan_id}", headers=a, json=payload).status_code == 200
        assert client.put(f"/v1/me/plans/{plan_id}", headers=a, json=payload).status_code == 200
        assert client.get("/v1/me", headers=b).json()["bookingPlans"] == []
        mine = client.get("/v1/me", headers=a).json()["bookingPlans"]
        assert len(mine) == 1 and mine[0]["budgetMinor"] == 250000
        assert client.delete(f"/v1/me/plans/{plan_id}", headers=b).status_code == 204
        assert len(client.get("/v1/me", headers=a).json()["bookingPlans"]) == 1
        assert client.put(f"/v1/me/plans/{uuid4()}", headers=a,
                          json={**payload, "cardNumber": "4111111111111111"}).status_code == 422
        assert client.put(f"/v1/me/plans/{uuid4()}", headers=a,
                          json={**payload, "bookingUrl": "http://invalid.example/"}).status_code == 422
        assert client.put(f"/v1/me/saved/performance/{performance_id}", headers=a).status_code == 204
        assert client.put(f"/v1/me/saved/sale/{sale_id}", headers=a).status_code == 204
        assert client.get("/v1/me", headers=a).json()["favoritePerformanceIds"] == [performance_id]
        assert client.get("/v1/me", headers=a).json()["favoriteSaleIds"] == [sale_id]
        assert client.get("/v1/me", headers=b).json()["favoriteSaleIds"] == []
        assert client.put(f"/v1/me/saved/sale/{uuid4()}", headers=a).status_code == 404
        assert client.delete(f"/v1/me/saved/sale/{sale_id}", headers=b).status_code == 204
        assert client.get("/v1/me", headers=a).json()["favoriteSaleIds"] == [sale_id]
        assert client.delete(f"/v1/me/plans/{plan_id}", headers=a).status_code == 204
        assert client.get("/v1/me", headers=a).json()["bookingPlans"] == []
    engine.dispose()


def test_legacy_watchlist_backfill_is_repeatable(monkeypatch):
    client, Session, engine, _, (a, _) = setup_api(monkeypatch)
    from app.booking_plans import migrate_watch_items_to_plans
    from app.models import UserWatchItem, UserBookingPlan
    watch_id = str(uuid4())
    with client:
        watch = {
            "artist": "Legacy", "title": "Old Concert", "providerId": "cityline",
            "city": "Hong Kong", "url": "https://www.cityline.com.hk/",
            "saleAt": "2026-12-12T10:00:00Z", "addedAt": "2026-10-01T00:00:00Z"
        }
        assert client.put(f"/v1/me/watchlist/{watch_id}", headers=a, json=watch).status_code == 200
        with Session() as db:
            migrate_watch_items_to_plans(db)
            migrate_watch_items_to_plans(db)
            matches = db.scalars(select(UserBookingPlan).where(UserBookingPlan.id == watch_id)).all()
            assert len(matches) == 1
            assert matches[0].payload["title"] == "Old Concert"
            assert matches[0].payload["currency"] == "HKD"
        assert len(client.get("/v1/me", headers=a).json()["bookingPlans"]) == 1
        assert len(client.get("/v1/me", headers=a).json()["watchlist"]) == 1
    engine.dispose()
