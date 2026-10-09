"""HTTP/API contract tests; OpenRouter is mocked, never contacted."""
from contextlib import contextmanager
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool


def test_admin_model_settings_and_authenticated_ai(monkeypatch):
    from app.accounts import current_user
    from app.db import Base, get_db
    from app.main import app
    from app.models import AIUsageLog, Provider, User
    import app.ai as ai

    engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        user = User(display_name="Rehearsal Tester")
        db.add(user)
        db.add(Provider(id="cityline", name="Cityline", url="https://www.cityline.com.hk",
                        allowed_hosts=["cityline.com.hk"]))
        db.commit()
        user_id = user.id

    def get_test_db():
        with Session(engine, expire_on_commit=False) as db:
            yield db

    def signed_in():
        with Session(engine) as db:
            return db.get(User, user_id)

    class Response:
        def raise_for_status(self):
            pass
        def json(self):
            return {"choices": [{"message": {"content":
                '{"summary":"Review the demo cart","tips":["Check the ticket count"],"risk":"caution","next_step":"review"}'}}]}

    class FakeOpenRouter:
        def __init__(self, timeout):
            assert 2 <= timeout <= 12
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            return False
        async def post(self, url, headers, json):
            assert url == "https://openrouter.ai/api/v1/chat/completions"
            assert headers["Authorization"] == "Bearer test-key"
            assert json["model"] == "openai/gpt-4.1-mini"
            assert "payment" not in json["messages"][1]["content"].lower()
            return Response()

    monkeypatch.setenv("TIXBAM_ADMIN_API_KEY", "ai-tests-only")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(ai.httpx, "AsyncClient", FakeOpenRouter)
    app.dependency_overrides[get_db] = get_test_db
    try:
        with TestClient(app) as client:
            path = "/v1/admin/ai/tasks/rehearsal_guidance"
            settings = {"model":"openai/gpt-4.1-mini","enabled":True,
                        "timeout_seconds":6,"max_output_tokens":450}
            assert client.put(path, json=settings).status_code == 401
            assert client.put(path, json=settings, headers={"X-Admin-Key":"ai-tests-only"}).status_code == 200
            got = client.get("/v1/admin/ai/tasks", headers={"X-Admin-Key":"ai-tests-only"}).json()
            assert got["configured"] and got["items"][0]["enabled"]
            assert client.put("/v1/admin/ai/tasks/unknown", json=settings,
                              headers={"X-Admin-Key":"ai-tests-only"}).status_code == 422
            request = {"task":"rehearsal_guidance","provider_id":"cityline",
                       "context":{"stage":"practice_setup","quantity":1,"budget_minor":80000,
                                  "currency":"HKD","locale":"ko"}}
            assert client.post("/v1/ai/advice", json=request).status_code == 401
            app.dependency_overrides[current_user] = signed_in
            success = client.post("/v1/ai/advice", json=request)
            assert success.status_code == 200, success.text
            assert success.json()["advisoryOnly"] is True
            assert success.json()["nextStep"] == "review"
            assert client.post("/v1/ai/advice", json={
                **request,"context":{**request["context"],"issue":"test@example.com"}}).status_code == 422
            assert client.post("/v1/ai/advice", json={
                **request,"provider_id":"missing-provider"}).status_code == 422
            with Session(engine) as db:
                entries = db.scalars(select(AIUsageLog)).all()
                assert len(entries) == 1 and entries[0].status == "success"
    finally:
        app.dependency_overrides.pop(current_user, None)
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()
