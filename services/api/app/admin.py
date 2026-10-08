from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session
from .db import get_db
from .models import Artist, Event, Provider, Source, TicketSale, CrawlRun, now
from .schemas import ArtistInput, EventInput, SaleInput, AddonInput, SourceInput, CrawlRunInput
from .security import admin_required
from .serializers import artist_data, event_data, sale_data, provider_data, source_data

router = APIRouter(prefix="/v1/admin", dependencies=[Depends(admin_required)])
Db = Annotated[Session, Depends(get_db)]

@router.post("/artists", status_code=201)
def add_artist(body: ArtistInput, db: Db):
    if db.scalar(select(Artist).where(Artist.name == body.name)):
        raise HTTPException(status_code=409, detail="Artist already exists")
    item = Artist(**body.model_dump())
    db.add(item)
    db.commit()
    return artist_data(item)

@router.post("/events", status_code=201)
def add_event(body: EventInput, db: Db):
    if not db.get(Artist, body.artist_id):
        raise HTTPException(status_code=404, detail="Artist not found")
    if body.source_url and db.scalar(select(Event).where(Event.source_url == body.source_url)):
        raise HTTPException(status_code=409, detail="Source URL already registered")
    item = Event(**body.model_dump())
    db.add(item)
    db.commit()
    return event_data(item)

@router.post("/sales", status_code=201)
def add_sale(body: SaleInput, db: Db):
    if not db.get(Event, body.event_id) or not db.get(Provider, body.provider_id):
        raise HTTPException(status_code=404, detail="Event or provider not found")
    item = TicketSale(**body.model_dump())
    db.add(item)
    db.commit()
    return sale_data(item)

@router.put("/addons/{provider_id}")
def change_addon(provider_id: str, body: AddonInput, db: Db):
    item = db.get(Provider, provider_id)
    if not item:
        raise HTTPException(status_code=404, detail="Provider not found")
    for key, value in body.model_dump().items():
        setattr(item, key, value)
    db.commit()
    return provider_data(item)

@router.get("/sources")
def list_sources(db: Db):
    return {"items": [source_data(s) for s in db.scalars(select(Source).order_by(Source.name))]}

@router.post("/sources", status_code=201)
def add_source(body: SourceInput, db: Db):
    if db.scalar(select(Source).where(Source.url == body.url)):
        raise HTTPException(status_code=409, detail="Source URL already exists")
    item = Source(**body.model_dump())
    db.add(item)
    db.commit()
    return source_data(item)

@router.put("/sources/{source_id}")
def change_source(source_id: str, body: SourceInput, db: Db):
    item = db.get(Source, source_id)
    if not item:
        raise HTTPException(status_code=404, detail="Source not found")
    for key, value in body.model_dump().items():
        setattr(item, key, value)
    db.commit()
    return source_data(item)

@router.get("/crawl-runs")
def list_runs(db: Db, limit: int = Query(30, ge=1, le=500)):
    items = db.scalars(select(CrawlRun).order_by(CrawlRun.started_at.desc()).limit(limit))
    return {"items": [{"id": r.id, "sourceId": r.source_id, "status": r.status,
             "found": r.found, "message": r.message, "startedAt": r.started_at} for r in items]}

@router.post("/crawl-runs", status_code=201)
def record_run(body: CrawlRunInput, db: Db):
    source = db.get(Source, body.source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    item = CrawlRun(**body.model_dump())
    source.last_checked_at = now()
    db.add(item)
    db.commit()
    return {"id": item.id, "status": item.status}
