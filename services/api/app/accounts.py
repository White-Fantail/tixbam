"""User accounts and cloud bookmarks. Never trust client-provided identity details.

Google/Apple identity tokens are verified against provider JWKS, issuer,
audience, nonce and expiry. Provider cookies and card data are never uploaded.
"""
import os
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Annotated, Literal
from uuid import UUID

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import Artist, Event, FavoriteArtist, FavoriteEvent, User, UserIdentity, UserWatchItem

router = APIRouter(prefix="/v1")
Db = Annotated[Session, Depends(get_db)]
SESSION_ISSUER = "tixbam-api"
SESSION_AUDIENCE = "tixbam-desktop"


def session_secret():
    secret = os.getenv("TIXBAM_SESSION_SECRET", "")
    if len(secret) < 32 or secret.startswith("replace-with-"):
        raise HTTPException(status_code=503, detail="User authentication is not configured")
    return secret


def create_session(user: User):
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {"sub": user.id, "iss": SESSION_ISSUER, "aud": SESSION_AUDIENCE,
         "iat": now, "exp": now + timedelta(days=7)},
        session_secret(), algorithm="HS256")
    return {"accessToken": token, "tokenType": "Bearer",
            "expiresAt": (now + timedelta(days=7)).isoformat().replace("+00:00", "Z"),
            "user": user_data(user)}


def user_data(user: User):
    return {"id": user.id, "displayName": user.display_name, "email": user.email,
            "providers": [identity.provider for identity in user.identities]}


def current_user(db: Db, authorization: Annotated[str | None, Header()] = None):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sign in to your TIXBAM account")
    try:
        claims = jwt.decode(
            authorization[7:], session_secret(), algorithms=["HS256"],
            audience=SESSION_AUDIENCE, issuer=SESSION_ISSUER,
            options={"require": ["sub", "exp", "iat", "iss", "aud"]})
        user_id = str(UUID(claims["sub"]))
    except (jwt.PyJWTError, ValueError, TypeError, KeyError):
        raise HTTPException(status_code=401, detail="Invalid or expired sign-in session")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Account not found")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def identity_user(db: Session, provider: str, subject: str, name: str, email: str | None):
    session_secret()  # Fail closed before creating an account when auth is unconfigured.
    identity = db.scalar(select(UserIdentity).where(
        UserIdentity.provider == provider, UserIdentity.subject == subject))
    if identity is None:
        user = User(display_name=name[:160], email=email[:320] if email else None)
        db.add(user)
        db.flush()
        db.add(UserIdentity(user_id=user.id, provider=provider, subject=subject))
        db.commit()
        db.refresh(user)
    else:
        user = db.get(User, identity.user_id)
    return user


def purge_development_accounts(db: Session):
    """Remove legacy fixed demo identities and their saved test data on startup."""
    identities = db.scalars(select(UserIdentity).where(
        UserIdentity.provider == "development",
        UserIdentity.subject.in_(("fan-one", "fan-two")))).all()
    for identity in identities:
        user = db.get(User, identity.user_id)
        if not user:
            db.delete(identity)
            continue
        if any(other.provider != "development" for other in user.identities):
            db.delete(identity)  # A real social identity may own this account.
        else:
            db.delete(user)  # Cascades only this demo account's test favorites.
    if identities:
        db.commit()


@router.get("/auth/methods")
def auth_methods():
    from .oauth import provider_config
    return {"google": provider_config("google") is not None,
            "apple": provider_config("apple") is not None}


@lru_cache(maxsize=2)
def jwks_client(provider: str):
    endpoint = ("https://www.googleapis.com/oauth2/v3/certs" if provider == "google"
                else "https://appleid.apple.com/auth/keys")
    return jwt.PyJWKClient(endpoint, timeout=5, cache_jwk_set=True, lifespan=300)


