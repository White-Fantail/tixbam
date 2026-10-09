"""AB-01: evidence-driven automation policy registry. No live automation authorization.

Server policy is intentionally insufficient to grant execution: the trusted,
version-pinned Electron host must independently verify a bundled add-on and a
future release gate. This service *never* issues a payment execution token.
"""
from datetime import datetime, timezone
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import get_db
from .models import (
    AutomationSafetySetting, Provider, ProviderAutomationAudit,
    ProviderAutomationPolicy, now,
)
from .security import admin_required

Db = Annotated[Session, Depends(get_db)]
Capability = Literal[
    "OBSERVE", "SELECT_PERFORMANCE", "SELECT_PRICE_TIER", "LIST_OFFERS",
    "SELECT_OFFER", "READ_ORDER", "PREPARE_CHECKOUT", "VERIFY_ORDER",
    "PAYMENT_EXECUTOR",
]
CAPABILITIES = list(Capability.__args__)
Country = Annotated[str, Field(pattern=r"^[A-Z]{2}$", min_length=2, max_length=2)]
# Existing bundled add-on metadata explicitly lists these vendors as restricted.
# A DB row/ordinary admin toggle is NEVER permitted to weaken this baseline.
RESTRICTED = {
    "nol": "https://world.nol.com/en/pages/tos.html",
    "ticketmaster": "https://www.ticketmaster.co.nz/h/purchase.html",
    "axs": "https://www.axs.com/nz/about-terms-of-use_NZ_v1.html",
}
PROTECTED = frozenset(RESTRICTED)
ADMIN_PATH = "/v1/admin/automation"
admin_router = APIRouter(prefix=ADMIN_PATH, dependencies=[Depends(admin_required)])
router = APIRouter(prefix="/v1/automation")


class PolicyWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    country: Country
    capability: Capability
    # AB-01 can RECORD restrictions/revocation only. Evidence and independent
    # sign-off for "permitted" will be implemented in AB-12, not a checkbox.
    state: Literal["unverified", "restricted", "revoked"]
    evidence_url: str | None = Field(default=None, max_length=1500)
    reason: str = Field(default="", max_length=500)
    reviewer: str = Field(default="admin-key", min_length=2, max_length=120)
    expires_at: datetime | None = None
    expected_revision: int | None = Field(default=None, ge=0)

    @field_validator("evidence_url")
    @classmethod
    def https_reference(cls, value):
        if value is not None:
            url = urlsplit(value)
            if (url.scheme != "https" or not url.hostname or url.username
                or url.password or any(ch.isspace() for ch in value)):
                raise ValueError("Evidence must be an HTTPS URL without credentials")
        return value

    @model_validator(mode="after")
    def validate_state(self):
        if self.state in ("restricted", "revoked") and not self.reason.strip():
            raise ValueError("Explain the restriction or revocation")
        if self.expires_at is not None:
            if self.expires_at.tzinfo is None or self.expires_at.utcoffset() is None:
                raise ValueError("Expiry must include a timezone")
            if self.expires_at <= now():
                raise ValueError("Expiry must be in the future")
        return self


class SwitchWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kill_switch: bool
    expected_revision: int = Field(ge=1)


def setting(db: Session) -> AutomationSafetySetting:
    item = db.get(AutomationSafetySetting, "global")
    if item is None:
        # Fail closed even if no singleton row exists (e.g. before first write).
        return AutomationSafetySetting(id="global", kill_switch=True, revision=0)
    return item


def policy_state(provider: Provider, entry: ProviderAutomationPolicy | None, country: str):
    if provider.id in PROTECTED:
        return "restricted", "Published provider restriction; ordinary admin changes cannot override it"
    if provider.automation.get("level2", {}).get("status") == "restricted" or provider.automation.get("level3", {}).get("status") == "restricted":
        return "restricted", "Provider registry marks automation restricted"
    if provider.automation.get("level2", {}).get("status") == "delegated" or provider.automation.get("level3", {}).get("status") == "delegated":
        return "unverified", "Event promoter delegates ticket sales to a separate ticket agent"
    if entry is None or entry.country != country:
        return "unverified", "No verified vendor authorization exists"
    if entry.state == "revoked":
        return "revoked", entry.reason
    if entry.expires_at is not None:
        expiry = entry.expires_at.replace(tzinfo=timezone.utc) if entry.expires_at.tzinfo is None else entry.expires_at
        if expiry <= now():
            return "unverified", "The policy evidence has expired"
    if entry.state == "restricted":
        return "restricted", entry.reason
    # Even if a future migration adds 'permitted' rows, AB-01 never grants
    # permission without a verified authorization workflow.
    return "unverified", "Formal authorization has not been verified"


