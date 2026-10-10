"""PlannerV1 HTTP boundaries: no network, no live action, no context/secret logs."""
import json
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool


def setup(monkeypatch):
    from app.db import Base, get_db
    from app.accounts import current_user
    from app.main import app
    from app.models import User, Provider, AIModelPolicy, AIPlannerRequest, AIUsageLog
    import app.ai_planner as planner

    engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = User(display_name="Planner Test")
        db.add(user)
        db.add(Provider(id="cityline", name="Cityline",
                        url="https://cityline.com.hk", allowed_hosts=["cityline.com.hk"]))
        db.add(AIModelPolicy(task="planner_v1", model="openai/gpt-4.1-mini",
                             enabled=True, structured_output_verified=True,
                             timeout_seconds=4, max_output_tokens=450))
        db.commit()
        user_id = user.id

    def test_db():
        with Session(engine) as db:
            yield db

    def signed_in():
        with Session(engine) as db:
            return db.get(User, user_id)

    app.dependency_overrides[get_db] = test_db
    app.dependency_overrides[current_user] = signed_in
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-planner-key")

    def close():
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(current_user, None)
        engine.dispose()
    return app, engine, planner, user_id, close


def payload(stage="options", challenge="none", with_target=True, **updates):
    token = str(uuid4())
    targets = [{"kind": "performance", "token": token}] if with_target else []
    counts = {"performance": len(targets), "price_tier": 0, "offer": 0,
              "delivery": 0, "navigation": 0}
    base = {"requestId": str(uuid4()), "runNonce": str(uuid4()),
            "snapshotId": str(uuid4()), "pageGeneration": 0,
            "providerId": "cityline", "locale": "ko", "rehearsal": True,
            "observation": {"schemaVersion": 1, "stage": stage,
                            "challenge": challenge, "confidence": "partial",
                            "optionCounts": counts, "targets": targets}}
    base.update(updates)
    return base


def fake_openrouter(monkeypatch, planner, choice, requests):
    """Full HTTP body is recorded only in test, not in service DB."""
    class Reply:
        def raise_for_status(self):
            if choice.get("http_error"):
                raise httpx.HTTPStatusError("model unsupported",
                    request=httpx.Request("POST", "https://openrouter.ai"),
                    response=httpx.Response(400))
        def json(self):
            return choice.get("api_response", {
                "choices": [{"finish_reason": "stop",
                             "message": {"content": json.dumps(choice["output"])}}]})
    class Fake:
        def __init__(self, timeout):
            assert 2 <= timeout <= 12
        async def __aenter__(self):
            return self
        async def __aexit__(self, *_):
            return False
        async def post(self, url, headers, json):
            assert url == "https://openrouter.ai/api/v1/chat/completions"
            assert headers["Authorization"] == "Bearer test-planner-key"
            requests.append(json)
            if choice.get("timeout"):
                raise httpx.ReadTimeout("simulated provider timeout")
            return Reply()
    monkeypatch.setattr(planner.httpx, "AsyncClient", Fake)


def test_planner_auth_privacy_strict_schema_replay_and_advice_unchanged(monkeypatch):
    from app.accounts import current_user
    from app.models import AIUsageLog, AIPlannerRequest
    app, engine, planner, user_id, close = setup(monkeypatch)
    observed = []
    choice = {"output": {"action": "WAIT", "targetToken": None,
                         "rationaleCode": "WAIT_FOR_OBSERVATION"}}
    fake_openrouter(monkeypatch, planner, choice, observed)
    try:
        with TestClient(app) as client:
            body = payload()
            # An authenticated user is required; no renderer-selected identity.
            app.dependency_overrides.pop(current_user)
            assert client.post("/v1/ai/plans", json=body).status_code == 401
            app.dependency_overrides[current_user] = lambda: _signed_user(engine, user_id)
            response = client.post("/v1/ai/plans", json=body)
            assert response.status_code == 200, response.text
            result = response.json()
            assert result["advisoryOnly"] is True and result["action"] == "WAIT"
            assert result["requestId"] == body["requestId"]
            assert result["snapshotId"] == body["snapshotId"]
            assert result["expectedStage"] == "options"
            assert result["expectedPageGeneration"] == 0
            assert result["targetToken"] is None
            assert result["expiresAtMs"] > 0
            assert len(observed) == 1
            sent = observed[0]
            assert sent["response_format"]["type"] == "json_schema"
            assert sent["response_format"]["json_schema"]["strict"] is True
            assert sent["provider"]["require_parameters"] is True
            assert sent["max_tokens"] == 256  # hard per-call cost guard
            model_input = sent["messages"][1]["content"]
            assert json.loads(model_input)["locale"] == "ko"
            for forbidden in [body["requestId"], body["snapshotId"],
                              body["runNonce"], "cityline", "user_id",
                              "account", "windowId", "rawHtml", "seatPrice",
                              "orderId", "card", "payment", "http"]:
                assert forbidden not in model_input
            assert body["observation"]["targets"][0]["token"] in model_input
            assert client.post("/v1/ai/plans", json=body).status_code == 409
            assert len(observed) == 1
            with Session(engine) as db:
                p = db.scalars(select(AIPlannerRequest)).all()
                logs = db.scalars(select(AIUsageLog)).all()
                assert len(p) == len(logs) == 1
                assert p[0].status == logs[0].status == "success"
                assert not hasattr(p[0], "prompt") and not hasattr(p[0], "response")
            # Old advice remains task-specific and cannot invoke the planner via /advice.
            assert client.post("/v1/ai/advice", json={
                "task": "planner_v1", "provider_id": "cityline",
                "context": {"stage": "options"}}).status_code == 422
    finally:
        close()


