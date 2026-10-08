"""Repeatable structured-event ingestion grouping performances by concert."""
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from .db import get_db
from .models import Artist, Event, Performance, Source
from .schemas import IngestInput
from .schedule import as_utc, iso_utc
from .serializers import refresh_legacy_event_start
from .security import admin_required

router = APIRouter(prefix="/v1/admin", dependencies=[Depends(admin_required)])
Db = Annotated[Session, Depends(get_db)]


@router.post("/ingest")
def ingest(body: IngestInput, db: Db):
    if not db.get(Source, body.source_id):
        raise HTTPException(status_code=404, detail="Source not found")
    created, updated, performances_created, performances_updated = 0, 0, 0, 0
    try:
        for item in body.events:
            artist = db.scalar(select(Artist).where(Artist.name.ilike(item.artist)))
            if artist is None:
                artist = Artist(name=item.artist)
                db.add(artist)
                db.flush()
            # Group by artist, title and venue/city. Source URLs are NOT IDs:
            # the same announcement often describes many sessions or cities.
            candidate = db.scalars(select(Event).where(
                Event.artist_id == artist.id, Event.title == item.title,
                Event.city == item.city, Event.country == item.country,
                Event.venue == item.venue
            )).first()
            if candidate is None:
                candidate = Event(artist_id=artist.id, title=item.title,
                                  city=item.city, country=item.country,
                                  venue=item.venue, source_url=item.source_url)
                db.add(candidate)
                db.flush()
                created += 1
            else:
                updated += 1
                # Preserve manually verified original source for audit purposes.
                if not candidate.source_url:
                    candidate.source_url = item.source_url
            instant = as_utc(item.starts_at) if item.starts_at is not None else None
            key = item.session_key or ("start:" + iso_utc(instant) if instant else "default")
            performance = db.scalar(select(Performance).where(
                Performance.event_id == candidate.id,
                Performance.session_key == key
            ))
            if performance is None:
                # If the legacy record's only session is TBA, enrich it
                # instead of duplicating it when a time is discovered.
                if len(candidate.performances) == 1 and candidate.performances[0].session_key == "default" and candidate.performances[0].starts_at is None:
                    performance = candidate.performances[0]
                    performance.session_key = key
                    performances_updated += 1
                else:
                    performance = Performance(event_id=candidate.id, session_key=key)
                    candidate.performances.append(performance)
                    db.add(performance)
                    performances_created += 1
            else:
                performances_updated += 1
            if instant is not None:
                performance.starts_at = instant
            if not performance.timezone and candidate.timezone:
                performance.timezone = candidate.timezone
            refresh_legacy_event_start(candidate)
        db.commit()
    except (ValueError, TypeError) as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"created": created, "updated": updated,
            "performancesCreated": performances_created,
            "performancesUpdated": performances_updated}
