from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base


def now():
    return datetime.now(timezone.utc)


def uuid():
    return str(uuid4())


class Provider(Base):
    __tablename__ = "providers"
    id: Mapped[str] = mapped_column(String(60), primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    region: Mapped[str] = mapped_column(String(120), default="Global")
    country: Mapped[str] = mapped_column(String(8), default="GL")
    url: Mapped[str] = mapped_column(Text)
    allowed_hosts: Mapped[list] = mapped_column(JSON, default=list)
    automation: Mapped[dict] = mapped_column(JSON, default=dict)
    capabilities: Mapped[list] = mapped_column(JSON, default=list)
    version: Mapped[str] = mapped_column(String(60), default="1.0.0")
    description: Mapped[str] = mapped_column(Text, default="")
    published: Mapped[bool] = mapped_column(Boolean, default=True)
    artifact_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    artifact_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)


class Artist(Base):
    __tablename__ = "artists"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid)
    name: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    country: Mapped[str | None] = mapped_column(String(8), nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    events: Mapped[list["Event"]] = relationship(back_populates="artist")


class Event(Base):
    __tablename__ = "events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid)
    artist_id: Mapped[str] = mapped_column(ForeignKey("artists.id"), index=True)
    title: Mapped[str] = mapped_column(String(250))
    city: Mapped[str] = mapped_column(String(160), default="")
    country: Mapped[str] = mapped_column(String(8), default="")
    venue: Mapped[str | None] = mapped_column(Text, nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    artist: Mapped["Artist"] = relationship(back_populates="events")
    performances: Mapped[list["Performance"]] = relationship(back_populates="event", cascade="all, delete-orphan", order_by="Performance.created_at")
    sales: Mapped[list["TicketSale"]] = relationship(back_populates="event", cascade="all, delete-orphan")


class Performance(Base):
    """One physical show or fan-meeting session; many per city/venue event."""
    __tablename__ = "performances"
    __table_args__ = (UniqueConstraint("event_id", "session_key", name="uq_performance_session"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), index=True)
    session_key: Mapped[str] = mapped_column(String(160))
    label: Mapped[str] = mapped_column(String(160), default="")
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="scheduled")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    event: Mapped["Event"] = relationship(back_populates="performances")
    sale_links: Mapped[list["SalePerformance"]] = relationship(back_populates="performance", cascade="all, delete-orphan")


class SalePerformance(Base):
    __tablename__ = "sale_performances"
    sale_id: Mapped[str] = mapped_column(ForeignKey("ticket_sales.id", ondelete="CASCADE"), primary_key=True)
    performance_id: Mapped[str] = mapped_column(ForeignKey("performances.id", ondelete="CASCADE"), primary_key=True)
    sale: Mapped["TicketSale"] = relationship(back_populates="performance_links")
    performance: Mapped["Performance"] = relationship(back_populates="sale_links")


class TicketSale(Base):
    __tablename__ = "ticket_sales"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), index=True)
    provider_id: Mapped[str] = mapped_column(ForeignKey("providers.id"), index=True)
    sale_type: Mapped[str] = mapped_column(String(60), default="general")
    sale_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    city: Mapped[str | None] = mapped_column(String(160), nullable=True)
    country: Mapped[str | None] = mapped_column(String(8), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    booking_url: Mapped[str] = mapped_column(Text)
    applies_to_all: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    performance_links: Mapped[list["SalePerformance"]] = relationship(back_populates="sale", cascade="all, delete-orphan")
    event: Mapped["Event"] = relationship(back_populates="sales")
    provider: Mapped["Provider"] = relationship()


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid)
    display_name: Mapped[str] = mapped_column(String(160), default="")
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    identities: Mapped[list["UserIdentity"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    favorite_artists: Mapped[list["FavoriteArtist"]] = relationship(cascade="all, delete-orphan")
    favorite_events: Mapped[list["FavoriteEvent"]] = relationship(cascade="all, delete-orphan")
    watch_items: Mapped[list["UserWatchItem"]] = relationship(cascade="all, delete-orphan")
    booking_plans: Mapped[list["UserBookingPlan"]] = relationship(cascade="all, delete-orphan")
    saved_targets: Mapped[list["UserSavedTarget"]] = relationship(cascade="all, delete-orphan")


class UserIdentity(Base):
    __tablename__ = "user_identities"
    __table_args__ = (UniqueConstraint("provider", "subject", name="uq_user_identity_provider_subject"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(32))
    subject: Mapped[str] = mapped_column(String(255))
    user: Mapped["User"] = relationship(back_populates="identities")


class FavoriteArtist(Base):
    __tablename__ = "user_favorite_artists"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    artist_id: Mapped[str] = mapped_column(ForeignKey("artists.id", ondelete="CASCADE"), primary_key=True)


class FavoriteEvent(Base):
    __tablename__ = "user_favorite_events"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)


class UserWatchItem(Base):
    __tablename__ = "user_watch_items"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)



class UserBookingPlan(Base):
    """A user's ticket purchase goal. No provider cookies, card data or CVV."""
    __tablename__ = "user_booking_plans"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class UserSavedTarget(Base):
    """Saved performances and sales; legacy artist/event favorites remain readable."""
    __tablename__ = "user_saved_targets"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(24), primary_key=True)
    target_id: Mapped[str] = mapped_column(String(36), primary_key=True)