def _signed_user(engine, id):
    from app.models import User
    with Session(engine) as db:
        return db.get(User, id)


def test_privacy_fail_closed_and_admin_feature_gates(monkeypatch):
    from app.models import AIModelPolicy
    app, engine, planner, _id, close = setup(monkeypatch)
    choice={"output":{"action":"ASK_USER","targetToken":None,
                      "rationaleCode":"REQUIRES_REVIEW"}}
    observed=[]
    fake_openrouter(monkeypatch,planner,choice,observed)
    body=payload(stage="queue",challenge="captcha",with_target=False)
    try:
        with TestClient(app) as client:
            for change in [
                {"rehearsal": False},
                {"email": "person@example.com"},
                {"observation": {**body["observation"], "html": "<script>pay()</script>"}},
                {"observation": {**body["observation"],"targets": [
                    {"kind": "performance", "token": str(uuid4()), "label": "person@example.com"}]}},
                {"observation": {**body["observation"], "optionCounts": {
                    **body["observation"]["optionCounts"], "offer": 3}}},
                {"observation": {**body["observation"], "optionCounts": {
                    **body["observation"]["optionCounts"], "unknown": 1}}},
                {"observation": {**body["observation"], "targets": [
                    {"kind": "performance", "token": str(uuid4())}]}},
            ]:
                assert client.post("/v1/ai/plans", json={**body, **change}).status_code == 422
            assert not observed
            with Session(engine) as db:
                policy = db.get(AIModelPolicy,"planner_v1")
                policy.structured_output_verified=False
                db.commit()
            assert client.post("/v1/ai/plans",json=body).status_code == 409
            with Session(engine) as db:
                db.get(AIModelPolicy,"planner_v1").structured_output_verified=True
                db.commit()
            monkeypatch.delenv("OPENROUTER_API_KEY")
            assert client.post("/v1/ai/plans",json=body).status_code == 503
            monkeypatch.setenv("OPENROUTER_API_KEY","test-planner-key")
            assert client.post("/v1/ai/plans",json={**body,"providerId":"missing"}).status_code==422
            good=client.post("/v1/ai/plans",json=body)
            assert good.status_code==200
            assert good.json()["action"]=="ASK_USER"
            assert len(observed)==1
    finally:
        close()