def verified_social_claims(provider: str, id_token: str):
    audience = os.getenv("TIXBAM_GOOGLE_CLIENT_ID" if provider == "google" else "TIXBAM_APPLE_CLIENT_ID")
    if not audience:
        raise HTTPException(status_code=503, detail="This social provider is not configured")
    issuer = ["https://accounts.google.com", "accounts.google.com"] if provider == "google" else "https://appleid.apple.com"
    try:
        key = jwks_client(provider).get_signing_key_from_jwt(id_token).key
        claims = jwt.decode(id_token, key, algorithms=["RS256"], audience=audience,
                            issuer=issuer, options={"require": ["sub", "exp", "iat", "iss", "aud"]})
    except (jwt.PyJWTError, ValueError, TypeError, OSError) as exc:
        raise HTTPException(status_code=401, detail="Invalid social identity token") from exc
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject or len(subject) > 255:
        raise HTTPException(status_code=401, detail="Invalid identity subject")
    return claims


@router.get("/me")
def me(user: CurrentUser, db: Db):
    artists = db.scalars(select(FavoriteArtist.artist_id).where(FavoriteArtist.user_id == user.id)).all()
    events = db.scalars(select(FavoriteEvent.event_id).where(FavoriteEvent.user_id == user.id)).all()
    watchlist = db.scalars(select(UserWatchItem).where(UserWatchItem.user_id == user.id)).all()
    from .booking_plans import account_extras
    return {"user": user_data(user), "favoriteArtistIds": artists, "favoriteEventIds": events,
            "watchlist": [dict(item.payload, id=item.id) for item in watchlist],
            **account_extras(db, user.id)}


@router.put("/me/artists/{artist_id}", status_code=204)
def add_artist(artist_id: UUID, user: CurrentUser, db: Db):
    key = str(artist_id)
    if not db.get(Artist, key):
        raise HTTPException(status_code=404, detail="Artist not found")
    if not db.get(FavoriteArtist, (user.id, key)):
        db.add(FavoriteArtist(user_id=user.id, artist_id=key))
        db.commit()
    return Response(status_code=204)


@router.delete("/me/artists/{artist_id}", status_code=204)
def remove_artist(artist_id: UUID, user: CurrentUser, db: Db):
    item = db.get(FavoriteArtist, (user.id, str(artist_id)))
    if item:
        db.delete(item)
        db.commit()
    return Response(status_code=204)


@router.put("/me/events/{event_id}", status_code=204)
def add_event(event_id: UUID, user: CurrentUser, db: Db):
    key = str(event_id)
    if not db.get(Event, key):
        raise HTTPException(status_code=404, detail="Event not found")
    if not db.get(FavoriteEvent, (user.id, key)):
        db.add(FavoriteEvent(user_id=user.id, event_id=key))
        db.commit()
    return Response(status_code=204)


@router.delete("/me/events/{event_id}", status_code=204)
def remove_event(event_id: UUID, user: CurrentUser, db: Db):
    item = db.get(FavoriteEvent, (user.id, str(event_id)))
    if item:
        db.delete(item)
        db.commit()
    return Response(status_code=204)


class WatchPayload(BaseModel):
    artist: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=250)
    city: str = Field("", max_length=160)
    providerId: str = Field(min_length=1, max_length=60)
    saleAt: str = Field("", max_length=40)
    url: str = Field("", max_length=2048)
    addedAt: str = Field(min_length=10, max_length=40)
    performanceId: str | None = Field(None, max_length=36)
    performanceAt: str | None = Field(None, max_length=40)
    eventId: str | None = Field(None, max_length=36)

    @field_validator("url")
    @classmethod
    def safe_url(cls, value: str):
        from urllib.parse import urlsplit
        if value:
            parsed = urlsplit(value)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError("Only HTTPS ticket URLs are permitted")
        return value


@router.put("/me/watchlist/{item_id}")
def upsert_watch(item_id: UUID, payload: WatchPayload, user: CurrentUser, db: Db):
    key = str(item_id)
    item = db.get(UserWatchItem, (user.id, key))
    if item is None:
        item = UserWatchItem(id=key, user_id=user.id, payload=payload.model_dump(exclude_none=True))
        db.add(item)
    else:
        item.payload = payload.model_dump(exclude_none=True)
    db.commit()
    return dict(item.payload, id=item.id)


@router.delete("/me/watchlist/{item_id}", status_code=204)
def delete_watch(item_id: UUID, user: CurrentUser, db: Db):
    item = db.get(UserWatchItem, (user.id, str(item_id)))
    if item:
        db.delete(item)
        db.commit()
    return Response(status_code=204)
