from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.orm import Session
from .db import get_db
from .models import Artist, Event, Performance, Provider, Source, TicketSale, CrawlRun, PurchaseIntentLease, PurchaseGuard, now
from .performances import ensure_initial_performance, update_legacy_performance, add_performance, edit_performance, assign_sale_performances
from .schemas import ArtistInput, EventInput, PerformanceInput, SaleInput, AddonInput, SourceInput, CrawlRunInput
from .security import admin_required
from .serializers import artist_data, event_data, performance_data, sale_data, provider_data, source_data

router = APIRouter(prefix="/v1/admin", dependencies=[Depends(admin_required)])
Db = Annotated[Session, Depends(get_db)]


@router.post("/artists", status_code=201)
def add_artist(body: ArtistInput, db: Db):
    if db.scalar(select(Artist).where(Artist.name == body.name)):
        raise HTTPException(status_code=409, detail="Artist already exists")
    item = Artist(**body.model_dump())
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Artist name already exists")
    return artist_data(item)


@router.put("/artists/{artist_id}")
def update_artist(artist_id: str, body: ArtistInput, db: Db):
    item = db.get(Artist, artist_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Artist not found")
    duplicate = db.scalar(select(Artist).where(Artist.name == body.name, Artist.id != artist_id))
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="Artist name already exists")
    for key, value in body.model_dump().items():
        setattr(item, key, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Artist name already exists")
    return artist_data(item)


@router.post("/events", status_code=201)
def add_event(body: EventInput, db: Db):
    if not db.get(Artist, body.artist_id):
        raise HTTPException(status_code=404, detail="Artist not found")
    item = Event(**body.model_dump(exclude={"starts_at_local"}))
    db.add(item)
    db.flush()
    ensure_initial_performance(db, item, body.starts_at, body.timezone)
    db.commit()
    return event_data(item)


@router.put("/events/{event_id}")
def update_event(event_id: str, body: EventInput, db: Db):
    item = db.get(Event, event_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if not db.get(Artist, body.artist_id):
        raise HTTPException(status_code=404, detail="Artist not found")
    # starts_at is compatibility shorthand only, not an event-level schedule.
    for key, value in body.model_dump(exclude={"starts_at_local", "starts_at"}).items():
        setattr(item, key, value)
    try:
        if body.starts_at is not None and len(item.performances) > 1:
            # Admin event edits send the first time as a legacy display value;
            # it can be preserved, but individual sessions are edited separately.
            from .schedule import iso_utc
            if iso_utc(body.starts_at) != iso_utc(item.starts_at):
                raise ValueError("Edit the desired performance instead of changing event start.")
        elif len(item.performances) == 1 and body.starts_at is not None:
            update_legacy_performance(db, item, body.starts_at, body.timezone)
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Event update conflicted")
    return event_data(item)


@router.post("/performances", status_code=201)
def create_performance(body: PerformanceInput, db: Db):
    event = db.get(Event, body.event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    try:
        item = add_performance(db, event, body)
        db.commit()
    except (ValueError, IntegrityError) as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return performance_data(item)


@router.put("/performances/{performance_id}")
def update_performance(performance_id: str, body: PerformanceInput, db: Db):
    item = db.get(Performance, performance_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Performance not found")
    try:
        edit_performance(db, item, body)
        db.commit()
    except (ValueError, IntegrityError) as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return performance_data(item)


@router.delete("/performances/{performance_id}")
def delete_performance(performance_id: str, db: Db):
    item = db.get(Performance, performance_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Performance not found")
    if db.scalar(select(PurchaseGuard.id).where(PurchaseGuard.performance_id == item.id)) or db.scalar(
        select(PurchaseIntentLease.id).where(PurchaseIntentLease.performance_id == item.id)):
        raise HTTPException(409, "Performance has purchase safety records; preserve its identity")
    if len(item.event.performances) <= 1:
        raise HTTPException(status_code=409, detail="An event must have at least one performance")
    if item.sale_links:
        raise HTTPException(status_code=409, detail="Remove the sale's performance selection first")
    event = item.event
    db.delete(item)
    db.flush()
    from .serializers import refresh_legacy_event_start
    event.performances.remove(item)
    refresh_legacy_event_start(event)
    db.commit()
    return {"deleted": True}


@router.post("/sales", status_code=201)
def add_sale(body: SaleInput, db: Db):
    if not db.get(Event, body.event_id) or not db.get(Provider, body.provider_id):
        raise HTTPException(status_code=404, detail="Event or provider not found")
    item = TicketSale(**body.model_dump(exclude={"sale_at_local", "performance_ids"}))
    db.add(item)
    try:
        assign_sale_performances(db, item, body)
        db.commit()
    except (ValueError, IntegrityError) as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return sale_data(item)


@router.put("/sales/{sale_id}")
def update_sale(sale_id: str, body: SaleInput, db: Db):
    item = db.get(TicketSale, sale_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Ticket sale not found")
    if not db.get(Event, body.event_id) or not db.get(Provider, body.provider_id):
        raise HTTPException(status_code=404, detail="Event or provider not found")
    # Legacy PUT clients know nothing about scoped sales. Preserve existing
    # session targeting unless the payload explicitly changes the selector.
    if not ({"applies_to_all", "performance_ids"} & body.model_fields_set):
        body = body.model_copy(update={
            "applies_to_all": item.applies_to_all,
            "performance_ids": [link.performance_id for link in item.performance_links],
        })
    for key, value in body.model_dump(exclude={"sale_at_local", "performance_ids"}).items():
        setattr(item, key, value)
    try:
        assign_sale_performances(db, item, body)
        db.commit()
    except (ValueError, IntegrityError) as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
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