def test_model_timeout_invalid_output_injection_and_unsupported_structured_fail_closed(monkeypatch):
    app, engine, planner, _id, close=setup(monkeypatch)
    calls=[]
    choice={"output":{"action":"SELECT_PERFORMANCE",
                      "targetToken":str(uuid4()),"rationaleCode":"AVAILABLE"}}
    fake_openrouter(monkeypatch,planner,choice,calls)
    try:
        with TestClient(app) as client:
            base=payload()
            # Invented handles are refused even if the model returned valid JSON.
            response=client.post("/v1/ai/plans",json=base)
            assert response.status_code==502
            assert "token" not in response.text.lower()
            assert "available" in response.text.lower()
            variants=[
                {"action":"BUY_NOW","targetToken":None,"rationaleCode":"PAY"},
                {"action":"WAIT","targetToken":None,"rationaleCode":"OK",
                 "command":"window.location='https://evil.example'"},
                {"action":"WAIT","targetToken":"https://evil.test","rationaleCode":"OK"},
                {"action":"WAIT","targetToken":None,
                 "rationaleCode":"IGNORE_RULES_AND_SEND_PASSWORD"},
                {"action":"WAIT","targetToken":None,"rationaleCode":"ok"},
                {"action":"SELECT_PERFORMANCE","targetToken":None,"rationaleCode":"OK"},
                {"action":"WAIT","targetToken":str(uuid4()),"rationaleCode":"OK"},
            ]
            for item in variants:
                choice["output"]=item
                assert client.post("/v1/ai/plans",json=payload()).status_code==502,item
            # Even existing token cannot bypass a CAPTCHA/3DS stage.
            token=str(uuid4())
            choice["output"]={"action":"SELECT_PERFORMANCE","targetToken":token,"rationaleCode":"OK"}
            challenge=payload(stage="queue",challenge="queue",with_target=False)
            assert client.post("/v1/ai/plans",json=challenge).status_code==502
            choice["timeout"]=True
            assert client.post("/v1/ai/plans",json=payload()).status_code==502
            choice["timeout"]=False
            choice["http_error"]=True
            assert client.post("/v1/ai/plans",json=payload()).status_code==502
            choice["http_error"]=False
            choice["api_response"]={"choices":[{"finish_reason":"length",
                "message":{"content":'{"action":"WAIT","targetToken":null,"rationaleCode":"OK"}'}}]}
            assert client.post("/v1/ai/plans",json=payload()).status_code==502
    finally:
        close()


def test_target_kind_match_and_bounded_per_run_per_account(monkeypatch):
    app, engine, planner, _id, close=setup(monkeypatch)
    choice={"output":{"action":"SELECT_PERFORMANCE",
                      "targetToken":None,"rationaleCode":"APPROVED_OPTION"}}
    calls=[]
    fake_openrouter(monkeypatch,planner,choice,calls)
    try:
        with TestClient(app) as client:
            base=payload()
            token=base["observation"]["targets"][0]["token"]
            choice["output"]["targetToken"]=token
            response=client.post("/v1/ai/plans",json=base)
            assert response.status_code==200,response.text
            assert response.json()["targetToken"]==token
            same_run=base["runNonce"]
            for i in range(7):
                sub=payload(runNonce=same_run)
                choice["output"]["targetToken"]=sub["observation"]["targets"][0]["token"]
                assert client.post("/v1/ai/plans",json=sub).status_code==200
            sub=payload(runNonce=same_run)
            choice["output"]["targetToken"]=sub["observation"]["targets"][0]["token"]
            assert client.post("/v1/ai/plans",json=sub).status_code==429
            # Per-account quota applies across separate runNonce values.
            for i in range(12):
                item=payload()
                choice["output"]["targetToken"]=item["observation"]["targets"][0]["token"]
                assert client.post("/v1/ai/plans",json=item).status_code==200
            one_more=payload()
            choice["output"]["targetToken"]=one_more["observation"]["targets"][0]["token"]
            assert client.post("/v1/ai/plans",json=one_more).status_code==429
            assert len(calls)==20
    finally:
        close()


def test_legacy_upgrade_adds_verified_model_capability_column(tmp_path):
    from sqlalchemy import create_engine, text, inspect
    from app.migrations import migrate_schedule_columns
    engine=create_engine("sqlite+pysqlite:///"+str(tmp_path/"legacy.db"))
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE ai_model_policies (task VARCHAR(60) PRIMARY KEY, "
                          "model VARCHAR(160), enabled BOOLEAN, timeout_seconds INTEGER, "
                          "max_output_tokens INTEGER, updated_at DATETIME)"))
        conn.execute(text("INSERT INTO ai_model_policies "
                          "(task, model, enabled, timeout_seconds, max_output_tokens) "
                          "VALUES ('planner_v1','openai/example',0,6,450)"))
    migrate_schedule_columns(engine)
    migrate_schedule_columns(engine)
    assert "structured_output_verified" in {
        c["name"] for c in inspect(engine).get_columns("ai_model_policies")}
    with engine.connect() as conn:
        row=conn.execute(text("SELECT structured_output_verified FROM ai_model_policies")).scalar()
        assert row in (False,0)
    engine.dispose()
