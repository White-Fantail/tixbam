"""AB-12: Onboarding evidence is NOT a live ticketing authorization."""
from datetime import datetime,timedelta,timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine,select,inspect
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

def test_technical_verification_isolated_cas_and_revoked(monkeypatch):
    from app.db import Base,get_db
    from app.main import app
    from app.models import Provider,ProviderCapabilityVerification,ProviderAutomationAudit
    engine=create_engine("sqlite+pysqlite://",connect_args={"check_same_thread":False},
                         poolclass=StaticPool)
    Base.metadata.create_all(engine)
    assert "provider_capability_verifications" in inspect(engine).get_table_names()
    with Session(engine) as db:
        for pid,country,automation,version in [
            ("yes24","HK",{},"1.1.0"),
            ("nol","KR",{"level2":{"status":"restricted"}},"1.0.1"),
            ("livenation","HK",{"level2":{"status":"delegated"}},"1.0.0"),
            ("axs","NZ",{},"1.0.0"),
            ("hidden","HK",{},"1.0.0")
        ]:
            db.add(Provider(id=pid,name=pid,country=country,version=version,published=pid!="hidden",
                            url="https://example.org",automation=automation))
        db.commit()
    def fixture_db():
        with Session(engine,expire_on_commit=False) as db:yield db
    monkeypatch.setenv("TIXBAM_ADMIN_API_KEY","ab12-test-key")
    app.dependency_overrides[get_db]=fixture_db
    headers={"X-Admin-Key":"ab12-test-key"}
    uri="/v1/admin/automation/providers/yes24/verifications"
    future=(datetime.now(timezone.utc)+timedelta(days=7)).isoformat()
    digest="a"*64
    sample={
        "country":"HK","capability":"SELECT_PERFORMANCE","state":"pending",
        "addon_version":"1.1.0","profile_id":"yes24-event-detail-v1",
        "fixture_suite":"options-v1","fixture_sha256":digest,
        "evidence_url":None,"reviewer":"qa reviewer",
        "reason":"Awaiting offline QA","expires_at":None,"expected_revision":0
    }
    try:
        with TestClient(app) as client:
            assert client.get(uri).status_code==401
            assert client.put(uri,json=sample).status_code==401
            assert client.get(uri,headers=headers).status_code==200
            initial=client.get(uri,headers=headers).json()
            assert len(initial["verifications"])==9
            assert initial["verifications"][1]["state"]=="unverified"
            assert initial["liveExecutionAvailable"] is False
            saved=client.put(uri,json=sample,headers=headers)
            assert saved.status_code==200,saved.text
            row=next(x for x in saved.json()["verifications"] if x["capability"]=="SELECT_PERFORMANCE")
            assert row["revision"]==1 and row["state"]=="unverified"
            assert row["hostPermission"] is False and row["liveExecution"] is False
            assert client.put(uri,json=sample,headers=headers).status_code==409
            accepted={**sample,"state":"fixture_verified","expected_revision":1,
                      "evidence_url":"https://github.com/acme/ci/runs/1",
                      "reason":"Offline fixture passed (not a vendor permit)",
                      "expires_at":future}
            ok=client.put(uri,json=accepted,headers=headers)
            assert ok.status_code==200,ok.text
            assert next(x for x in ok.json()["verifications"] if x["capability"]=="SELECT_PERFORMANCE")["state"]=="fixture_verified"
            assert client.get("/v1/automation/capabilities?provider_id=yes24").json()["items"][0]["policies"][1]["permitted"] is False
            # Another vendor, country and version may not borrow this row.
            assert all(x["state"]=="unverified" for x in client.get(uri+"?country=TW",headers=headers).json()["verifications"])
            with Session(engine) as db:
                db.get(Provider,"yes24").version="1.2.0"
                db.commit()
            row=next(x for x in client.get(uri,headers=headers).json()["verifications"] if x["capability"]=="SELECT_PERFORMANCE")
            assert row["state"]=="unverified" and "version" in row["reason"].lower()
            assert client.put(uri,json={**accepted,"expected_revision":2},headers=headers).status_code==409
            with Session(engine) as db:
                db.get(Provider,"yes24").version="1.1.0";db.commit()
            revoke={**sample,"state":"revoked","expected_revision":2,"reason":"Vendor disputed fixture",
                    "evidence_url":"https://example.org/revocation"}
            revoked=client.put(uri,json=revoke,headers=headers)
            assert revoked.status_code==200
            assert next(x for x in revoked.json()["verifications"] if x["capability"]=="SELECT_PERFORMANCE")["state"]=="revoked"
            assert client.put(uri,json={**accepted,"expected_revision":3},headers=headers).status_code==409
            with Session(engine) as db:
                actions=[row.action for row in db.scalars(select(ProviderAutomationAudit)).all()]
                assert actions.count("fixture_verification_changed")==3
                row=db.scalars(select(ProviderCapabilityVerification)).one()
                assert row.revision==3 and row.state=="revoked"
            # A malicious external change cannot produce permitted flag in public registry.
            public=client.get("/v1/automation/capabilities?provider_id=yes24").json()
            assert public["autonomousExecutionAvailable"] is False
            assert all(not x["permitted"] for x in public["items"][0]["policies"])
    finally:
        app.dependency_overrides.pop(get_db,None);engine.dispose()


