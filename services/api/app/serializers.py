from .models import Artist, Event, Performance, Provider, Source, TicketSale
from .schedule import iso_utc

def provider_data(p: Provider):
    return {"id": p.id, "name": p.name, "kind": "event-presale" if "event-presale" in p.capabilities else "ticketing", "region": p.region, "country": p.country,
            "url": p.url, "allowedHosts": p.allowed_hosts, "automation": p.automation,
            "capabilities": p.capabilities, "version": p.version, "description": p.description,
            "published": p.published, "artifactUrl": p.artifact_url, "artifactSha256": p.artifact_sha256}

def artist_data(a: Artist):
    return {"id": a.id, "name": a.name, "country": a.country, "imageUrl": a.image_url}

def performance_data(p: Performance):
    return {"id": p.id, "eventId": p.event_id, "sessionKey": p.session_key,
            "label": p.label, "startsAt": iso_utc(p.starts_at),
            "timezone": p.timezone, "status": p.status}


def sorted_performances(event: Event):
    return sorted(event.performances, key=lambda p: (p.starts_at is None, iso_utc(p.starts_at) or "", p.session_key))


def event_start(event: Event):
    known = [p.starts_at for p in event.performances if p.starts_at is not None]
    # SQLite loads timestamps as naive UTC, while newly supplied timestamps are aware.
    # ISO conversion normalizes both before comparing without changing the instant.
    return min(known, key=iso_utc) if known else None


def refresh_legacy_event_start(event: Event):
    event.starts_at = event_start(event)
    # Keep legacy zone for older clients. Per-session zones stay authoritative.
    if event.performances and not event.timezone:
        event.timezone = event.performances[0].timezone


def sale_data(s: TicketSale):
    return {"id": s.id, "eventId": s.event_id, "providerId": s.provider_id,
            "saleType": s.sale_type, "saleAt": iso_utc(s.sale_at), "bookingUrl": s.booking_url,
            "city": s.city, "country": s.country, "timezone": s.timezone,
            "appliesToAll": s.applies_to_all,
            "performanceIds": [link.performance_id for link in s.performance_links]}

def event_data(e: Event):
    return {"id": e.id, "artistId": e.artist_id, "artist": e.artist.name, "title": e.title,
            "city": e.city, "country": e.country, "venue": e.venue, "startsAt": iso_utc(e.starts_at), "timezone": e.timezone,
            "sourceUrl": e.source_url,
            "performances": [performance_data(p) for p in sorted_performances(e)],
            "sales": [sale_data(s) for s in e.sales]}

def source_data(s: Source):
    return {"id": s.id, "name": s.name, "url": s.url, "enabled": s.enabled,
            "intervalMinutes": s.interval_minutes, "lastCheckedAt": s.last_checked_at}
