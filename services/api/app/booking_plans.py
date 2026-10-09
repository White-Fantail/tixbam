"""User booking goals, readiness and saved targets. Never accept card secrets or sessions."""
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .accounts import CurrentUser, Db
from .models import (
    Artist, Event, Performance, TicketSale, UserBookingPlan,
    UserSavedTarget, UserWatchItem,
)

router = APIRouter(prefix="/v1/me")


class PlanPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    artist: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=250)
    city: str = Field(default="", max_length=160)
    providerId: str = Field(min_length=1, max_length=60)
    bookingUrl: str = Field(default="", max_length=2048)
    eventId: str | None = Field(default=None, max_length=36)
    performanceId: str | None = Field(default=None, max_length=36)
    saleId: str | None = Field(default=None, max_length=36)
    saleAt: str = Field(default="", max_length=40)
    performanceAt: str = Field(default="", max_length=40)
    timezone: str = Field(default="", max_length=100)
    quantity: int = Field(default=2, ge=1, le=20)
    budgetMinor: int = Field(default=0, ge=0, le=10000000000)
    currency: str = Field(default="HKD", pattern=r"^[A-Z]{3}$")
    requireTogether: bool = True
    allowFallback: bool = True
    preferencesReady: bool = False
    accountReady: bool = False
    paymentReady: bool = False
    lastRehearsalAt: str | None = Field(default=None, max_length=40)
    notes: str = Field(default="", max_length=1000)

    @field_validator("bookingUrl")
    @classmethod
    def secure_url(cls, value: str) -> str:
        if value:
            url = urlsplit(value)
            if url.scheme != "https" or not url.hostname or url.username or url.password:
                raise ValueError("Only official HTTPS booking links are permitted")
        return value

    @field_validator("eventId", "performanceId", "saleId")
    @classmethod
    def valid_optional_id(cls, value: str | None) -> str | None:
        if value is not None:
            try:
                return str(UUID(value))
            except ValueError as exc:
                raise ValueError("Invalid catalog identifier") from exc
        return value


def as_plan(row: UserBookingPlan):
    return {**row.payload, "id": row.id,
            "createdAt": row.created_at.isoformat(), "updatedAt": row.updated_at.isoformat()}


def account_extras(db: Session, user_id: str):
    plans = db.scalars(select(UserBookingPlan).where(UserBookingPlan.user_id == user_id)).all()
    saved = db.scalars(select(UserSavedTarget).where(UserSavedTarget.user_id == user_id)).all()
    return {"bookingPlans": [as_plan(plan) for plan in plans],
            "favoritePerformanceIds": [item.target_id for item in saved if item.kind == "performance"],
            "favoriteSaleIds": [item.target_id for item in saved if item.kind == "sale"]}


@router.put("/plans/{plan_id}")
def upsert_plan(plan_id: UUID, body: PlanPayload, user: CurrentUser, db: Db):
    key = str(plan_id)
    row = db.get(UserBookingPlan, (user.id, key))
    if row is None:
        row = UserBookingPlan(user_id=user.id, id=key, payload=body.model_dump())
        db.add(row)
    else:
        row.payload = body.model_dump()
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return as_plan(row)


@router.delete("/plans/{plan_id}", status_code=204)
def delete_plan(plan_id: UUID, user: CurrentUser, db: Db):
    row = db.get(UserBookingPlan, (user.id, str(plan_id)))
    if row:
        db.delete(row)
        db.commit()
    return Response(status_code=204)


TARGET_MODELS = {"performance": Performance, "sale": TicketSale}


@router.put("/saved/{kind}/{target_id}", status_code=204)
def save_target(kind: Literal["performance", "sale"], target_id: UUID, user: CurrentUser, db: Db):
    key = str(target_id)
    if db.get(TARGET_MODELS[kind], key) is None:
        raise HTTPException(status_code=404, detail="Catalog target not found")
    if db.get(UserSavedTarget, (user.id, kind, key)) is None:
        db.add(UserSavedTarget(user_id=user.id, kind=kind, target_id=key))
        db.commit()
    return Response(status_code=204)


@router.delete("/saved/{kind}/{target_id}", status_code=204)
def unsave_target(kind: Literal["performance", "sale"], target_id: UUID, user: CurrentUser, db: Db):
    row = db.get(UserSavedTarget, (user.id, kind, str(target_id)))
    if row:
        db.delete(row)
        db.commit()
    return Response(status_code=204)


def migrate_watch_items_to_plans(db: Session):
    """Idempotent backfill; preserve the original watchlist for older clients."""
    watches = db.scalars(select(UserWatchItem)).all()
    changed = False
    for watch in watches:
        if db.get(UserBookingPlan, (watch.user_id, watch.id)) is not None:
            continue
        item = watch.payload
        try:
            payload = PlanPayload(
                artist=item["artist"], title=item["title"], city=item.get("city", ""),
                providerId=item["providerId"], bookingUrl=item.get("url", ""),
                eventId=item.get("eventId"), performanceId=item.get("performanceId"),
                saleAt=item.get("saleAt", ""), performanceAt=item.get("performanceAt", ""),
            ).model_dump()
        except (ValueError, KeyError, TypeError):
            continue
        db.add(UserBookingPlan(user_id=watch.user_id, id=watch.id, payload=payload))
        changed = True
    if changed:
        db.commit()
