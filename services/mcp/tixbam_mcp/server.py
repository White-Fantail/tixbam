"""Mountable, OAuth-protected TixBam Streamable HTTP MCP server."""
from typing import Any
from urllib.parse import urlparse

from mcp.server import MCPServer
from mcp.server.auth.settings import AuthSettings
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import Tool as MCPTool, ListToolsResult
from pydantic import AnyHttpUrl, Field
from starlette.responses import JSONResponse
from starlette.routing import Route

from .auth import JWTVerifier, MCPConfig, READ_SCOPE, WRITE_SCOPE
from .tools import register_tools

WRITE_TOOLS = {
    "create_artist", "update_artist",
    "create_event", "update_event",
    "create_ticket_sale", "update_ticket_sale",
}


class SecuredTool(MCPTool):
    """OpenAI MCP extension: declare OAuth scopes on each tool."""
    security_schemes: list[dict[str, Any]] = Field(alias="securitySchemes")


class SecuredListToolsResult(ListToolsResult):
    tools: list[SecuredTool]


class TixBamMCPServer(MCPServer):
    async def _handle_list_tools(self, ctx, params) -> ListToolsResult:
        # Preserve securitySchemes when Pydantic serializes ListToolsResult.
        return SecuredListToolsResult(tools=await self.list_tools())

    async def list_tools(self) -> list[MCPTool]:
        tools = await super().list_tools()
        secured: list[MCPTool] = []
        for tool in tools:
            scopes = [READ_SCOPE, WRITE_SCOPE] if tool.name in WRITE_TOOLS else [READ_SCOPE]
            secured.append(SecuredTool(
                **tool.model_dump(by_alias=True),
                securitySchemes=[{"type": "oauth2", "scopes": scopes}],
            ))
        return secured


def build_mcp(config: MCPConfig):
    mcp = TixBamMCPServer(
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
    asgi_app = mcp.streamable_http_app(
        json_response=True,
        stateless_http=True,
        host="0.0.0.0",
        transport_security=security,
    )

    # The MCP SDK publishes URL-path-specific PRM; additionally publish the
    # top-level RFC 9728 endpoint advertised in OpenAI's plugin setup.
    # Make both endpoints list the write scope without requiring it for reads.
    async def protected_resource_metadata(_request):
        return JSONResponse({
            "resource": config.resource_url,
            "authorization_servers": [config.issuer_url],
            "scopes_supported": [READ_SCOPE, WRITE_SCOPE],
            "bearer_methods_supported": ["header"],
            "resource_name": "TixBam",
        })

    for metadata_path in (
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
    ):
        asgi_app.routes.insert(
            0, Route(metadata_path, endpoint=protected_resource_metadata, methods=["GET"])
        )
    return mcp, asgi_app
