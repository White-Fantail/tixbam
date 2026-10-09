"""AB-01 contract/regression tests. All permission decisions must fail closed."""
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool


def test_policy_registry_http_fail_closed(monkeypatch):
    from app.db import Base, get_db
    from app.main import app
    from app.models import (
        AutomationSafetySetting, Provider, ProviderAutomationAudit,
        ProviderAutomationPolicy,
    )

    engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Base.metadata.create_all(engine)
    for name in ("provider_automation_policies", "provider_automation_audit", "automation_safety_settings"):
        assert name in inspect(engine).get_table_names()

    with Session(engine) as db:
        for provider_id, country, automation in [
            ("cityline", "HK", {"level2": {"status": "unverified"}}),
            ("ticketmaster", "NZ", {"level2": {"status": "restricted"}}),
            ("nol", "KR", {"level3": {"status": "restricted"}}),
            ("axs", "NZ", {"level3": {"status": "restricted"}}),
            ("livenation", "HK", {"level2": {"status": "delegated"}}),
            ("yes24", "KR", {"level2": {"status": "unverified"}}),
            ("kktix", "TW", {"level2": {"status": "unverified"}}),
        ]:
            db.add(Provider(id=provider_id, name=provider_id, country=country,
                            url="https://example.org", published=True, automation=automation))
        db.add(Provider(id="hidden", name="hidden", country="NZ",
                        url="https://example.org", published=False, automation={}))
        db.commit()

    def local_db():
        with Session(engine, expire_on_commit=False) as db:
            yield db

    monkeypatch.setenv("TIXBAM_ADMIN_API_KEY", "only-for-tests")
    app.dependency_overrides[get_db] = local_db
    headers = {"X-Admin-Key": "only-for-tests"}
    try:
        with TestClient(app) as client:
            public = client.get("/v1/automation/capabilities")
            assert public.status_code == 200
            result = public.json()
            assert result["globalKillSwitch"] is True
            assert result["autonomousExecutionAvailable"] is False
            assert len(result["items"]) == 7
            assert not any(row["providerId"] == "hidden" for row in result["items"])
            for row in result["items"]:
                assert row["mode"] == "assistant"
                assert row["autonomousCheckoutAvailable"] is False
                assert row["localVerificationRequired"] is True
                assert len(row["policies"]) == 9
                assert all(not policy["permitted"] for policy in row["policies"])
                assert all("evidenceUrl" not in policy for policy in row["policies"])
            assert client.get("/v1/automation/capabilities?provider_id=hidden").status_code == 404
            assert client.get("/v1/automation/capabilities?provider_id=missing").status_code == 404
            assert client.get("/v1/automation/capabilities?country=USA").status_code == 422
            assert client.get("/v1/admin/automation/providers").status_code == 401
            all_admin = client.get("/v1/admin/automation/providers", headers=headers)
            assert all_admin.status_code == 200
            assert len(all_admin.json()["items"]) == 8  # includes unpublished
            assert all_admin.json()["globalKillSwitch"] is True

            for vendor in ("ticketmaster", "nol", "axs"):
                restricted = client.get(f"/v1/automation/capabilities?provider_id={vendor}").json()["items"][0]
                assert all(p["permissionState"] == "restricted" for p in restricted["policies"])
            delegated = client.get("/v1/automation/capabilities?provider_id=livenation").json()["items"][0]
            assert delegated["ticketAgentRequired"] is True
            assert all(p["permissionState"] == "unverified" for p in delegated["policies"])

            path = "/v1/admin/automation/providers/cityline/policies"
            payload = {"country": "HK", "capability": "SELECT_OFFER", "state": "restricted",
                       "reason": "No verified authorization", "reviewer": "QA note",
                       "evidence_url": "https://example.org/terms", "expected_revision": 0}
            assert client.get(path).status_code == 401
            assert client.put(path, json=payload).status_code == 401
            assert client.put(path, json={**payload, "state": "permitted"}, headers=headers).status_code == 422
            assert client.put(path, json={**payload, "evidence_url": "http://bad.example.org"},
                              headers=headers).status_code == 422
            assert client.put(path, json={**payload, "evidence_url": "https://user:pass@site.example.org"},
                              headers=headers).status_code == 422
            assert client.put(path, json={**payload, "country": "HKG"}, headers=headers).status_code == 422
            assert client.put(path, json={**payload, "capability": "EXECUTE_JS"}, headers=headers).status_code == 422
            assert client.put(path, json={**payload, "unexpected": "field"}, headers=headers).status_code == 422
            first = client.put(path, json=payload, headers=headers)
            assert first.status_code == 200, first.text
            row = next(p for p in first.json()["policies"] if p["capability"] == "SELECT_OFFER")
            assert row["revision"] == 1 and row["permissionState"] == "restricted"
            assert row["reviewer"] == "QA note"
            assert client.put(path, json=payload, headers=headers).status_code == 409
            updated = client.put(path, json={**payload, "expected_revision": 1,
                                            "state": "unverified"}, headers=headers)
            assert updated.status_code == 200
            assert next(p for p in updated.json()["policies"] if p["capability"] == "SELECT_OFFER")["revision"] == 2
            assert client.put(path, json={**payload, "expected_revision": 2,
                                          "state": "revoked"}, headers=headers).status_code == 200
            assert client.put(path, json={**payload, "expected_revision": 3,
                                          "state": "unverified"}, headers=headers).status_code == 409

            blocked = "/v1/admin/automation/providers/ticketmaster/policies"
            assert client.put(blocked, json={**payload, "country": "NZ", "state": "unverified"},
                              headers=headers).status_code == 409
            still_blocked = client.put(blocked, json={**payload, "country": "NZ"},
                                       headers=headers)
            assert still_blocked.status_code == 200
            assert all(p["permissionState"] == "restricted" for p in still_blocked.json()["policies"])

            expired = client.put(path, json={**payload, "capability":"READ_ORDER", "state":"unverified",
                "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()},
                headers=headers)
            assert expired.status_code == 200
            assert client.put(path, json={**payload, "capability":"READ_ORDER", "state":"unverified",
                "expires_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), "expected_revision":1},
                headers=headers).status_code == 422
            assert client.put(path, json={**payload, "capability":"READ_ORDER", "state":"unverified",
                "expires_at": "2027-01-01T00:00:00", "expected_revision":1}, headers=headers).status_code == 422
            # Wrong country cannot borrow the policy of Hong Kong.
            tw = client.get(path+"?country=TW", headers=headers).json()
            assert all(p["revision"] == 0 for p in tw["policies"])
            assert all(p["permissionState"] == "unverified" for p in tw["policies"])

            switch = "/v1/admin/automation/kill-switch"
            assert client.put(switch, json={"kill_switch":False,"expected_revision":1},
                              headers=headers).status_code == 409
            initialized = client.put(switch, json={"kill_switch":True,"expected_revision":1},
                                     headers=headers)
            assert initialized.status_code == 200
            assert initialized.json()["globalKillSwitch"] is True
            changed = client.put(switch, json={"kill_switch":False,"expected_revision":1},
                                 headers=headers)
            assert changed.status_code == 200
            assert changed.json()["autonomousExecutionAvailable"] is False
            assert client.put(switch, json={"kill_switch":True,"expected_revision":1},
                              headers=headers).status_code == 409
            assert client.get("/v1/automation/capabilities").json()["globalKillSwitch"] is False
            assert client.get("/v1/automation/capabilities").json()["autonomousExecutionAvailable"] is False

            audit = client.get(path, headers=headers).json()["recentAudit"]
            assert len(audit) >= 4 and audit[0]["revision"] > 0
            with Session(engine) as db:
                assert db.scalar(select(ProviderAutomationPolicy).where(
                    ProviderAutomationPolicy.provider_id == "cityline",
                    ProviderAutomationPolicy.country == "HK",
                    ProviderAutomationPolicy.capability == "SELECT_OFFER")).state == "revoked"
                assert db.scalar(select(AutomationSafetySetting)).revision == 2
                assert db.query(ProviderAutomationAudit).count() >= 6
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_expired_and_unsafe_metadata_never_upgrades_permission():
    from app.automation_policies import policy_state
    from app.models import Provider, ProviderAutomationPolicy
    provider = Provider(id="cityline", name="Cityline", automation={})
    expired = ProviderAutomationPolicy(provider_id="cityline", country="HK",
                                        capability="OBSERVE", state="restricted",
                                        expires_at=datetime.now(timezone.utc)-timedelta(days=1),
                                        reason="Expired")
    assert policy_state(provider, expired, "HK")[0] == "unverified"
    assert policy_state(provider, expired, "TW")[0] == "unverified"
    spoofed = ProviderAutomationPolicy(provider_id="cityline", country="HK",
                                        capability="PAYMENT_EXECUTOR", state="permitted")
    assert policy_state(provider, spoofed, "HK")[0] == "unverified"
    restricted = Provider(id="axs", name="AXS", automation={})
    assert policy_state(restricted, spoofed, "HK")[0] == "restricted"
