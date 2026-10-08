from .models import Artist, Event, Provider, Source, TicketSale

def provider_data(p: Provider):
    return {"id": p.id, "name": p.name, "region": p.region, "country": p.country,
            "url": p.url, "allowedHosts": p.allowed_hosts, "automation": p.automation,
            "capabilities": p.capabilities, "version": p.version, "description": p.description,
            "published": p.published, "artifactUrl": p.artifact_url, "artifactSha256": p.artifact_sha256}

def artist_data(a: Artist):
    return {"id": a.id, "name": a.name, "country": a.country, "imageUrl": a.image_url}

def sale_data(s: TicketSale):
    return {"id": s.id, "eventId": s.event_id, "providerId": s.provider_id,
            "saleType": s.sale_type, "saleAt": s.sale_at, "bookingUrl": s.booking_url}

def event_data(e: Event):
    return {"id": e.id, "artistId": e.artist_id, "artist": e.artist.name, "title": e.title,
            "city": e.city, "country": e.country, "venue": e.venue, "startsAt": e.starts_at,
            "sourceUrl": e.source_url, "sales": [sale_data(s) for s in e.sales]}

def source_data(s: Source):
    return {"id": s.id, "name": s.name, "url": s.url, "enabled": s.enabled,
            "intervalMinutes": s.interval_minutes, "lastCheckedAt": s.last_checked_at}
