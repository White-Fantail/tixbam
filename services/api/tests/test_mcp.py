"""MCP catalog and OAuth safety regression tests (no external services)."""
import asyncio
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.seed import seed_providers
from tixbam_mcp.auth import JWTVerifier, MCPConfig, READ_SCOPE, WRITE_SCOPE
from tixbam_mcp.catalog import Catalog
from tixbam_mcp.server import build_mcp


@pytest.fixture
def catalog(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    with Session() as db:
        seed_providers(db)
    monkeypatch.setattr("tixbam_mcp.catalog.SessionLocal", Session)
    yield Catalog()
    engine.dispose()


def test_mcp_is_disabled_when_oauth_not_configured(monkeypatch):
    for key in ("TIXBAM_MCP_RESOURCE_URL", "TIXBAM_MCP_OAUTH_ISSUER",
                "TIXBAM_MCP_OAUTH_JWKS_URL", "TIXBAM_MCP_OWNER_SUB"):
        monkeypatch.delenv(key, raising=False)
    assert MCPConfig.from_env() is None
    monkeypatch.setenv("TIXBAM_MCP_RESOURCE_URL", "https://example.com/mcp")
    assert MCPConfig.from_env() is None


def test_mcp_config_checks_urls(monkeypatch):
    monkeypatch.setenv("TIXBAM_MCP_RESOURCE_URL", "http://example.com/mcp")
    monkeypatch.setenv("TIXBAM_MCP_OAUTH_ISSUER", "https://auth.example.com/")
    monkeypatch.setenv("TIXBAM_MCP_OAUTH_JWKS_URL", "https://auth.example.com/jwks")
    monkeypatch.setenv("TIXBAM_MCP_OWNER_SUB", "owner")
    with pytest.raises(ValueError, match="HTTPS"):
        MCPConfig.from_env()


def test_catalog_idempotency_and_timezones(catalog):
    artist = catalog.create_artist("DAY6", country="KR")
    assert artist["created"] is True
    artist_id = artist["artist"]["id"]
    assert catalog.create_artist("day6")["created"] is False
    assert len(catalog.artists("day")["items"]) == 1

    event = catalog.create_event(
        artist_id, "Hong Kong Concert", "https://official.example.com/day6/hk",
        city="Hong Kong", country="HK", venue="AsiaWorld",
        starts_at_local="2027-01-15T20:00", timezone="Asia/Hong_Kong",
    )
    assert event["created"] is True
    event_id = event["event"]["id"]
    assert event["event"]["startsAt"] == "2027-01-15T12:00:00Z"
    assert catalog.create_event(
        artist_id, "Hong Kong Concert", "https://official.example.com/day6/hk"
    )["created"] is False
    with pytest.raises(ValueError, match="already assigned"):
        catalog.create_event(
            artist_id, "Another Concert", "https://official.example.com/day6/hk"
        )
    with pytest.raises(ValueError):
        catalog.create_event(
            artist_id, "Invalid", "http://example.com/bad"
        )
    changed = catalog.update_event(
        event_id, starts_at_local="2027-01-16T20:00", timezone="Asia/Hong_Kong"
    )
    assert changed["startsAt"] == "2027-01-16T12:00:00Z"

    sale = catalog.create_sale(
        event_id, "cityline", "https://www.cityline.com.hk/",
        sale_at_local="2027-01-05T10:00", timezone="Asia/Hong_Kong"
    )
    assert sale["created"] is True
    assert sale["sale"]["saleAt"] == "2027-01-05T02:00:00Z"
    assert catalog.create_sale(
        event_id, "cityline", "https://www.cityline.com.hk/",
        sale_at_local="2027-01-05T10:00", timezone="Asia/Hong_Kong"
    )["created"] is False
    modified = catalog.update_sale(
        sale["sale"]["id"], sale_at_local="2027-01-06T10:00",
        timezone="Asia/Hong_Kong"
    )
    assert modified["saleAt"] == "2027-01-06T02:00:00Z"
    assert catalog.events(artist_id)["items"][0]["sales"][0]["id"] == sale["sale"]["id"]


def test_oauth_token_checks_signature_audience_owner_expiry_and_scope(monkeypatch):
    config = MCPConfig(
        "https://tixbam.example.com/mcp",
        "https://auth.example.com/",
        "https://auth.example.com/jwks",
        "owner-subject",
    )
    secret = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    verifier = JWTVerifier(config)
    monkeypatch.setattr(
        verifier.keys, "get_signing_key_from_jwt",
        lambda token: SimpleNamespace(key=secret.public_key()),
    )
    now = int(time.time())
    base = {
        "iss": config.issuer_url,
        "aud": config.resource_url,
        "sub": config.owner_sub,
        "iat": now,
        "exp": now + 600,
        "scope": f"{READ_SCOPE} {WRITE_SCOPE}",
        "azp": "chatgpt-test",
    }

    async def verify(claims):
        return await verifier.verify_token(jwt.encode(claims, secret, algorithm="RS256"))

    token = asyncio.run(verify(base))
    assert token is not None and token.subject == "owner-subject"
    assert WRITE_SCOPE in token.scopes
    for change in (
        {"aud": "https://somewhere-else.example/mcp"},
        {"sub": "someone-else"},
        {"exp": now - 300},
        {"scope": WRITE_SCOPE},
    ):
        assert asyncio.run(verify({**base, **change})) is None
    assert asyncio.run(verifier.verify_token("not-a-jwt")) is None


def test_mcp_mount_enforces_bearer_auth():
    from contextlib import asynccontextmanager
    from fastapi.testclient import TestClient
    from starlette.applications import Starlette
    from starlette.routing import Mount

    config = MCPConfig(
        "https://testserver/mcp",
        "https://auth.example.com/",
        "https://auth.example.com/jwks",
        "owner-subject",
    )
    server, subapp = build_mcp(config)

    @asynccontextmanager
    async def lifespan(_app):
        async with server.session_manager.run():
            yield

    app = Starlette(routes=[Mount("/", app=subapp)], lifespan=lifespan)
    with TestClient(app) as client:
        response = client.post("/mcp", json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "test", "version": "1"},
            },
        }, headers={"Accept": "application/json, text/event-stream"})
        assert response.status_code in (401, 403)
