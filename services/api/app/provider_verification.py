"""AB-12 vendor technical evidence / fixture certification. NOT live authorization.

A successful offline fixture test is not a provider licence, a live seat-map
verification, a payment gateway approval, or host release permission.
"""
from datetime import datetime, timezone
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import get_db
from .models import Provider, ProviderAutomationAudit, ProviderCapabilityVerification, now
from .security import admin_required
from .automation_policies import CAPABILITIES, PROTECTED

Db = Annotated[Session, Depends(get_db)]
router = APIRouter(prefix="/v1/admin/automation", dependencies=[Depends(admin_required)])

# These identify the only fixture suites executed and reviewed by trusted CI.
# They are not installable provider code; unknown tests cannot be claimed.
SUITES = {
    "observe-v1": {"OBSERVE", "LIST_OFFERS", "READ_ORDER"},
    "options-v1": {"SELECT_PERFORMANCE", "SELECT_PRICE_TIER"},
    "seats-v1": {"SELECT_OFFER"},
    "checkout-v1": {"PREPARE_CHECKOUT", "VERIFY_ORDER"},
    "payment-mock-v1": {"PAYMENT_EXECUTOR"},
}


class VerificationWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    country: str = Field(pattern=r"^[A-Z]{2}$")
    capability: Literal[
        "OBSERVE", "SELECT_PERFORMANCE", "SELECT_PRICE_TIER", "LIST_OFFERS",
        "SELECT_OFFER", "READ_ORDER", "PREPARE_CHECKOUT", "VERIFY_ORDER",
        "PAYMENT_EXECUTOR",
    ]
    state: Literal["pending", "fixture_verified", "revoked"]
    addon_version: str = Field(min_length=1, max_length=60, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    profile_id: str = Field(min_length=2, max_length=120, pattern=r"^[a-z0-9][a-z0-9._-]*$")
    fixture_suite: str = Field(min_length=2, max_length=60)
    fixture_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    evidence_url: str | None = Field(default=None, max_length=1500)
    reviewer: str = Field(min_length=2, max_length=120)
    reason: str = Field(default="", max_length=500)
    expires_at: datetime | None = None
    expected_revision: int = Field(ge=0)

    @field_validator("evidence_url")
    @classmethod
    def secure_evidence(cls, value: str | None):
        if value is not None:
            u = urlsplit(value)
            if u.scheme != "https" or not u.hostname or u.username or u.password or u.port not in (None, 443) or any(c.isspace() for c in value):
                raise ValueError("Evidence must be HTTPS without credentials")
        return value

    @model_validator(mode="after")
    def verify_scope(self):
        if self.fixture_suite not in SUITES or self.capability not in SUITES[self.fixture_suite]:
            raise ValueError("Fixture suite does not cover this capability")
        if self.state == "fixture_verified" and (not self.evidence_url or not self.reason.strip()):
            raise ValueError("A passing fixture claim needs an evidence URL and reviewer note")
        if self.state == "revoked" and not self.reason.strip():
            raise ValueError("Explain the revocation")
        if self.expires_at is not None:
            if self.expires_at.tzinfo is None or self.expires_at.utcoffset() is None or self.expires_at <= now():
                raise ValueError("Expiry must be in the future with a timezone")
        if self.state == "fixture_verified" and self.expires_at is None:
            raise ValueError("Verified fixture evidence must expire")
        return self


def effective_state(record, provider, country):
    if record is None:
        return "unverified", "No reviewed fixture profile recorded"
    if record.state == "revoked":
        return "revoked", "Technical verification revoked"
    if record.state != "fixture_verified":
        return "unverified", "Fixture evidence pending"
    if record.country != country or provider.version != record.addon_version:
        return "unverified", "Provider version or jurisdiction changed"
    expiry = record.expires_at
    if expiry is None or (expiry.replace(tzinfo=timezone.utc) if expiry.tzinfo is None else expiry) <= now():
        return "unverified", "Fixture evidence expired"
    return "fixture_verified", "Offline fixture evidence only; live permission remains unverified"


def view(db: Session, provider: Provider, country: str):
    records = {row.capability: row for row in db.scalars(
        select(ProviderCapabilityVerification).where(
            ProviderCapabilityVerification.provider_id == provider.id,
            ProviderCapabilityVerification.country == country))}
    result = []
    for capability in CAPABILITIES:
        record = records.get(capability)
        state, reason = effective_state(record, provider, country)
        result.append({
            "country": country, "capability": capability, "state": state,
            "recordedState": record.state if record else "pending",
            "reason": reason,
            "revision": record.revision if record else 0,
            "profileId": record.profile_id if record else None,
            "addonVersion": record.addon_version if record else provider.version,
            "fixtureSuite": record.fixture_suite if record else None,
            "fixtureSha256": record.fixture_sha256 if record else None,
            "evidenceUrl": record.evidence_url if record else None,
            "reviewer": record.reviewer if record else None,
            "expiresAt": record.expires_at.isoformat() if record and record.expires_at else None,
            "hostPermission": False, "liveExecution": False,
        })
    return {"providerId": provider.id, "country": country,
            "registeredVersion": provider.version, "verifications": result,
            "liveExecutionAvailable": False,
            "note": "Test evidence is independent of vendor authorization and release controls."}


@router.get("/providers/{provider_id}/verifications")
def get_verifications(provider_id: str, db: Db, country: str | None = None):
    provider = db.get(Provider, provider_id)
    if provider is None:
        raise HTTPException(404, "Provider not found")
    scope = country or provider.country
    if len(scope) != 2 or not scope.isupper() or not scope.isalpha():
        raise HTTPException(422, "Invalid country")
    return view(db, provider, scope)


@router.put("/providers/{provider_id}/verifications")
def put_verification(provider_id: str, body: VerificationWrite, db: Db):
    provider = db.get(Provider, provider_id)
    if provider is None:
        raise HTTPException(404, "Provider not found")
    if provider.id in PROTECTED and body.state == "fixture_verified":
        raise HTTPException(409, "Protected provider cannot be certified as automation verified")
    if provider.automation.get("level2", {}).get("status") in ("restricted", "delegated") or provider.automation.get("level3", {}).get("status") in ("restricted", "delegated"):
        if body.state == "fixture_verified":
            raise HTTPException(409, "Restricted or delegated provider cannot be fixture-certified for this booking agent")
    if body.state == "fixture_verified" and (not provider.published or provider.version != body.addon_version):
        raise HTTPException(409, "Unpublished provider or add-on version drift")
    record = db.scalar(select(ProviderCapabilityVerification).where(
        ProviderCapabilityVerification.provider_id == provider_id,
        ProviderCapabilityVerification.country == body.country,
        ProviderCapabilityVerification.capability == body.capability))
    revision = record.revision if record else 0
    if body.expected_revision != revision:
        raise HTTPException(409, "Verification changed; refresh before saving")
    if record is not None and record.state == "revoked" and body.state != "revoked":
        raise HTTPException(409, "Revoked technical verification requires a separately reviewed new onboarding")
    previous = {
        "state": record.state, "version": record.addon_version, "profileId": record.profile_id,
        "fixtureSha256": record.fixture_sha256,
    } if record else {}
    fields = dict(
        state=body.state, addon_version=body.addon_version, profile_id=body.profile_id,
        fixture_suite=body.fixture_suite, fixture_sha256=body.fixture_sha256,
        evidence_url=body.evidence_url, reason=body.reason.strip(),
        reviewer=body.reviewer, expires_at=body.expires_at,
        revision=revision + 1, updated_at=now())
    if record is None:
        db.add(ProviderCapabilityVerification(provider_id=provider_id, country=body.country,
                                              capability=body.capability, **fields))
    else:
        result = db.execute(update(ProviderCapabilityVerification)
                            .where(ProviderCapabilityVerification.id == record.id,
                                   ProviderCapabilityVerification.revision == revision)
                            .values(**fields))
        if result.rowcount != 1:
            db.rollback()
            raise HTTPException(409, "Verification changed; refresh before saving")
        db.expire_all()
    db.add(ProviderAutomationAudit(provider_id=provider_id, country=body.country,
        capability=body.capability, action="fixture_verification_changed",
        actor="admin-key", revision=revision + 1, old_value=previous,
        new_value={"state": body.state, "version": body.addon_version,
                   "profileId": body.profile_id, "fixtureSuite": body.fixture_suite,
                   "fixtureSha256": body.fixture_sha256,
                   "evidenceUrl": body.evidence_url, "submittedReviewer": body.reviewer,
                   "reason": body.reason.strip()}))
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(409, "Concurrent verification change") from e
    return view(db, provider, body.country)
