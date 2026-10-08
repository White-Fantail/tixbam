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
    # A single official tour notice may describe multiple events and sessions.
    other = catalog.create_event(
        artist_id, "Another Concert", "https://official.example.com/day6/hk")
    assert other["created"] is True
    with pytest.raises(ValueError):
        catalog.create_event(
            artist_id, "Invalid", "http://example.com/bad"
        )
    changed = catalog.update_event(
        event_id, starts_at_local="2027-01-16T20:00", timezone="Asia/Hong_Kong"
    )
    assert changed["startsAt"] == "2027-01-16T12:00:00Z"
    assert len(catalog.performances(event_id)["items"]) == 1
    second = catalog.create_performance(event_id, "saturday-evening", "Evening",
          starts_at_local="2027-01-16T22:00", timezone="Asia/Hong_Kong")
    assert second["startsAt"] == "2027-01-16T14:00:00Z"
    assert len(catalog.performances(event_id)["items"]) == 2

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
    scoped = catalog.update_sale(sale["sale"]["id"],
                                 performance_ids=[second["id"]], applies_to_all=False)
    assert scoped["performanceIds"] == [second["id"]]
    assert scoped["appliesToAll"] is False
    # Metadata-only changes must retain session targeting.
    metadata_only = catalog.update_sale(
        sale["sale"]["id"], booking_url="https://www.cityline.com.hk/new-listing"
    )
    assert metadata_only["performanceIds"] == [second["id"]]
    assert metadata_only["appliesToAll"] is False
    # Scope changes without the required session IDs must fail.
    with pytest.raises(ValueError):
        catalog.update_sale(sale["sale"]["id"], performance_ids=[], applies_to_all=False)
    widened = catalog.update_sale(sale["sale"]["id"], applies_to_all=True)
    assert widened["appliesToAll"] is True and widened["performanceIds"] == []
    assert next(x for x in catalog.events(artist_id)["items"] if x["id"] == event_id)["sales"][0]["id"] == sale["sale"]["id"]


def test_provider_mcp_registration_and_updates(catalog):
    from pydantic import ValidationError
    assert not any(p["id"] == "fresh-agent" for p in catalog.providers(True)["items"])
    registered = catalog.create_provider(
        provider_id="fresh-agent", name="Fresh Agent", url="https://tickets.example.net",
        region="New Zealand", country="NZ", allowed_hosts=["tickets.example.net"],
        capabilities=["browser"], published=False,
    )
    assert registered["created"] is True
    assert registered["provider"]["published"] is False
    assert catalog.provider("fresh-agent")["name"] == "Fresh Agent"
    assert not any(p["id"] == "fresh-agent" for p in catalog.providers()["items"])
    assert any(p["id"] == "fresh-agent" for p in catalog.providers(True)["items"])
    with pytest.raises(ValueError, match="already exists"):
        catalog.create_provider("fresh-agent", "Duplicate", "https://tickets.example.net")
    with pytest.raises(ValidationError):
        catalog.create_provider("bad-host", "Bad", "http://tickets.example.net")
    updated = catalog.update_provider(
        "fresh-agent", name="Fresh Tickets", published=True,
        allowed_hosts=["tickets.example.net"],
    )
    assert updated["name"] == "Fresh Tickets"
    assert updated["published"] is True
    assert updated["capabilities"] == ["browser"]
    assert any(p["id"] == "fresh-agent" for p in catalog.providers()["items"])
    with pytest.raises(ValueError, match="not found"):
        catalog.update_provider("not-registered", name="Never")


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


