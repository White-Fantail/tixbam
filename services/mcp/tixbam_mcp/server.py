"""Mountable, OAuth-protected TixBam Streamable HTTP MCP server."""
from urllib.parse import urlparse

from mcp.server import MCPServer
from mcp.server.auth.settings import AuthSettings
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import AnyHttpUrl

from .auth import JWTVerifier, MCPConfig, READ_SCOPE
from .tools import register_tools


def build_mcp(config: MCPConfig):
    mcp = MCPServer(
        "TixBam",
        instructions=(
            "Read TixBam's artist, event and sale catalog. Only register concert "
            "details verified against official sources; never invent dates, ticket "
            "providers or booking URLs. Ask before modifying records."
        ),
        token_verifier=JWTVerifier(config),
        auth=AuthSettings(
            issuer_url=AnyHttpUrl(config.issuer_url),
            resource_server_url=AnyHttpUrl(config.resource_url),
            required_scopes=[READ_SCOPE],
            validate_token_resource=True,
        ),
    )
    register_tools(mcp, config)
    host = urlparse(config.resource_url).hostname
    security = TransportSecuritySettings(
        allowed_hosts=[host, f"{host}:*", "localhost:*", "127.0.0.1:*", "testserver:*"],
        allowed_origins=["https://chatgpt.com"],
    )
    # Mount this child app at "/" AFTER the API routes. The child handles /mcp
    # and /.well-known/oauth-protected-resource. No second Railway service.
    asgi_app = mcp.streamable_http_app(
        json_response=True,
        stateless_http=True,
        host="0.0.0.0",
        transport_security=security,
    )
    return mcp, asgi_app
