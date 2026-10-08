"""Convert explicit IANA local wall times to unambiguous UTC instants."""
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

WALL_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$")

def validate_timezone(value: str | None):
    if not value:
        return None
    try:
        return ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError, KeyError) as exc:
        raise ValueError("Select a valid IANA time zone (e.g. Asia/Hong_Kong).") from exc

def as_utc(value: datetime | None):
    if value is None:
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Timestamps must include a UTC offset.")
    return value.astimezone(timezone.utc)

def local_to_utc(value: str, zone_name: str | None):
    zone = validate_timezone(zone_name)
    if zone is None:
        raise ValueError("Select the event or sale location's time zone.")
    if not WALL_TIME.fullmatch(value):
        raise ValueError("Enter local date/time as YYYY-MM-DDTHH:MM.")
    try:
        local = datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("Invalid local date or time.") from exc
    matches = set()
    for fold in (0, 1):
        candidate = local.replace(tzinfo=zone, fold=fold)
        instant = candidate.astimezone(timezone.utc)
        if instant.astimezone(zone).replace(tzinfo=None) == local:
            matches.add(instant)
    if not matches:
        raise ValueError("This local time does not exist due to a daylight-saving clock change.")
    if len(matches) > 1:
        raise ValueError("This local time occurs twice due to a daylight-saving clock change. Choose a time outside the transition.")
    return matches.pop()

def iso_utc(value: datetime | None):
    if value is None:
        return None
    # SQLite drops tzinfo on round trip; values are stored in UTC by the API.
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
