from pathlib import Path
from tempfile import TemporaryDirectory
from zoneinfo import ZoneInfo
import pytest
from sqlalchemy import create_engine, text
from app.migrations import migrate_schedule_columns
from app.schedule import local_to_utc, iso_utc

def test_hong_kong_and_summer_auckland():
    instant = local_to_utc("2027-01-15T20:00", "Asia/Hong_Kong")
    assert iso_utc(instant) == "2027-01-15T12:00:00Z"
    assert instant.astimezone(ZoneInfo("Pacific/Auckland")).strftime("%Y-%m-%dT%H:%M") == "2027-01-16T01:00"

def test_daylight_saving_gaps_and_overlaps():
    with pytest.raises(ValueError, match="does not exist"):
        local_to_utc("2027-03-14T02:30", "America/New_York")
    with pytest.raises(ValueError, match="twice"):
        local_to_utc("2027-11-07T01:30", "America/New_York")
    assert iso_utc(local_to_utc("2027-07-01T19:00", "America/New_York")) == "2027-07-01T23:00:00Z"

def test_unknown_zone():
    with pytest.raises(ValueError, match="valid IANA"):
        local_to_utc("2027-01-15T20:00", "Invalid/Zone")

def test_legacy_migration_idempotent_and_preserves_dates():
    with TemporaryDirectory() as tmp:
        engine = create_engine("sqlite:///" + str(Path(tmp) / "legacy.db"))
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE events (id VARCHAR(36) PRIMARY KEY, starts_at DATETIME)"))
            conn.execute(text("CREATE TABLE ticket_sales (id VARCHAR(36) PRIMARY KEY, sale_at DATETIME)"))
            conn.execute(text("INSERT INTO events VALUES ('e1', '2027-01-15 12:00:00')"))
        migrate_schedule_columns(engine)
        migrate_schedule_columns(engine)
        with engine.connect() as conn:
            row = conn.execute(text("SELECT starts_at, timezone FROM events WHERE id='e1'")).first()
            assert tuple(row) == ("2027-01-15 12:00:00", None)
            names = {row[1] for row in conn.execute(text("PRAGMA table_info(ticket_sales)"))}
            assert {"city", "country", "timezone"} <= names
