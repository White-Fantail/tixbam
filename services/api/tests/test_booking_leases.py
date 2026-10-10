"""AB-06: multi-window/device scope, fencing, lease expiry and irrevocable claim."""
from datetime import timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool


def test_shared_purchase_leases_and_fencing(monkeypatch):
    from app.accounts import current_user
    from app.db import Base, get_db
    from app.main import app
    from app.models import (Event, Performance, Provider, PurchaseIntentLease,
                            TicketSale, User, UserBookingPlan, SalePerformance, now)

    engine = create_engine("sqlite+pysqlite://",
                           connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    ids = {name: str(uuid4()) for name in (
        "user_a", "user_b", "event", "performance", "performance2",
        "sale", "sale2", "plan", "plan2", "plan3")}
    from app.models import Artist
    with Session(engine) as db:
        db.add(Artist(id=str(uuid4()), name="Test Artist"))
        db.add_all([User(id=ids["user_a"], display_name="Owner A"),
                    User(id=ids["user_b"], display_name="Owner B"),
                    Provider(id="cityline", name="Cityline", url="https://cityline.com.hk")])
        db.flush()
        artist = db.query(Artist).first()
        db.add(Event(id=ids["event"], artist_id=artist.id, title="Demo"))
        db.flush()
        db.add_all([
            Performance(id=ids["performance"], event_id=ids["event"], session_key="day1"),
            Performance(id=ids["performance2"], event_id=ids["event"], session_key="day2"),
            TicketSale(id=ids["sale"], provider_id="cityline", event_id=ids["event"],
                       booking_url="https://cityline.com.hk", applies_to_all=True),
            TicketSale(id=ids["sale2"], provider_id="cityline", event_id=ids["event"],
                       booking_url="https://cityline.com.hk", applies_to_all=False),
        ])
        db.flush()
        db.add(SalePerformance(sale_id=ids["sale2"], performance_id=ids["performance"]))
        def plan(id_, user, sale, perf):
            return UserBookingPlan(user_id=ids[user], id=ids[id_],
                payload={"providerId":"cityline","saleId":ids[sale],"performanceId":ids[perf]})
        db.add_all([
            plan("plan","user_a","sale","performance"),
            plan("plan2","user_a","sale","performance2"),
            plan("plan3","user_b","sale","performance"),
        ])
        db.commit()

    def local_db():
        with Session(engine) as db:
            yield db

    active_user = {"id": ids["user_a"]}
    def account():
        with Session(engine) as db:
            return db.get(User, active_user["id"])

    app.dependency_overrides[get_db] = local_db
    app.dependency_overrides[current_user] = account
    try:
        with TestClient(app) as c:
            endpoint = "/v1/me/automation/leases"
            body = {"planId": ids["plan"], "providerId": "cityline",
                    "saleId": ids["sale"], "performanceId": ids["performance"],
                    "ownerId": str(uuid4())}
            assert c.post(endpoint+"/acquire", json={**body, "secret":"123"}).status_code == 422
            assert c.post(endpoint+"/acquire", json={**body, "planId":ids["plan2"]}).status_code == 409
            first = c.post(endpoint+"/acquire", json=body)
            assert first.status_code == 200, first.text
            ticket = first.json()
            assert ticket["fencingToken"] == 1 and ticket["status"] == "leased"
            assert ticket["autonomousCheckoutAvailable"] is False
            op = {"leaseId":ticket["leaseId"],"ownerId":body["ownerId"],
                  "fencingToken":1,"leaseToken":ticket["leaseToken"]}
            assert c.post(endpoint+"/acquire", json=body).status_code == 409
            assert c.post(endpoint+"/acquire", json={**body,"ownerId":str(uuid4())}).status_code == 409
            assert c.post(endpoint+"/renew", json={**op,"leaseToken":"0"*64}).status_code == 409
            assert c.post(endpoint+"/renew", json={**op,"fencingToken":2}).status_code == 409
            assert c.post(endpoint+"/renew", json={**op,"ownerId":str(uuid4())}).status_code == 409
            assert c.post(endpoint+"/renew", json=op).status_code == 200
            assert "leaseToken" not in c.get(endpoint).json()["items"][0]

            # A separate performance has an independent lease.
            second = c.post(endpoint+"/acquire", json={
                **body,"planId":ids["plan2"],
                "performanceId":ids["performance2"],"ownerId":str(uuid4())})
            assert second.status_code == 200

            # A different signed-in account does not see the first user's lease.
            active_user["id"] = ids["user_b"]
            assert c.get(endpoint).json()["items"] == []
            assert c.post(endpoint+"/renew", json=op).status_code == 409
            b = c.post(endpoint+"/acquire", json={
                **body,"planId":ids["plan3"],"ownerId":str(uuid4())})
            assert b.status_code == 200
            active_user["id"] = ids["user_a"]

            # Release invalidates old bearer token immediately, even pre-expiry.
            assert c.post(endpoint+"/release", json=op).status_code == 200
            assert c.post(endpoint+"/renew", json=op).status_code == 409
            successor_owner=str(uuid4())
            takeover = c.post(endpoint+"/acquire", json={
                **body,"ownerId":successor_owner})
            assert takeover.status_code == 200, takeover.text
            current = takeover.json()
            assert current["fencingToken"] == 2
            assert c.post(endpoint+"/claim", json=op).status_code == 409
            fresh = {"leaseId":current["leaseId"],
                     "fencingToken":current["fencingToken"],
                     "leaseToken":current["leaseToken"],
                     "ownerId":successor_owner}
            assert c.post(endpoint+"/renew", json=fresh).status_code == 200
            claim=c.post(endpoint+"/claim",json=fresh)
            assert claim.status_code == 200, claim.text
            assert claim.json()["status"]=="claimed"
            assert c.post(endpoint+"/claim",json=fresh).status_code==409
            assert c.post(endpoint+"/renew",json=fresh).status_code==409
            assert c.post(endpoint+"/release",json=fresh).status_code==409

            # AB-14 authenticated read-only reconciliation: claimed != paid.
            info=c.get(endpoint+"/"+current["leaseId"]+"/reconciliation")
            assert info.status_code==200,info.text
            state=info.json()
            assert state["leaseId"]==current["leaseId"]
            assert state["fencingToken"]==current["fencingToken"]
            assert state["status"]=="claimed"
            assert state["paymentOutcome"]=="unknown"
            assert state["authoritativeMerchantReceipt"] is False
            assert state["replayAllowed"] is False
            assert state["requiresManualReview"] is True
            assert state["readOnly"] is True
            assert "leaseToken" not in state
            assert "ownerId" not in state
            assert c.get(endpoint+"/"+str(uuid4())+"/reconciliation").status_code==404
            active_user["id"]=ids["user_b"]
            assert c.get(endpoint+"/"+current["leaseId"]+"/reconciliation").status_code==404
            active_user["id"]=ids["user_a"]
            assert c.post(endpoint+"/acquire",json=body).status_code==409

            # Expiry cannot erase a durable claim.
            with Session(engine) as db:
                row=db.get(PurchaseIntentLease,current["leaseId"])
                row.expires_at=now()-timedelta(hours=3)
                db.commit()
            assert c.post(endpoint+"/acquire",json=body).status_code==409
            assert c.get(endpoint).json()["items"][0]["status"]=="claimed"

            # Takeover of a pre-commit *expired* lease always increments fence.
            with Session(engine) as db:
                row=db.get(PurchaseIntentLease,second.json()["leaseId"])
                row.expires_at=now()-timedelta(minutes=1)
                db.commit()
            replacement_owner=str(uuid4())
            renewed=c.post(endpoint+"/acquire",json={
                **body,"planId":ids["plan2"],
                "performanceId":ids["performance2"],"ownerId":replacement_owner})
            assert renewed.status_code==200
            assert renewed.json()["fencingToken"]==2
            assert c.post(endpoint+"/claim",json={
                "leaseId":second.json()["leaseId"],
                "fencingToken":1,"leaseToken":second.json()["leaseToken"],
                "ownerId":replacement_owner}).status_code==409
            # Plan mismatch and invalid sale-perf association reject.
            assert c.post(endpoint+"/acquire",json={
                **body,"saleId":ids["sale2"]}).status_code==409
            assert c.post(endpoint+"/acquire",json={
                **body,"providerId":"ticketmaster"}).status_code==409
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(current_user, None)
        engine.dispose()
