from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session
from .db import get_db
from .models import Artist, Event, Performance, Provider
from .serializers import artist_data, event_data, performance_data, provider_data

router = APIRouter()
Db = Annotated[Session, Depends(get_db)]


@router.get("/v1/providers")
@router.get("/v1/addons")
def providers(db: Db):
    return {"items": [provider_data(p) for p in db.scalars(select(Provider).order_by(Provider.name)) if p.published]}


@router.get("/v1/artists")
def artists(db: Db, search: str | None = None):
    query = select(Artist).order_by(Artist.name)
    if search:
        query = query.where(Artist.name.ilike("%" + search[:100] + "%"))
    return {"items": [artist_data(a) for a in db.scalars(query)]}


@router.get("/v1/events")
def events(db: Db, artist_id: str | None = None, limit: int = Query(100, ge=1, le=500)):
    query = select(Event).order_by(Event.starts_at.asc()).limit(limit)
    if artist_id:
        query = query.where(Event.artist_id == artist_id)
    return {"items": [event_data(e) for e in db.scalars(query)]}


@router.get("/v1/events/{event_id}")
def detail(event_id: str, db: Db):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event_data(event)


@router.get("/v1/events/{event_id}/performances")
def event_performances(event_id: str, db: Db):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"items": [performance_data(p) for p in event.performances]}


@router.get("/v1/performances/{performance_id}")
def performance_detail(performance_id: str, db: Db):
    performance = db.get(Performance, performance_id)
    if not performance:
        raise HTTPException(status_code=404, detail="Performance not found")
    return performance_data(performance)