def policies_for(db: Session, provider: Provider, country: str, admin: bool = False):
    entries = {row.capability: row for row in db.scalars(select(ProviderAutomationPolicy).where(
        ProviderAutomationPolicy.provider_id == provider.id,
        ProviderAutomationPolicy.country == country))}
    rows = []
    for capability in CAPABILITIES:
        entry = entries.get(capability)
        state, note = policy_state(provider, entry, country)
        row = {
            "capability": capability, "country": country, "permissionState": state,
            "reason": note, "revision": entry.revision if entry else 0,
            "permitted": False,  # no runtime authorization in AB-01
        }
        if admin:
            row.update({
                "recordedState": entry.state if entry else "unverified",
                "evidenceUrl": entry.evidence_url if entry else RESTRICTED.get(provider.id),
                "reviewer": entry.reviewer if entry else None,
                "reviewedAt": entry.reviewed_at.isoformat() if entry and entry.reviewed_at else None,
                "expiresAt": entry.expires_at.isoformat() if entry and entry.expires_at else None,
                "updatedAt": entry.updated_at.isoformat() if entry else None,
            })
        rows.append(row)
    return rows


def provider_view(db: Session, provider: Provider, country: str, admin=False):
    is_delegate = provider.automation.get("level2", {}).get("status") == "delegated" or provider.automation.get("level3", {}).get("status") == "delegated"
    return {
        "providerId": provider.id, "name": provider.name, "country": country,
        "registeredCountry": provider.country, "published": provider.published,
        "ticketAgentRequired": is_delegate,
        "mode": "assistant", "autonomousCheckoutAvailable": False,
        "localVerificationRequired": True,
        "policies": policies_for(db, provider, country, admin),
    }


@router.get("/capabilities")
def public_capabilities(
    db: Db,
    provider_id: str | None = Query(default=None, min_length=1, max_length=60),
    country: str | None = Query(default=None, pattern=r"^[A-Z]{2}$"),
):
    config = setting(db)
    query = select(Provider).where(Provider.published.is_(True)).order_by(Provider.name)
    if provider_id:
        query = query.where(Provider.id == provider_id)
    providers = db.scalars(query).all()
    if provider_id and not providers:
        raise HTTPException(status_code=404, detail="Published provider not found")
    return {
        "schemaVersion": 1, "globalKillSwitch": config.kill_switch,
        "autonomousExecutionAvailable": False,
        "items": [provider_view(db, p, country or p.country) for p in providers],
    }


@admin_router.get("/providers")
def admin_providers(db: Db):
    providers = db.scalars(select(Provider).order_by(Provider.name)).all()
    config = setting(db)
    return {
        "schemaVersion": 1, "globalKillSwitch": config.kill_switch,
        "switchRevision": config.revision,
        "items": [provider_view(db, p, p.country, True) for p in providers],
        "note": "No live autonomous execution is enabled in AB-01.",
    }


