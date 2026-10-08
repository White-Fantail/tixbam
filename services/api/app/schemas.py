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

    @model_validator(mode="after")
    def normalize_schedule(self):
        validate_timezone(self.timezone)
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

    @field_validator("source_url")
    @classmethod
    def secure_event_url(cls, value): return only_https(value)

class IngestInput(BaseModel):
    source_id: str
    events: list[DiscoveredEvent] = Field(max_length=500)
