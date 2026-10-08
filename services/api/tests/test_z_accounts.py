from uuid import uuid4
from urllib.parse import parse_qs, urlsplit

import jwt
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


def setup_api():
    from app.oauth import router
    from app.accounts import router as accounts
    from app.db import Base, get_db
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    app = FastAPI()
    app.include_router(accounts)
    app.include_router(router)

    def override():
        with Session() as db:
            yield db

    app.dependency_overrides[get_db] = override
    return app, engine, Session


def configured_google(monkeypatch):
    monkeypatch.setenv("TIXBAM_SESSION_SECRET", "long-development-only-secret-for-signing-tokens")
    monkeypatch.setenv("TIXBAM_PUBLIC_URL", "https://tixbam-production.up.railway.app")
    monkeypatch.setenv("TIXBAM_GOOGLE_CLIENT_ID", "google-web-client")
    monkeypatch.setenv("TIXBAM_GOOGLE_CLIENT_SECRET", "google-secret")
    monkeypatch.delenv("TIXBAM_APPLE_CLIENT_ID", raising=False)
    monkeypatch.delenv("TIXBAM_APPLE_TEAM_ID", raising=False)
    monkeypatch.delenv("TIXBAM_APPLE_KEY_ID", raising=False)
    monkeypatch.delenv("TIXBAM_APPLE_PRIVATE_KEY", raising=False)


def test_google_oauth_nonce_claim_and_account_isolation(monkeypatch):
    from app.oauth import challenge_for
    configured_google(monkeypatch)
    app, engine, Session = setup_api()
    with TestClient(app) as client:
        methods = client.get("/v1/auth/methods").json()
        assert methods == {"google": True, "apple": False}
        assert client.post("/v1/auth/dev", json={"account": "fan-one"}).status_code == 404
        assert client.post("/v1/auth/social", json={}).status_code == 404
        assert client.get("/v1/me").status_code == 401

        def begin(verifier):
            r = client.post("/v1/auth/oauth/start", json={
                "provider": "google", "codeChallenge": challenge_for(verifier)})
            assert r.status_code == 200, r.text
            data = r.json()
            qs = parse_qs(urlsplit(data["authorizationUrl"]).query)
            assert qs["client_id"] == ["google-web-client"]
            assert qs["code_challenge_method"] == ["S256"]
            assert qs["redirect_uri"] == ["https://tixbam-production.up.railway.app/v1/auth/oauth/google/callback"]
            assert "state" in qs and "nonce" in qs
            return data, qs

        verifier_a = "a" * 50
        flow_a, qs_a = begin(verifier_a)
        assert client.post("/v1/auth/oauth/complete", json={
            "flowId": flow_a["flowId"], "verifier": verifier_a}).status_code == 202
        assert client.post("/v1/auth/oauth/complete", json={
            "flowId": flow_a["flowId"], "verifier": "b" * 50}).status_code == 403
        assert client.get("/v1/auth/oauth/google/callback", params={
            "code": "some-code", "state": "unmatched-state"}).status_code == 400

        import app.oauth as oauth
        def good_exchange(provider, config, code, flow):
            assert provider == "google" and code.startswith("code-")
            return {"sub": code[5:], "email": code[5:] + "@example.com",
                    "email_verified": True, "name": "Fan", "nonce": flow.nonce}
        monkeypatch.setattr(oauth, "exchange_code", good_exchange)

        assert client.get("/v1/auth/oauth/google/callback", params={
            "code": "code-one", "state": qs_a["state"][0]}).status_code == 200
        assert client.get("/v1/auth/oauth/google/callback", params={
            "code": "code-one", "state": qs_a["state"][0]}).status_code == 400
        login_a = client.post("/v1/auth/oauth/complete", json={
            "flowId": flow_a["flowId"], "verifier": verifier_a})
        assert login_a.status_code == 200, login_a.text
        a = login_a.json()
        assert jwt.decode(a["accessToken"], "long-development-only-secret-for-signing-tokens",
                          algorithms=["HS256"], issuer="tixbam-api", audience="tixbam-desktop")["sub"] == a["user"]["id"]
        assert client.post("/v1/auth/oauth/complete", json={
            "flowId": flow_a["flowId"], "verifier": verifier_a}).status_code == 404
        verifier_b = "z" * 50
        flow_b, qs_b = begin(verifier_b)
        assert client.get("/v1/auth/oauth/google/callback", params={
            "code": "code-two", "state": qs_b["state"][0]}).status_code == 200
        b = client.post("/v1/auth/oauth/complete", json={
            "flowId": flow_b["flowId"], "verifier": verifier_b}).json()
        assert a["user"]["id"] != b["user"]["id"]
        ah = {"Authorization": "Bearer " + a["accessToken"]}
        bh = {"Authorization": "Bearer " + b["accessToken"]}
        from app.models import Artist, Event
        with Session() as db:
            artist = Artist(name="OAuth Artist")
            db.add(artist)
            db.flush()
            event = Event(artist_id=artist.id, title="OAuth Event")
            db.add(event)
            db.commit()
            artist_id, event_id = artist.id, event.id
        assert client.put(f"/v1/me/artists/{artist_id}", headers=ah).status_code == 204
        assert client.put(f"/v1/me/events/{event_id}", headers=ah).status_code == 204
        assert artist_id in client.get("/v1/me", headers=ah).json()["favoriteArtistIds"]
        assert event_id in client.get("/v1/me", headers=ah).json()["favoriteEventIds"]
        assert client.get("/v1/me", headers=bh).json()["favoriteArtistIds"] == []
        assert client.get("/v1/me", headers=bh).json()["favoriteEventIds"] == []
        item_id = str(uuid4())
        item = {"artist": "Fan", "title": "Concert", "providerId": "cityline",
                "addedAt": "2026-10-09T00:00:00Z", "url": "https://www.cityline.com.hk/"}
        assert client.put(f"/v1/me/watchlist/{item_id}", headers=ah, json=item).status_code == 200
        assert client.get("/v1/me", headers=bh).json()["watchlist"] == []
        assert client.delete(f"/v1/me/watchlist/{item_id}", headers=bh).status_code == 204
        assert len(client.get("/v1/me", headers=ah).json()["watchlist"]) == 1
    engine.dispose()


