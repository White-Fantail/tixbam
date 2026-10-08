"""Mountable, OAuth-protected TixBam Streamable HTTP MCP server."""
import json
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
    "create_performance", "update_performance",
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



class ToolSchemeWireAdapter:
    """Serialize the ChatGPT securitySchemes extension on MCP tool-list replies.

    MCP SDK 2.3 serializes JSON-RPC results through a base model that strips
    subclass-only fields. This adapter touches successful, finite JSON HTTP
    responses only, after the SDK's own authentication and execution.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        response_start = None
        chunks = []
        buffered = False

        async def send_with_schemes(message):
            nonlocal response_start, buffered
            if message["type"] == "http.response.start":
                content_type = next(
                    (value for name, value in message.get("headers", [])
                     if name.lower() == b"content-type"),
                    b"",
                )
                buffered = message["status"] == 200 and b"application/json" in content_type
                if buffered:
                    response_start = message
                else:
                    await send(message)
                return

            if message["type"] != "http.response.body" or not buffered:
                await send(message)
                return

            chunks.append(message.get("body", b""))
            if message.get("more_body", False) and sum(map(len, chunks)) < 4_194_304:
                return

            body = b"".join(chunks)
            try:
                data = json.loads(body)
                tools = data.get("result", {}).get("tools")
                if isinstance(tools, list):
                    for tool in tools:
                        if not isinstance(tool, dict) or not isinstance(tool.get("name"), str):
                            continue
                        scope_names = [READ_SCOPE, WRITE_SCOPE] if tool["name"] in WRITE_TOOLS else [READ_SCOPE]
                        tool["securitySchemes"] = [{"type": "oauth2", "scopes": scope_names}]
                    body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
            except (ValueError, TypeError, AttributeError):
                pass

            headers = [(name, value) for name, value in response_start["headers"]
                       if name.lower() != b"content-length"]
            headers.append((b"content-length", str(len(body)).encode()))
            await send({**response_start, "headers": headers})
            await send({"type": "http.response.body", "body": body, "more_body": False})
            buffered = False

        await self.app(scope, receive, send_with_schemes)


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
    return mcp, ToolSchemeWireAdapter(asgi_app)
