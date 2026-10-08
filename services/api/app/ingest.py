from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from .db import get_db
from .models import Artist, Event, Source
from .schemas import IngestInput
from .security import admin_required

router = APIRouter(prefix="/v1/admin", dependencies=[Depends(admin_required)])
Db = Annotated[Session, Depends(get_db)]

@router.post("/ingest")
def ingest(body: IngestInput, db: Db):
    if not db.get(Source, body.source_id):
        raise HTTPException(status_code=404, detail="Source not found")
    created, updated = 0, 0
    for item in body.events:
        artist = db.scalar(select(Artist).where(Artist.name.ilike(item.artist)))
        if artist is None:
            artist = Artist(name=item.artist)
            db.add(artist)
            db.flush()
        event = db.scalar(select(Event).where(Event.source_url == item.source_url))
        if event is None:
            event = Event(artist_id=artist.id, source_url=item.source_url)
            db.add(event)
            created += 1
        else:
            updated += 1
        event.title = item.title
        event.city = item.city
        event.country = item.country
        event.venue = item.venue
        event.starts_at = item.starts_at
    db.commit()
    return {"created": created, "updated": updated}
