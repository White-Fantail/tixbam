"""Validate OAuth 2 access tokens issued for TixBam's MCP resource.

An external, standards-compliant OAuth provider is required. The existing
TIXBAM_ADMIN_API_KEY is never accepted as an MCP bearer token.
"""
import asyncio
import os
from dataclasses import dataclass
from urllib.parse import urlparse

import jwt
from jwt import PyJWKClient
from mcp.server.auth.provider import AccessToken, TokenVerifier

READ_SCOPE = "tixbam:read"
WRITE_SCOPE = "tixbam:write"


def _https_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username and not parsed.password and not parsed.fragment


@dataclass(frozen=True)
class MCPConfig:
    resource_url: str
    issuer_url: str
    jwks_url: str
    owner_sub: str

    @classmethod
    def from_env(cls) -> "MCPConfig | None":
        names = (
            "TIXBAM_MCP_RESOURCE_URL",
            "TIXBAM_MCP_OAUTH_ISSUER",
            "TIXBAM_MCP_OAUTH_JWKS_URL",
            "TIXBAM_MCP_OWNER_SUB",
        )
        values = [os.getenv(name, "").strip() for name in names]
        if not all(values):
            return None  # fail closed until all OAuth settings are present
        resource, issuer, jwks, subject = values
        if not all(_https_url(url) for url in (resource, issuer, jwks)):
            raise ValueError("MCP OAuth URLs must be HTTPS URLs")
        if urlparse(resource).path.rstrip("/") != "/mcp":
            raise ValueError("TIXBAM_MCP_RESOURCE_URL must end with /mcp")
        return cls(resource.rstrip("/"), issuer, jwks, subject)


class JWTVerifier(TokenVerifier):
    """Allow only the configured owner and RS256 JWTs for this exact resource."""

    def __init__(self, config: MCPConfig):
        self.config = config
        self.keys = PyJWKClient(config.jwks_url, cache_keys=True, timeout=5)

    async def verify_token(self, token: str) -> AccessToken | None:
        if not token or len(token) > 10000:
            return None
        try:
            key = await asyncio.to_thread(self.keys.get_signing_key_from_jwt, token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["RS256"],
                issuer=self.config.issuer_url,
                audience=self.config.resource_url,
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
                leeway=30,
            )
        except (jwt.PyJWTError, ValueError, OSError):
            return None

        if claims.get("sub") != self.config.owner_sub:
            return None
        scopes = set(str(claims.get("scope", "")).split())
        permissions = claims.get("permissions", [])
        if isinstance(permissions, list):
            scopes.update(p for p in permissions if isinstance(p, str))
        if READ_SCOPE not in scopes:
            return None
        return AccessToken(
            token=token,
            client_id=str(claims.get("azp") or claims.get("client_id") or "chatgpt"),
            subject=claims["sub"],
            scopes=sorted(scopes),
            expires_at=int(claims["exp"]),
            resource=self.config.resource_url,
        )
