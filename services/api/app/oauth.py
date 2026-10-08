"""Browser OAuth: authorization-code exchange on the API, verified identity,
short-lived server-side handoff to Electron bound to a desktop-held verifier.

All provider secrets stay on the backend; no provider access or refresh token
is persisted. Login flows work across multiple API workers using the shared DB.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from urllib.parse import urlencode, parse_qs

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .accounts import create_session, identity_user, verified_social_claims, session_secret
from .db import get_db
from .models import OAuthLoginFlow, User

router = APIRouter(prefix="/v1/auth/oauth", tags=["OAuth"])
Db = Annotated[Session, Depends(get_db)]
TTL = timedelta(minutes=5)
CHALLENGE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")


def utc(value):
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def base64url(raw):
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def challenge_for(verifier: str):
    return base64url(hashlib.sha256(verifier.encode("ascii")).digest())


def callback_url(provider, origin):
    return origin + "/v1/auth/oauth/" + provider + "/callback"


def provider_config(provider):
    """Only accept a configured, server-owned origin, never request Host."""
    try:
        session_secret()
    except HTTPException:
        return None
    origin = os.getenv("TIXBAM_PUBLIC_URL", "https://tixbam-production.up.railway.app").strip().rstrip("/")
    try:
        from urllib.parse import urlsplit
        parsed = urlsplit(origin)
        local = (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")
                 and os.getenv("TIXBAM_AUTH_MODE") == "development")
        if (not origin or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path not in ("", "/")
                or (parsed.scheme != "https" and not local)):
            return None
        if provider == "apple" and parsed.scheme != "https":
            return None
        if provider == "google":
            cid = os.getenv("TIXBAM_GOOGLE_CLIENT_ID", "").strip()
            secret = os.getenv("TIXBAM_GOOGLE_CLIENT_SECRET", "").strip()
            if not cid or not secret: return None
            return {"origin": origin, "client_id": cid, "client_secret": secret}
        if provider == "apple":
            cid = os.getenv("TIXBAM_APPLE_CLIENT_ID", "").strip()
            team = os.getenv("TIXBAM_APPLE_TEAM_ID", "").strip()
            kid = os.getenv("TIXBAM_APPLE_KEY_ID", "").strip()
            key = os.getenv("TIXBAM_APPLE_PRIVATE_KEY", "").replace("\\n", "\n").strip()
            if not all((cid, team, kid, key)): return None
            return {"origin": origin, "client_id": cid, "team": team, "key_id": kid, "key": key}
    except ValueError:
        return None
    return None


class BeginLogin(BaseModel):
    provider: Literal["google", "apple"]
    codeChallenge: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$", min_length=43, max_length=43)


class CompleteLogin(BaseModel):
    flowId: str = Field(min_length=36, max_length=36)
    verifier: str = Field(pattern=r"^[A-Za-z0-9_-]{43,128}$", min_length=43, max_length=128)


def sign_in_url(provider, config, flow):
    redirect_uri = callback_url(provider, config["origin"])
    params = dict(client_id=config["client_id"], redirect_uri=redirect_uri,
                  response_type="code", state=flow.state, nonce=flow.nonce)
    if provider == "google":
        params.update(scope="openid email profile", access_type="online",
                      code_challenge=challenge_for(flow.provider_verifier),
                      code_challenge_method="S256")
        host = "https://accounts.google.com/o/oauth2/v2/auth"
    else:
        params.update(scope="name email", response_mode="form_post")
        host = "https://appleid.apple.com/auth/authorize"
    return host + "?" + urlencode(params)


@router.post("/start")
def start_login(payload: BeginLogin, db: Db):
    config = provider_config(payload.provider)
    if not config:
        raise HTTPException(503, detail="Social login is not configured for this provider")
    now = datetime.now(timezone.utc)
    db.execute(delete(OAuthLoginFlow).where(OAuthLoginFlow.expires_at < now - timedelta(hours=1)))
    flow = OAuthLoginFlow(
        provider=payload.provider, state=secrets.token_urlsafe(32),
        nonce=secrets.token_urlsafe(32), client_challenge=payload.codeChallenge,
        provider_verifier=secrets.token_urlsafe(48), expires_at=now + TTL)
    db.add(flow)
    db.commit()
    return {"flowId": flow.id, "authorizationUrl": sign_in_url(payload.provider, config, flow),
            "expiresIn": int(TTL.total_seconds())}


def apple_client_secret(config):
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"iss": config["team"], "iat": now, "exp": now + timedelta(minutes=5),
         "aud": "https://appleid.apple.com", "sub": config["client_id"]},
        config["key"], algorithm="ES256", headers={"kid": config["key_id"]})


def exchange_code(provider, config, code, flow):
    url = ("https://oauth2.googleapis.com/token" if provider == "google"
           else "https://appleid.apple.com/auth/token")
    data = dict(client_id=config["client_id"], grant_type="authorization_code",
                code=code, redirect_uri=callback_url(provider, config["origin"]))
    try:
        if provider == "google":
            data["client_secret"] = config["client_secret"]
            data["code_verifier"] = flow.provider_verifier
        else:
            data["client_secret"] = apple_client_secret(config)
        with httpx.Client(timeout=8.0) as client:
            reply = client.post(url, data=data)
            reply.raise_for_status()
            body = reply.json()
        id_token = body.get("id_token")
        if not isinstance(id_token, str):
            raise ValueError("Provider did not issue an ID token")
        return verified_social_claims(provider, id_token)
    except (httpx.HTTPError, ValueError, TypeError, AttributeError, jwt.PyJWTError) as exc:
        raise HTTPException(401, detail="Could not verify the provider sign-in") from exc


def completion_page(ok):
    status_text = "Signed in successfully" if ok else "Sign-in was not completed"
    description = ("Return to TIXBAM. This tab can now be closed." if ok
                   else "Return to TIXBAM and try signing in again.")
    return HTMLResponse(
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<meta http-equiv='Cache-Control' content='no-store'>"
        "<title>TIXBAM sign in</title></head><body style='font:16px system-ui;"
        "max-width:480px;margin:18vh auto;padding:20px;background:#15151f;color:white'>"
        "<h1>" + status_text + "</h1><p>" + description + "</p></body></html>",
        status_code=200 if ok else 400, headers={"Cache-Control": "no-store"})


def handle_callback(provider, state, code, error, db, apple_user=None):
    # Any state mismatch (including unknown/cross-provider states) is rejected.
    if not isinstance(state, str) or not state or len(state) > 128:
        return completion_page(False)
    flow = db.scalar(select(OAuthLoginFlow).where(OAuthLoginFlow.state == state).with_for_update())
    if (not flow or flow.provider != provider or flow.status != "pending"
            or utc(flow.expires_at) <= datetime.now(timezone.utc)):
        return completion_page(False)
    if error or not code or not isinstance(code, str) or len(code) > 4096:
        flow.status, flow.failure = "failed", "Sign-in cancelled or denied"
        db.commit()
        return completion_page(False)
    config = provider_config(provider)
    if not config:
        flow.status, flow.failure = "failed", "Provider is no longer configured"
        db.commit()
        return completion_page(False)
    # Claim the callback before external network I/O, then release the row
    # lock so desktop polls immediately receive 202 rather than timing out.
    flow.status = "processing"
    db.commit()
    try:
        claims = exchange_code(provider, config, code, flow)
        if not hmac.compare_digest(str(claims.get("nonce") or ""), flow.nonce):
            raise ValueError("OAuth nonce mismatch")
        name = claims.get("name") or "TIXBAM Fan"
        if provider == "apple" and apple_user:
            try:
                detail = json.loads(apple_user)
                person = detail.get("name") or {}
                supplied = " ".join(filter(None, (person.get("firstName"), person.get("lastName"))))
                if supplied: name = supplied
            except (ValueError, AttributeError, TypeError):
                pass
        verified_email = claims.get("email") if claims.get("email_verified") in (True, "true") else None
        user = identity_user(db, provider, claims["sub"], str(name), verified_email)
        flow.user_id, flow.status = user.id, "completed"
        db.commit()
        return completion_page(True)
    except (HTTPException, ValueError, KeyError, TypeError):
        db.rollback()
        flow = db.scalar(select(OAuthLoginFlow).where(OAuthLoginFlow.state == state))
        if flow and flow.status in ("pending", "processing"):
            flow.status, flow.failure = "failed", "Identity verification failed"
            db.commit()
        return completion_page(False)


@router.get("/google/callback", response_class=HTMLResponse)
def google_callback(db: Db, state: str = "", code: str = "", error: str = ""):
    return handle_callback("google", state, code, error, db)


@router.post("/apple/callback", response_class=HTMLResponse)
async def apple_callback(request: Request, db: Db):
    if not request.headers.get("content-type", "").lower().startswith("application/x-www-form-urlencoded"):
        return completion_page(False)
    body = await request.body()
    if len(body) > 20_000:
        return completion_page(False)
    try:
        params = parse_qs(body.decode("utf-8"), keep_blank_values=True, max_num_fields=10)
        def value(name):
            items = params.get(name, [""])
            return items[0] if len(items) == 1 else ""
        return handle_callback("apple", value("state"), value("code"), value("error"),
                               db, apple_user=value("user")[:8000])
    except (UnicodeError, ValueError):
        return completion_page(False)


@router.post("/complete")
def complete_login(payload: CompleteLogin, db: Db):
    flow = db.scalar(select(OAuthLoginFlow).where(OAuthLoginFlow.id == payload.flowId).with_for_update())
    if not flow:
        raise HTTPException(404, detail="Sign-in attempt not found")
    if not hmac.compare_digest(challenge_for(payload.verifier), flow.client_challenge):
        raise HTTPException(403, detail="Sign-in verifier mismatch")
    if utc(flow.expires_at) <= datetime.now(timezone.utc):
        db.delete(flow)
        db.commit()
        raise HTTPException(410, detail="Sign-in expired. Please try again")
    if flow.status in ("pending", "processing"):
        return JSONResponse({"status": "pending"}, status_code=202, headers={"Cache-Control":"no-store"})
    if flow.status != "completed" or not flow.user_id:
        db.delete(flow)
        db.commit()
        raise HTTPException(400, detail="Sign-in cancelled or verification failed")
    user = db.get(User, flow.user_id)
    if user is None:
        raise HTTPException(404, detail="Account not found")
    result = create_session(user)
    db.delete(flow)
    db.commit()
    return JSONResponse(result, headers={"Cache-Control":"no-store"})
