"""Repeatable schema and data upgrade for event performances and scoped sales.

Creates tables via Base.metadata.create_all first. Backfills legacy events as one
performance with a stable session_key, preserves UTC instants, and defaults
preexisting sales to all performances. No historical time is fabricated.
"""
from sqlalchemy import inspect, text
from .models import uuid

COLUMNS = {
    "events": {"timezone": "VARCHAR(100)"},
    "ai_model_policies": {"structured_output_verified": "BOOLEAN NOT NULL DEFAULT FALSE"},
    "ticket_sales": {
        "city": "VARCHAR(160)",
        "country": "VARCHAR(8)",
        "timezone": "VARCHAR(100)",
        "applies_to_all": "BOOLEAN NOT NULL DEFAULT TRUE",
    },
}


def migrate_schedule_columns(engine):
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as connection:
        for table, columns in COLUMNS.items():
            if table not in tables:
                continue
            known = {column["name"] for column in inspector.get_columns(table)}
            for name, sql_type in columns.items():
                if name not in known:
                    clause = "IF NOT EXISTS " if engine.dialect.name == "postgresql" else ""
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {clause}{name} {sql_type}"))
        if engine.dialect.name == "postgresql" and "events" in tables:
            # Existing prod events.source_url was UNIQUE. One tour announcement
            # may legitimately identify multiple cities/performances.
            unique_constraints = inspect(connection).get_unique_constraints("events")
            for constraint in unique_constraints:
                if constraint.get("column_names") == ["source_url"]:
                    name = constraint["name"].replace('"', '""')
                    connection.execute(text(f'ALTER TABLE events DROP CONSTRAINT IF EXISTS "{name}"'))
            indexes = inspect(connection).get_indexes("events")
            for index in indexes:
                if index.get("unique") and index.get("column_names") == ["source_url"]:
                    name = index["name"].replace('"', '""')
                    connection.execute(text(f'DROP INDEX IF EXISTS "{name}"'))
        if {"events", "performances"} <= tables:
            existing = connection.execute(text("SELECT id, starts_at, timezone FROM events")).all()
            for event_id, instant, zone in existing:
                if connection.execute(text(
                    "SELECT 1 FROM performances WHERE event_id=:event_id LIMIT 1"
                ), {"event_id": event_id}).first():
                    continue
                connection.execute(text(
                    "INSERT INTO performances "
                    "(id, event_id, session_key, label, starts_at, timezone, status, created_at) "
                    "VALUES (:id, :event_id, 'default', '', :instant, :zone, 'scheduled', CURRENT_TIMESTAMP)"
                ), {"id": uuid(), "event_id": event_id, "instant": instant, "zone": zone})


def migrate_purchase_guards(engine):
    """Idempotent additive backfill. Preserve all old lease rows and fences.

    Live checkout remains OFF throughout rollout. Old API workers must be
    drained before deploying a future live executor; old claim routes cannot
    enforce a table they do not know. Request-time legacy checks remain enabled.
    """
    from sqlalchemy import select, update
    from sqlalchemy.orm import Session
    from sqlalchemy.exc import IntegrityError
    from .models import PurchaseIntentLease, PurchaseGuard
    with Session(engine) as db:
        rows = db.scalars(select(PurchaseIntentLease).where(
            PurchaseIntentLease.status == "claimed")).all()
        scopes = {}
        for row in rows:
            scopes.setdefault((row.user_id, row.performance_id), []).append(row)
        for (user_id, performance_id), group in scopes.items():
            existing = db.scalar(select(PurchaseGuard).where(
                PurchaseGuard.user_id == user_id,
                PurchaseGuard.performance_id == performance_id))
            if existing:
                if len(group) > 1 and existing.status != "review_required":
                    db.execute(update(PurchaseGuard).where(PurchaseGuard.id == existing.id)
                        .values(status="review_required"))
                    db.commit()
                continue
            first = sorted(group, key=lambda r: r.id)[0]
            db.add(PurchaseGuard(user_id=user_id, performance_id=performance_id,
                lease_id=first.id, fencing_token=first.fencing_token,
                status="review_required" if len(group) > 1 else "claimed"))
            try:
                db.commit()
            except IntegrityError:
                # Another startup worker won the same unique scope. Retryable
                # startup is safe; request-time checks still deny legacy claims.
                db.rollback()
                existing = db.scalar(select(PurchaseGuard).where(
                    PurchaseGuard.user_id == user_id,
                    PurchaseGuard.performance_id == performance_id))
                if existing is None:
                    raise
                if len(group) > 1:
                    existing.status = "review_required"
                    db.commit()
