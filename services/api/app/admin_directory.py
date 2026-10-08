"""Admin-only directory reads and full provider registry CRUD."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import Annotated
from .db import get_db
from .models import Artist, Event, Performance, TicketSale, Provider, Source, CrawlRun
from .schemas import ProviderInput
from .security import admin_required
from .serializers import artist_data, event_data, performance_data, sale_data, provider_data, source_data

router = APIRouter(prefix="/v1/admin/directory", dependencies=[Depends(admin_required)])
Db = Annotated[Session, Depends(get_db)]


def page(db, statement, serializer, limit, offset):
    count = db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0
    return {"items": [serializer(item) for item in db.scalars(statement.limit(limit).offset(offset))],
            "total": count, "limit": limit, "offset": offset}


def require(db, model, identifier, serializer):
    record = db.get(model, identifier)
    if record is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return serializer(record)


@router.get("/artists")
def artists(db: Db, q: str = "", limit: int = Query(25, ge=1, le=100),
            offset: int = Query(0, ge=0)):
    stmt = select(Artist).order_by(Artist.name)
    if q:
        stmt = stmt.where(Artist.name.ilike(f"%{q[:100]}%"))
    return page(db, stmt, artist_data, limit, offset)


@router.get("/artists/{item_id}")
def artist(item_id: str, db: Db):
    return require(db, Artist, item_id, artist_data)


@router.get("/events")
def events(db: Db, q: str = "", limit: int = Query(25, ge=1, le=100),
           offset: int = Query(0, ge=0)):
    stmt = select(Event).join(Artist).order_by(Event.starts_at.asc().nulls_last(), Event.id)
    if q:
        like = f"%{q[:100]}%"
        stmt = stmt.where(or_(Event.title.ilike(like), Artist.name.ilike(like),
                              Event.city.ilike(like), Event.venue.ilike(like)))
    return page(db, stmt, event_data, limit, offset)


@router.get("/events/{item_id}")
def event(item_id: str, db: Db):
    return require(db, Event, item_id, event_data)


@router.get("/performances")
def performances(db: Db, q: str = "", limit: int = Query(25, ge=1, le=100),
                 offset: int = Query(0, ge=0)):
    stmt = select(Performance).join(Event).join(Artist).order_by(
        Performance.starts_at.asc().nulls_last(), Performance.id)
    if q:
        like = f"%{q[:100]}%"
        stmt = stmt.where(or_(Event.title.ilike(like), Artist.name.ilike(like),
                              Performance.label.ilike(like), Performance.session_key.ilike(like)))
    return page(db, stmt, performance_data, limit, offset)


@router.get("/performances/{item_id}")
def performance(item_id: str, db: Db):
    return require(db, Performance, item_id, performance_data)


@router.get("/sales")
def sales(db: Db, q: str = "", limit: int = Query(25, ge=1, le=100),
          offset: int = Query(0, ge=0)):
    stmt = select(TicketSale).join(Event).join(Artist).join(Provider).order_by(
        TicketSale.sale_at.asc().nulls_last(), TicketSale.id)
    if q:
        like = f"%{q[:100]}%"
        stmt = stmt.where(or_(Event.title.ilike(like), Artist.name.ilike(like),
                              Provider.name.ilike(like), TicketSale.sale_type.ilike(like)))
    return page(db, stmt, sale_data, limit, offset)


@router.get("/sales/{item_id}")
def sale(item_id: str, db: Db):
    return require(db, TicketSale, item_id, sale_data)


@router.get("/providers")
def providers(db: Db, q: str = "", limit: int = Query(25, ge=1, le=100),
              offset: int = Query(0, ge=0)):
    stmt = select(Provider).order_by(Provider.name)
    if q:
        stmt = stmt.where(Provider.name.ilike(f"%{q[:100]}%"))
    return page(db, stmt, provider_data, limit, offset)


@router.get("/providers/{item_id}")
def provider(item_id: str, db: Db):
    return require(db, Provider, item_id, provider_data)


@router.post("/providers", status_code=201)
def create_provider(body: ProviderInput, db: Db):
    if db.get(Provider, body.id):
        raise HTTPException(status_code=409, detail="Provider ID already registered")
    item = Provider(**body.model_dump())
    db.add(item)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Provider already registered") from error
    return provider_data(item)


@router.put("/providers/{item_id}")
def update_provider(item_id: str, body: ProviderInput, db: Db):
    item = db.get(Provider, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    if body.id != item_id:
        raise HTTPException(status_code=422, detail="Provider ID cannot be changed")
    for key, value in body.model_dump(exclude={"id"}).items():
        setattr(item, key, value)
    db.commit()
    return provider_data(item)


@router.get("/addons")
def addons(db: Db, q: str = "", limit: int = Query(25, ge=1, le=100),
           offset: int = Query(0, ge=0)):
    # Unpublished providers are deliberately visible in the protected admin UI.
    return providers(db, q, limit, offset)


@router.get("/addons/{item_id}")
def addon(item_id: str, db: Db):
    return provider(item_id, db)


@router.get("/sources")
def sources(db: Db, q: str = "", limit: int = Query(25, ge=1, le=100),
            offset: int = Query(0, ge=0)):
    stmt = select(Source).order_by(Source.name)
    if q:
        stmt = stmt.where(Source.name.ilike(f"%{q[:100]}%"))
    return page(db, stmt, source_data, limit, offset)


@router.get("/sources/{item_id}")
def source(item_id: str, db: Db):
    return require(db, Source, item_id, source_data)


@router.get("/crawl-runs")
def runs(db: Db, q: str = "", limit: int = Query(25, ge=1, le=100),
         offset: int = Query(0, ge=0)):
    stmt = select(CrawlRun).order_by(CrawlRun.started_at.desc())
    if q:
        stmt = stmt.where(or_(CrawlRun.status.ilike(f"%{q[:100]}%"),
                              CrawlRun.message.ilike(f"%{q[:100]}%")))
    return page(db, stmt, lambda r: {
        "id": r.id, "sourceId": r.source_id, "status": r.status,
        "found": r.found, "message": r.message, "startedAt": r.started_at,
    }, limit, offset)


@router.get("/crawl-runs/{item_id}")
def run(item_id: str, db: Db):
    return require(db, CrawlRun, item_id, lambda r: {
        "id": r.id, "sourceId": r.source_id, "status": r.status,
        "found": r.found, "message": r.message, "startedAt": r.started_at,
    })
