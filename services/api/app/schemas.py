from datetime import datetime
from pydantic import BaseModel, Field, field_validator, model_validator
from .schedule import as_utc, local_to_utc, validate_timezone

def only_https(value: str | None):
    if value is not None and not value.startswith("https://"):
        raise ValueError("Only HTTPS URLs are supported")
    return value

class ArtistInput(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    country: str | None = Field(None, max_length=8)
    image_url: str | None = None

    @field_validator("image_url")
    @classmethod
    def secure_image(cls, value): return only_https(value)

class EventInput(BaseModel):
    artist_id: str
    title: str = Field(min_length=1, max_length=250)
    city: str = ""
    country: str = ""
    venue: str | None = None
    starts_at: datetime | None = None
    starts_at_local: str | None = None
    timezone: str | None = Field(None, max_length=100)
    source_url: str | None = None

    @model_validator(mode="after")
    def normalize_schedule(self):
        validate_timezone(self.timezone)
        if self.starts_at_local and self.starts_at is not None:
            raise ValueError("Use either a UTC timestamp or local date/time, not both.")
        if self.starts_at_local:
            self.starts_at = local_to_utc(self.starts_at_local, self.timezone)
        elif self.starts_at:
            self.starts_at = as_utc(self.starts_at)
        return self

    @field_validator("source_url")
    @classmethod
    def secure_source(cls, value): return only_https(value)

class PerformanceInput(BaseModel):
    event_id: str
    session_key: str = Field(min_length=1, max_length=160)
    label: str = Field("", max_length=160)
    starts_at: datetime | None = None
    starts_at_local: str | None = None
    timezone: str | None = Field(None, max_length=100)
    status: str = Field("scheduled", pattern="^(scheduled|cancelled|postponed|sold_out)$")

    @model_validator(mode="after")
    def normalize_schedule(self):
        validate_timezone(self.timezone)
        if self.starts_at_local and self.starts_at is not None:
            raise ValueError("Use either UTC or local time, not both.")
        if self.starts_at_local:
            self.starts_at = local_to_utc(self.starts_at_local, self.timezone)
        elif self.starts_at:
            self.starts_at = as_utc(self.starts_at)
        return self


class SaleInput(BaseModel):
    event_id: str
    provider_id: str
    sale_type: str = "general"
    sale_at: datetime | None = None
    sale_at_local: str | None = None
    city: str | None = Field(None, max_length=160)
    country: str | None = Field(None, max_length=8)
    timezone: str | None = Field(None, max_length=100)
    booking_url: str
    applies_to_all: bool = True
    performance_ids: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def normalize_schedule(self):
        validate_timezone(self.timezone)
        if self.applies_to_all and self.performance_ids:
            raise ValueError("Select either all performances or specific performance IDs.")
        if not self.applies_to_all and not self.performance_ids:
            raise ValueError("Select at least one performance.")
        if len(set(self.performance_ids)) != len(self.performance_ids):
            raise ValueError("Duplicate performance IDs.")
        if self.sale_at_local and self.sale_at is not None:
            raise ValueError("Use either a UTC timestamp or local date/time, not both.")
        if self.sale_at_local:
            self.sale_at = local_to_utc(self.sale_at_local, self.timezone)
        elif self.sale_at:
            self.sale_at = as_utc(self.sale_at)
        return self

    @field_validator("booking_url")
    @classmethod
    def secure_booking(cls, value): return only_https(value)


class ProviderInput(BaseModel):
    """Full registry entry. Provider IDs are stable references for ticket sales."""
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{1,59}$", max_length=60)
    name: str = Field(min_length=1, max_length=160)
    region: str = Field(default="Global", max_length=120)
    country: str = Field(default="GL", min_length=2, max_length=8)
    url: str
    allowed_hosts: list[str] = Field(default_factory=list, max_length=30)
    automation: dict = Field(default_factory=dict)
    capabilities: list[str] = Field(default_factory=list, max_length=30)
    version: str = Field(default="1.0.0", min_length=1, max_length=60)
    description: str = ""
    published: bool = False
    artifact_url: str | None = None
    artifact_sha256: str | None = Field(None, pattern=r"^[a-fA-F0-9]{64}$")

    @field_validator("url", "artifact_url")
    @classmethod
    def https_only(cls, value):
        return only_https(value)

    @field_validator("allowed_hosts")
    @classmethod
    def validate_hosts(cls, value):
        from urllib.parse import urlsplit
        import re
        for host in value:
            if (not re.fullmatch(r"[a-z0-9][a-z0-9.-]*[a-z0-9]", host, re.I)
                or "." not in host or ".." in host or len(host) > 253):
                raise ValueError("Allowed hosts must be DNS hostnames without schemes or paths")
        return value

    @field_validator("automation")
    @classmethod
    def valid_automation(cls, value):
        if len(str(value)) > 20000:
            raise ValueError("Automation metadata too large")
        return value

class AddonInput(BaseModel):
    version: str = Field(min_length=1, max_length=60)
    published: bool = True
    description: str = ""
    artifact_url: str | None = None
    artifact_sha256: str | None = Field(None, min_length=64, max_length=64)

    @field_validator("artifact_url")
    @classmethod
    def secure_artifact(cls, value): return only_https(value)

class SourceInput(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    url: str
    enabled: bool = True
    interval_minutes: int = Field(360, ge=15, le=43200)

    @field_validator("url")
    @classmethod
    def secure_url(cls, value): return only_https(value)

class CrawlRunInput(BaseModel):
    source_id: str
    status: str = Field(pattern="^(success|failed|skipped)$")
    found: int = Field(0, ge=0)
    message: str = ""

class DiscoveredEvent(BaseModel):
    artist: str = Field(min_length=1)
    title: str = Field(min_length=1)
    city: str = ""
    country: str = ""
    venue: str | None = None
    starts_at: datetime | None = None
    source_url: str
    session_key: str | None = Field(None, max_length=160)

    @field_validator("source_url")
    @classmethod
    def secure_event_url(cls, value): return only_https(value)

class IngestInput(BaseModel):
    source_id: str
    events: list[DiscoveredEvent] = Field(max_length=500)