@admin_router.get("/providers/{provider_id}/policies")
def get_provider_policies(provider_id: str, db: Db,
                          country: str | None = Query(default=None, pattern=r"^[A-Z]{2}$")):
    provider = db.get(Provider, provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    result = provider_view(db, provider, country or provider.country, True)
    result["globalKillSwitch"] = setting(db).kill_switch
    result["recentAudit"] = [audit_data(a) for a in db.scalars(
        select(ProviderAutomationAudit).where(ProviderAutomationAudit.provider_id == provider_id)
        .order_by(ProviderAutomationAudit.created_at.desc(), ProviderAutomationAudit.id.desc()).limit(20))]
    return result


def audit_data(item: ProviderAutomationAudit):
    return {
        "id": item.id, "providerId": item.provider_id,
        "country": item.country, "capability": item.capability, "action": item.action,
        "actor": item.actor, "oldValue": item.old_value, "newValue": item.new_value,
        "revision": item.revision, "createdAt": item.created_at.isoformat(),
    }


@admin_router.put("/providers/{provider_id}/policies")
def write_policy(provider_id: str, body: PolicyWrite, db: Db):
    provider = db.get(Provider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    if provider_id in PROTECTED and body.state != "restricted":
        raise HTTPException(status_code=409, detail="Protected provider restriction cannot be relaxed through Admin")
    # Preserve a revoked policy until independently verified; AB-01 has no such workflow.
    item = db.scalar(select(ProviderAutomationPolicy).where(
        ProviderAutomationPolicy.provider_id == provider_id,
        ProviderAutomationPolicy.country == body.country,
        ProviderAutomationPolicy.capability == body.capability))
    previous = item.revision if item else 0
    if body.expected_revision != previous:
        raise HTTPException(status_code=409, detail="Policy was changed. Refresh before saving.")
    if item and item.state == "revoked" and body.state != "revoked":
        raise HTTPException(status_code=409, detail="Revocation requires a separate verified review")
    old = {
        "state": item.state, "reason": item.reason,
        "evidenceUrl": item.evidence_url, "expiresAt": item.expires_at.isoformat() if item.expires_at else None,
    } if item else {}
    updated = now()
    values = {
        "state": body.state, "evidence_url": body.evidence_url,
        "reason": body.reason.strip(), "reviewer": body.reviewer,
        "reviewed_at": updated, "expires_at": body.expires_at,
        "updated_at": updated, "revision": previous + 1,
    }
    if item is None:
        db.add(ProviderAutomationPolicy(
            provider_id=provider_id, country=body.country,
            capability=body.capability, **values))
    else:
        # CAS avoids silently overwriting a concurrent update after both
        # editors read the same revision (not just sequential stale forms).
        result = db.execute(
            update(ProviderAutomationPolicy)
            .where(ProviderAutomationPolicy.id == item.id,
                   ProviderAutomationPolicy.revision == previous)
            .values(**values))
        if result.rowcount != 1:
            db.rollback()
            raise HTTPException(status_code=409, detail="Policy was changed. Refresh before saving.")
        db.expire_all()
    db.add(ProviderAutomationAudit(
        provider_id=provider_id, country=body.country, capability=body.capability,
        action="policy_changed", actor="admin-key", revision=previous + 1,
        old_value=old, new_value={
            "state": body.state, "reason": body.reason.strip(),
            "evidenceUrl": body.evidence_url,
            "expiresAt": body.expires_at.isoformat() if body.expires_at else None,
            "submittedReviewer": body.reviewer,
        }))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Policy was changed. Refresh before saving.") from exc
    return provider_view(db, provider, body.country, True)


@admin_router.put("/kill-switch")
def update_kill_switch(body: SwitchWrite, db: Db):
    item = db.get(AutomationSafetySetting, "global")
    if item is None:
        # Distinguish uninitialized state (rev 0) from persisted rev 1.
        # First admin write must be a conservative initialization; disable denied.
        if not body.kill_switch:
            raise HTTPException(status_code=409, detail="Initialize the safety switch before disabling it")
        item = AutomationSafetySetting(id="global", kill_switch=True, revision=1)
        db.add(item)
        db.add(ProviderAutomationAudit(
            action="kill_switch_initialized", actor="admin-key", revision=1,
            new_value={"killSwitch": True}, old_value={}))
        db.commit()
    elif body.expected_revision != item.revision:
        raise HTTPException(status_code=409, detail="Switch setting changed. Refresh before saving.")
    else:
        before = item.kill_switch
        result = db.execute(
            update(AutomationSafetySetting)
            .where(AutomationSafetySetting.id == "global",
                   AutomationSafetySetting.revision == body.expected_revision)
            .values(kill_switch=body.kill_switch,
                    revision=body.expected_revision + 1, updated_at=now()))
        if result.rowcount != 1:
            db.rollback()
            raise HTTPException(status_code=409, detail="Switch setting changed. Refresh before saving.")
        db.add(ProviderAutomationAudit(
            action="kill_switch_changed", actor="admin-key",
            revision=body.expected_revision + 1,
            old_value={"killSwitch": before}, new_value={"killSwitch": body.kill_switch}))
        db.commit()
        db.expire_all()
    return {"globalKillSwitch": item.kill_switch, "switchRevision": item.revision,
            "autonomousExecutionAvailable": False}
