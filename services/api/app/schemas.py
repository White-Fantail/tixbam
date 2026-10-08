from datetime import datetime
from pydantic import BaseModel, Field, field_validator

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
    source_url: str | None = None

    @field_validator("source_url")
    @classmethod
    def secure_source(cls, value): return only_https(value)

class SaleInput(BaseModel):
    event_id: str
    provider_id: str
    sale_type: str = "general"
    sale_at: datetime | None = None
    booking_url: str

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