def test_mcp_discovery_and_tool_scopes():
    import asyncio
    from contextlib import asynccontextmanager
    from fastapi.testclient import TestClient
    from starlette.applications import Starlette
    from starlette.routing import Mount

    config = MCPConfig(
        "https://testserver/mcp", "https://auth.example.com/",
        "https://auth.example.com/jwks", "owner-subject",
    )
    server, subapp = build_mcp(config)
    result = asyncio.run(server._handle_list_tools(None, None))
    wire_tools = {item["name"]: item for item in result.model_dump(by_alias=True)["tools"]}
    assert wire_tools["search_artists"]["securitySchemes"] == [
        {"type": "oauth2", "scopes": [READ_SCOPE]}
    ]
    assert wire_tools["create_event"]["securitySchemes"] == [
        {"type": "oauth2", "scopes": [READ_SCOPE, WRITE_SCOPE]}
    ]
    for tool_name in ("create_provider", "update_provider"):
        assert wire_tools[tool_name]["securitySchemes"] == [
            {"type": "oauth2", "scopes": [READ_SCOPE, WRITE_SCOPE]}
        ]
    assert wire_tools["get_provider"]["securitySchemes"] == [
        {"type": "oauth2", "scopes": [READ_SCOPE]}
    ]
    assert wire_tools["list_providers"]["securitySchemes"] == [
        {"type": "oauth2", "scopes": [READ_SCOPE]}
    ]
    update_sale_tool = wire_tools["update_ticket_sale"]
    assert update_sale_tool["securitySchemes"] == [
        {"type": "oauth2", "scopes": [READ_SCOPE, WRITE_SCOPE]}
    ]
    sale_fields = update_sale_tool["inputSchema"]["properties"]
    assert sale_fields["performance_ids"]["anyOf"][0]["type"] == "array"
    assert sale_fields["applies_to_all"]["anyOf"][0]["type"] == "boolean"
    assert {"performance_ids", "applies_to_all"}.isdisjoint(
        set(update_sale_tool["inputSchema"].get("required", []))
    )

    @asynccontextmanager
    async def lifespan(_app):
        async with server.session_manager.run():
            yield

    app = Starlette(routes=[Mount("/", app=subapp)], lifespan=lifespan)
    with TestClient(app) as client:
        for suffix in (
            "/.well-known/oauth-protected-resource",
            "/.well-known/oauth-protected-resource/mcp",
        ):
            response = client.get(suffix)
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["resource"] == config.resource_url
            assert data["authorization_servers"] == [config.issuer_url]
            assert data["scopes_supported"] == [READ_SCOPE, WRITE_SCOPE]


def test_authenticated_http_tool_listing_exposes_scopes(monkeypatch):
    from contextlib import asynccontextmanager
    from fastapi.testclient import TestClient
    from starlette.applications import Starlette
    from starlette.routing import Mount

    config = MCPConfig(
        "https://testserver/mcp", "https://auth.example.com/",
        "https://auth.example.com/jwks", "owner-subject",
    )
    server, subapp = build_mcp(config)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    verifier = server._token_verifier
    monkeypatch.setattr(verifier.keys, "get_signing_key_from_jwt",
                        lambda token: SimpleNamespace(key=key.public_key()))
    now = int(time.time())
    token = jwt.encode({
        "iss": config.issuer_url, "aud": config.resource_url,
        "sub": config.owner_sub, "iat": now, "exp": now + 600,
        "scope": f"{READ_SCOPE} {WRITE_SCOPE}",
    }, key, algorithm="RS256")

    @asynccontextmanager
    async def lifespan(_app):
        async with server.session_manager.run():
            yield

    app = Starlette(routes=[Mount("/", app=subapp)], lifespan=lifespan)
    headers = {
        "Authorization": "Bearer " + token,
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    with TestClient(app) as client:
        initialize = client.post("/mcp", headers=headers, json={
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "ChatGPT", "version": "1"},
            },
        })
        assert initialize.status_code == 200, initialize.text
        listing = client.post("/mcp", headers=headers, json={
            "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {},
        })
        assert listing.status_code == 200, listing.text
        tools = {item["name"]: item for item in listing.json()["result"]["tools"]}
        assert tools["list_events"]["securitySchemes"][0]["scopes"] == [READ_SCOPE]
        assert tools["create_ticket_sale"]["securitySchemes"][0]["scopes"] == [READ_SCOPE, WRITE_SCOPE]
