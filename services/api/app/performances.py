"""Shared catalog invariants for REST, ingestion, and MCP."""
from sqlalchemy import select
from sqlalchemy.orm import Session
from .models import Event, Performance, SalePerformance, TicketSale
from .schemas import PerformanceInput, SaleInput
from .serializers import refresh_legacy_event_start
from .schedule import iso_utc


def ensure_initial_performance(db: Session, event: Event, starts_at=None, timezone=None):
    """Legacy event POST or migration: one default session. Never overwrite extra sessions."""
    if not event.performances:
        perf = Performance(event_id=event.id, session_key="default",
                           starts_at=starts_at, timezone=timezone)
        db.add(perf)
        event.performances.append(perf)
    refresh_legacy_event_start(event)


def update_legacy_performance(db: Session, event: Event, starts_at, timezone):
    """Support old clients' singular date only for events with exactly one session."""
    if not event.performances:
        ensure_initial_performance(db, event, starts_at, timezone)
        return
    if len(event.performances) != 1:
        # Legacy date updates must not silently overwrite a multi-show event.
        if starts_at is not None and iso_utc(starts_at) != iso_utc(event.starts_at):
            raise ValueError("Edit individual performances for multi-session events.")
        refresh_legacy_event_start(event)
        return
    p = event.performances[0]
    p.starts_at, p.timezone = starts_at, timezone
    refresh_legacy_event_start(event)


def add_performance(db: Session, event: Event, input: PerformanceInput):
    if input.event_id != event.id:
        raise ValueError("Performance event mismatch")
    existing = db.scalar(select(Performance).where(
        Performance.event_id == event.id, Performance.session_key == input.session_key))
    if existing:
        raise ValueError("Performance session key already exists")
    check_time_collision(db, event, input.starts_at)
    item = Performance(**input.model_dump(exclude={"starts_at_local"}))
    db.add(item)
    db.flush()
    db.refresh(event)
    refresh_legacy_event_start(event)
    return item


def check_time_collision(db: Session, event: Event, instant, exclude_id: str | None = None):
    if instant is None:
        return
    for item in event.performances:
        if item.id != exclude_id and iso_utc(item.starts_at) == iso_utc(instant):
            raise ValueError("A performance with this start time already exists")


def edit_performance(db: Session, item: Performance, input: PerformanceInput):
    if item.event_id != input.event_id:
        raise ValueError("Cannot move a performance to a different event")
    event = item.event
    check_time_collision(db, event, input.starts_at, exclude_id=item.id)
    other = db.scalar(select(Performance).where(
        Performance.event_id == event.id,
        Performance.session_key == input.session_key,
        Performance.id != item.id))
    if other:
        raise ValueError("Performance session key already exists")
    for key, value in input.model_dump(exclude={"starts_at_local", "event_id"}).items():
        setattr(item, key, value)
    db.flush()
    refresh_legacy_event_start(event)
    return item


def assign_sale_performances(db: Session, sale: TicketSale, body: SaleInput):
    """Null/empty selectors mean all sessions. Selected sessions must belong to event."""
    if body.applies_to_all:
        sale.applies_to_all = True
        sale.performance_links.clear()
        return
    valid_ids = set(db.scalars(select(Performance.id).where(
        Performance.event_id == body.event_id, Performance.id.in_(body.performance_ids))).all())
    if set(body.performance_ids) != valid_ids:
        raise ValueError("Selected performances must belong to the ticket sale event")
    sale.applies_to_all = False
    sale.performance_links = [SalePerformance(performance_id=pid) for pid in body.performance_ids]