def test_apple_form_post_nonce_errors_and_verifier(monkeypatch):
    from app.oauth import challenge_for
    configured_google(monkeypatch)
    monkeypatch.setenv("TIXBAM_APPLE_CLIENT_ID", "com.example.tixbam")
    monkeypatch.setenv("TIXBAM_APPLE_TEAM_ID", "TESTTEAM00")
    monkeypatch.setenv("TIXBAM_APPLE_KEY_ID", "KEYTEST00")
    monkeypatch.setenv("TIXBAM_APPLE_PRIVATE_KEY", "dummy-key-for-mocked-exchange")
    app, engine, _ = setup_api()
    import app.oauth as oauth
    monkeypatch.setattr(oauth, "exchange_code", lambda p, c, code, flow: {
        "sub": "apple-user", "email": "apple@example.com", "email_verified": "true",
        "nonce": flow.nonce})
    with TestClient(app) as client:
        payload = client.post("/v1/auth/oauth/start", json={
            "provider": "apple", "codeChallenge": challenge_for("apple" * 11)}).json()
        qs = parse_qs(urlsplit(payload["authorizationUrl"]).query)
        assert qs["response_mode"] == ["form_post"]
        assert qs["redirect_uri"] == ["https://tixbam-production.up.railway.app/v1/auth/oauth/apple/callback"]
        assert client.post("/v1/auth/oauth/apple/callback", data={
            "code": "real-code", "state": qs["state"][0],
            "user": '{"name":{"firstName":"Apple","lastName":"Fan"}}'}).status_code == 200
        claim = client.post("/v1/auth/oauth/complete", json={
            "flowId": payload["flowId"], "verifier": "apple" * 11})
        assert claim.status_code == 200
        assert claim.json()["user"]["displayName"] == "Apple Fan"
        bad = client.post("/v1/auth/oauth/start", json={
            "provider": "apple", "codeChallenge": challenge_for("another" * 8)}).json()
        monkeypatch.setattr(oauth, "exchange_code", lambda p, c, code, flow: {
            "sub": "attacker", "nonce": "incorrect"})
        assert client.post("/v1/auth/oauth/apple/callback", data={
            "code": "other-code",
            "state": parse_qs(urlsplit(bad["authorizationUrl"]).query)["state"][0]}).status_code == 400
        assert client.post("/v1/auth/oauth/complete", json={
            "flowId": bad["flowId"], "verifier": "another" * 8}).status_code == 400
    engine.dispose()


def test_demo_users_purged_but_real_social_users_remain(monkeypatch):
    configured_google(monkeypatch)
    from app.accounts import purge_development_accounts
    from app.models import User, UserIdentity
    _, engine, Session = setup_api()
    with Session() as db:
        legacy = User(display_name="Demo One")
        kept = User(display_name="Social and Demo")
        db.add_all([legacy, kept])
        db.flush()
        db.add_all([
            UserIdentity(user_id=legacy.id, provider="development", subject="fan-one"),
            UserIdentity(user_id=kept.id, provider="development", subject="fan-two"),
            UserIdentity(user_id=kept.id, provider="google", subject="real-sub"),
        ])
        db.commit()
        old_id, kept_id = legacy.id, kept.id
    with Session() as db:
        purge_development_accounts(db)
        assert db.get(User, old_id) is None
        assert db.get(User, kept_id) is not None
        ids = db.query(UserIdentity).all()
        assert [(x.provider, x.subject) for x in ids] == [("google", "real-sub")]
    engine.dispose()


def test_no_provider_credentials_fails_closed(monkeypatch):
    monkeypatch.delenv("TIXBAM_GOOGLE_CLIENT_ID", raising=False)
    monkeypatch.delenv("TIXBAM_GOOGLE_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("TIXBAM_APPLE_CLIENT_ID", raising=False)
    monkeypatch.delenv("TIXBAM_APPLE_TEAM_ID", raising=False)
    monkeypatch.delenv("TIXBAM_APPLE_KEY_ID", raising=False)
    monkeypatch.delenv("TIXBAM_APPLE_PRIVATE_KEY", raising=False)
    app, engine, _ = setup_api()
    with TestClient(app) as client:
        assert client.get("/v1/auth/methods").json() == {"google": False, "apple": False}
        assert client.post("/v1/auth/oauth/start", json={
            "provider": "google", "codeChallenge": "a" * 43}).status_code == 503
    engine.dispose()
