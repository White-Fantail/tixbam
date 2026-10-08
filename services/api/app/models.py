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
