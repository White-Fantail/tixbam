"""Migration regression: old event/sale rows survive the session-model transition."""
from datetime import datetime, timezone
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.db import Base
from app.migrations import migrate_schedule_columns
from app.models import Artist, Event, Performance, Provider, TicketSale
from app.schedule import iso_utc


def test_backfill_is_idempotent_and_preserves_sale_scope_and_instant():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        artist = Artist(name="Legacy artist")
        provider = Provider(id="legacy", name="Legacy provider", url="https://example.org")
        db.add_all([artist, provider])
        db.flush()
        event = Event(artist_id=artist.id, title="Legacy show", city="Hong Kong",
                      timezone="Asia/Hong_Kong",
                      starts_at=datetime(2027, 1, 15, 12, 0, tzinfo=timezone.utc))
        db.add(event)
        db.flush()
        event_id = event.id
        db.add(TicketSale(event_id=event_id, provider_id=provider.id,
                          booking_url="https://example.org/sale"))
        db.commit()
    migrate_schedule_columns(engine)
    migrate_schedule_columns(engine)
    with Session(engine) as db:
        sessions = db.scalars(select(Performance).where(Performance.event_id == event_id)).all()
        assert len(sessions) == 1
        assert sessions[0].session_key == "default"
        assert iso_utc(sessions[0].starts_at) == "2027-01-15T12:00:00Z"
        assert sessions[0].timezone == "Asia/Hong_Kong"
        sale = db.scalars(select(TicketSale)).one()
        assert sale.applies_to_all
        assert not sale.performance_links
    engine.dispose()