class OAuthLoginFlow(Base):
    __tablename__ = "oauth_login_flows"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid)
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    state: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    nonce: Mapped[str] = mapped_column(String(128), nullable=False)
    client_challenge: Mapped[str] = mapped_column(String(64), nullable=False)
    provider_verifier: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    failure: Mapped[str | None] = mapped_column(String(180), nullable=True)


class Source(Base):
    __tablename__ = "crawl_sources"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid)
    name: Mapped[str] = mapped_column(String(160))
    url: Mapped[str] = mapped_column(Text, unique=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    interval_minutes: Mapped[int] = mapped_column(Integer, default=360)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CrawlRun(Base):
    __tablename__ = "crawl_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid)
    source_id: Mapped[str] = mapped_column(ForeignKey("crawl_sources.id"), index=True)
    status: Mapped[str] = mapped_column(String(32))
    found: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class AIModelPolicy(Base):
    """Admin-configured model per stable AI task. No API keys in the database."""
    __tablename__ = "ai_model_policies"
    task: Mapped[str] = mapped_column(String(60), primary_key=True)
    model: Mapped[str] = mapped_column(String(160), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=6, nullable=False)
    max_output_tokens: Mapped[int] = mapped_column(Integer, default=450, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AIUsageLog(Base):
    """Quota / operational status only; never store sent contexts or completions."""
    __tablename__ = "ai_usage_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    task: Mapped[str] = mapped_column(String(60), nullable=False)
    model: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class ProviderAutomationPolicy(Base):
    """Evidence record only. A row never grants execution by itself."""
    __tablename__ = "provider_automation_policies"
    __table_args__ = (UniqueConstraint("provider_id", "country", "capability", name="uq_provider_automation_scope"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid)
    provider_id: Mapped[str] = mapped_column(ForeignKey("providers.id", ondelete="CASCADE"), index=True)
    country: Mapped[str] = mapped_column(String(2), nullable=False)
    capability: Mapped[str] = mapped_column(String(40), nullable=False)
    state: Mapped[str] = mapped_column(String(16), default="unverified", nullable=False)
    evidence_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    reason: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    reviewer: Mapped[str] = mapped_column(String(120), default="admin-key", nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, nullable=False)


class ProviderAutomationAudit(Base):
    """Append-only change history. Shared admin key does not identify an individual."""
    __tablename__ = "provider_automation_audit"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid)
    provider_id: Mapped[str | None] = mapped_column(String(60), index=True, nullable=True)
    country: Mapped[str | None] = mapped_column(String(2), nullable=True)
    capability: Mapped[str | None] = mapped_column(String(40), nullable=True)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    actor: Mapped[str] = mapped_column(String(120), default="admin-key", nullable=False)
    old_value: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    new_value: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, nullable=False)


class AutomationSafetySetting(Base):
    """Singleton: autonomous execution globally disabled until separately released."""
    __tablename__ = "automation_safety_settings"
    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    kill_switch: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, nullable=False)
