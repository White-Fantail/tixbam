"""AB-06 shared user/sale/performance coordinator; never authorizes a payment.

The *first* durable server claim is irreversible until independently verified
reconciliation (AB-14). Expired precommit leases can be taken over with an
incremented fencing token; expired claims cannot be taken over. All state changes
are conditional SQL updates to avoid stale-owner writes across API workers.
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from .accounts import CurrentUser, Db
from .models import (PurchaseIntentLease, Performance, SalePerformance,
                     TicketSale, UserBookingPlan, now)

router = APIRouter(prefix="/v1/me/automation/leases", tags=["booking-coordination"])
LEASE_SECONDS = 45
MAX_FENCE = 2**31 - 1


class Acquire(BaseModel):
    model_config = ConfigDict(extra="forbid")
    planId: UUID
    providerId: str = Field(pattern=r"^[a-z0-9_-]{2,60}$")
    saleId: UUID
    performanceId: UUID
    ownerId: UUID  # Random per Desktop process/window, not a device fingerprint.


class LeaseOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    leaseId: UUID
    ownerId: UUID
    fencingToken: int = Field(ge=1, le=MAX_FENCE)
    leaseToken: str = Field(pattern=r"^[0-9a-f]{64}$")


def hashed(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def aware(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def status_view(row: PurchaseIntentLease):
    return {
        "leaseId": row.id, "providerId": row.provider_id,
        "saleId": row.sale_id, "performanceId": row.performance_id,
        "fencingToken": row.fencing_token, "status": row.status,
        "expiresAt": aware(row.expires_at).isoformat(),
        "claimedAt": aware(row.claimed_at).isoformat() if row.claimed_at else None,
        "autonomousCheckoutAvailable": False,
    }


def bound_target(db: Session, user_id: str, body: Acquire):
    plan = db.get(UserBookingPlan, (user_id, str(body.planId)))
    if not plan:
        raise HTTPException(404, "Owned booking plan is required for this lease")
    expected = plan.payload
    if (expected.get("providerId") != body.providerId or
        expected.get("saleId") != str(body.saleId) or
        expected.get("performanceId") != str(body.performanceId)):
        raise HTTPException(409, "Booking plan and sale/performance do not match")
    sale = db.get(TicketSale, str(body.saleId))
    performance = db.get(Performance, str(body.performanceId))
    if (not sale or not performance or sale.provider_id != body.providerId or
        sale.event_id != performance.event_id):
        raise HTTPException(409, "The sale does not belong to this provider/performance")
    if not sale.applies_to_all and db.get(SalePerformance, (sale.id, performance.id)) is None:
        raise HTTPException(409, "This sale does not include the requested performance")


def fetch_owned(db: Session, user_id: str, body: LeaseOperation) -> PurchaseIntentLease:
    row = db.get(PurchaseIntentLease, str(body.leaseId))
    if not row or row.user_id != user_id:
        raise HTTPException(404, "Lease not found")
    return row


def update_owned(db: Session, user_id: str, body: LeaseOperation, values: dict):
    instant = now()
    result = db.execute(
        update(PurchaseIntentLease).where(
            PurchaseIntentLease.id == str(body.leaseId),
            PurchaseIntentLease.user_id == user_id,
            PurchaseIntentLease.owner_hash == hashed(str(body.ownerId)),
            PurchaseIntentLease.token_hash == hashed(body.leaseToken),
            PurchaseIntentLease.fencing_token == body.fencingToken,
            PurchaseIntentLease.status == "leased",
            PurchaseIntentLease.expires_at > instant,
        ).values(**values, updated_at=instant).execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Lease lost, expired, claimed, or fenced; automatic actions are blocked")
    db.commit()
    return db.get(PurchaseIntentLease, str(body.leaseId))


@router.post("/acquire")
def acquire(body: Acquire, user: CurrentUser, db: Db):
    bound_target(db, user.id, body)
    instant = now()
    token = secrets.token_hex(32)
    scope = {
        "user_id": user.id, "provider_id": body.providerId,
        "sale_id": str(body.saleId), "performance_id": str(body.performanceId)
    }
    row = db.scalar(select(PurchaseIntentLease).where(
        PurchaseIntentLease.user_id == user.id,
        PurchaseIntentLease.provider_id == body.providerId,
        PurchaseIntentLease.sale_id == str(body.saleId),
        PurchaseIntentLease.performance_id == str(body.performanceId),
    ))
    if row is None:
        row = PurchaseIntentLease(
            **scope, plan_id=str(body.planId),
            owner_hash=hashed(str(body.ownerId)), token_hash=hashed(token),
            fencing_token=1, status="leased",
            expires_at=instant + timedelta(seconds=LEASE_SECONDS),
        )
        try:
            db.add(row)
            db.commit()
            db.refresh(row)
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Another device acquired this target; refresh before retrying")
    else:
        if row.status == "claimed":
            raise HTTPException(409, "Purchase commit was already claimed; reconcile the order before another attempt")
        if aware(row.expires_at) > instant:
            raise HTTPException(409, "Another window or device owns this booking target")
        if row.fencing_token >= MAX_FENCE:
            raise HTTPException(409, "Lease fencing token exhausted")
        previous = row.fencing_token
        # CAS protects against two simultaneous workers reacquiring at expiry.
        changed = db.execute(
            update(PurchaseIntentLease).where(
                PurchaseIntentLease.id == row.id,
                PurchaseIntentLease.status == "leased",
                PurchaseIntentLease.fencing_token == previous,
                PurchaseIntentLease.expires_at <= instant,
            ).values(
                plan_id=str(body.planId), owner_hash=hashed(str(body.ownerId)),
                token_hash=hashed(token), fencing_token=previous + 1,
                expires_at=instant + timedelta(seconds=LEASE_SECONDS),
                updated_at=instant
            ).execution_options(synchronize_session=False)
        )
        if changed.rowcount != 1:
            db.rollback()
            raise HTTPException(409, "Lease was concurrently taken over")
        db.commit()
        db.refresh(row)
    return {**status_view(row), "leaseToken": token, "leaseSeconds": LEASE_SECONDS}


@router.post("/renew")
def renew(body: LeaseOperation, user: CurrentUser, db: Db):
    row = update_owned(db, user.id, body, {
        "expires_at": now() + timedelta(seconds=LEASE_SECONDS),
    })
    return status_view(row)


@router.post("/release")
def release(body: LeaseOperation, user: CurrentUser, db: Db):
    # A voluntary release never revokes a committed payment claim. Expired
    # precommit lease may be reacquired with an incremented fencing token.
    row = update_owned(db, user.id, body, {
        "expires_at": now(), "token_hash": hashed(secrets.token_hex(32)),
    })
    return status_view(row)


@router.post("/claim")
def claim(body: LeaseOperation, user: CurrentUser, db: Db):
    # Claim is durable server-side *before* the local fsync journal attempt.
    # If a response is lost or the app crashes, the claim remains blocked:
    # it MUST NOT be taken over on timeout. A valid claim is not permission
    # to use any provider automation or payment executor.
    row = update_owned(db, user.id, body, {
        "status": "claimed", "claimed_at": now(),
    })
    return status_view(row)


@router.get("")
def list_leases(user: CurrentUser, db: Db):
    rows = db.scalars(select(PurchaseIntentLease).where(
        PurchaseIntentLease.user_id == user.id).order_by(
        PurchaseIntentLease.updated_at.desc()).limit(100)).all()
    return {"items": [status_view(row) for row in rows],
            "autonomousCheckoutAvailable": False}