def test_invalid_evidence_restricted_vendor_and_unsupported_suite(monkeypatch):
    from app.db import Base,get_db
    from app.main import app
    from app.models import Provider
    engine=create_engine("sqlite+pysqlite://",connect_args={"check_same_thread":False},
                         poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        for pid,auto in [("yes24",{}),("ticketmaster",{"level2":{"status":"restricted"}}),("cityline",{}),
                         ("livenation",{"level2":{"status":"delegated"}})]:
            db.add(Provider(id=pid,name=pid,country="HK",version="1.1.0",
                url="https://example.org",published=True,automation=auto))
        db.commit()
    def fixture_db():
        with Session(engine) as db:yield db
    monkeypatch.setenv("TIXBAM_ADMIN_API_KEY","ab12-test-key")
    app.dependency_overrides[get_db]=fixture_db
    headers={"X-Admin-Key":"ab12-test-key"}
    future=(datetime.now(timezone.utc)+timedelta(days=2)).isoformat()
    payload={"country":"HK","capability":"PAYMENT_EXECUTOR",
        "state":"fixture_verified","addon_version":"1.1.0",
        "profile_id":"yes24-event-detail-v1","fixture_suite":"payment-mock-v1",
        "fixture_sha256":"b"*64,"evidence_url":"https://example.org/results",
        "reviewer":"independent reviewer","reason":"synthetic mock suite evidence",
        "expires_at":future,"expected_revision":0}
    try:
        with TestClient(app) as client:
            path="/v1/admin/automation/providers/yes24/verifications"
            assert client.put(path,json=payload,headers=headers).status_code==200
            # Payment fixture recording is deliberately NOT payment verification.
            row=client.get(path,headers=headers).json()
            payment=next(x for x in row["verifications"] if x["capability"]=="PAYMENT_EXECUTOR")
            assert payment["state"]=="fixture_verified"
            assert payment["hostPermission"] is False
            assert payment["liveExecution"] is False
            for changed in [
                {"fixture_suite":"observe-v1"},{"fixture_sha256":"0"*32},
                {"evidence_url":"http://evil.test/"},{"evidence_url":"https://user:pass@example.org/"},
                {"evidence_url":"https://example.org:4443/"},
                {"reviewer":""},{"expires_at":None},
                {"expires_at":(datetime.now(timezone.utc)-timedelta(days=1)).isoformat()},
                {"expires_at":"2027-01-01T11:00:00"},
                {"state":"permitted"},{"arbitraryCommand":"click buy"},
                {"profile_id":"bad<profile>"},
            ]:
                assert client.put(path,json={**payload,**changed},headers=headers).status_code==422,changed
            for vendor in ("cityline","ticketmaster","livenation"):
                assert client.put(f"/v1/admin/automation/providers/{vendor}/verifications",
                                  json={**payload,"capability":"OBSERVE",
                                  "fixture_suite":"observe-v1"},headers=headers).status_code==409
            assert client.get("/v1/admin/automation/providers/unknown/verifications",headers=headers).status_code==404
            assert client.get(path+"?country=USA",headers=headers).status_code==422
    finally:
        app.dependency_overrides.pop(get_db,None);engine.dispose()
