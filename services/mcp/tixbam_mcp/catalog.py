"""Catalog operations shared by the MCP tools; reuse API models and validation."""
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.db import SessionLocal
from app.models import Artist, Event, Performance, Provider, TicketSale
from app.schemas import ArtistInput, EventInput, PerformanceInput, SaleInput
from app.serializers import artist_data, event_data, performance_data, provider_data, sale_data, refresh_legacy_event_start
from app.schedule import iso_utc
from app.performances import ensure_initial_performance, update_legacy_performance, add_performance, edit_performance, assign_sale_performances


class Catalog:
    def artists(self, query: str = "", limit: int = 50):
        with SessionLocal() as db:
            statement = select(Artist).order_by(Artist.name).limit(max(1, min(limit, 100)))
            if query.strip():
                statement = statement.where(Artist.name.ilike("%" + query.strip()[:100] + "%"))
            return {"items": [artist_data(a) for a in db.scalars(statement)]}

    def events(self, artist_id: str = "", limit: int = 50):
        with SessionLocal() as db:
            statement = select(Event).order_by(Event.starts_at.asc()).limit(max(1, min(limit, 100)))
            if artist_id:
                statement = statement.where(Event.artist_id == artist_id)
            return {"items": [event_data(e) for e in db.scalars(statement)]}

    def event(self, event_id: str):
        with SessionLocal() as db:
            item = db.get(Event, event_id)
            if item is None:
                raise ValueError("Event not found")
            return event_data(item)

    def providers(self):
        with SessionLocal() as db:
            statement = select(Provider).where(Provider.published.is_(True)).order_by(Provider.name)
            return {"items": [provider_data(p) for p in db.scalars(statement)]}

    def create_artist(self, name: str, country: str | None = None, image_url: str | None = None):
        payload = ArtistInput(name=name.strip(), country=country, image_url=image_url)
        with SessionLocal() as db:
            existing = db.scalar(select(Artist).where(Artist.name.ilike(payload.name)))
            if existing is not None:
                return {"created": False, "artist": artist_data(existing)}
            item = Artist(**payload.model_dump())
            db.add(item)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                raise ValueError("Artist already exists; search artists before retrying") from None
            return {"created": True, "artist": artist_data(item)}

    def update_artist(self, artist_id: str, name: str | None = None,
                      country: str | None = None, image_url: str | None = None):
        with SessionLocal() as db:
            item = db.get(Artist, artist_id)
            if item is None:
                raise ValueError("Artist not found")
            payload = ArtistInput(
                name=(name or item.name).strip(),
                country=country if country is not None else item.country,
                image_url=image_url if image_url is not None else item.image_url,
            )
            for key, value in payload.model_dump().items():
                setattr(item, key, value)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                raise ValueError("Artist name already exists") from None
            return artist_data(item)

    def create_event(self, artist_id: str, title: str, source_url: str,
                     city: str = "", country: str = "", venue: str | None = None,
                     starts_at_local: str | None = None, timezone: str | None = None):
        if not source_url:
            raise ValueError("A verified, official HTTPS source URL is required")
        payload = EventInput(
            artist_id=artist_id, title=title, source_url=source_url,
            city=city, country=country, venue=venue,
            starts_at_local=starts_at_local, timezone=timezone,
        )
        with SessionLocal() as db:
            if db.get(Artist, payload.artist_id) is None:
                raise ValueError("Artist not found")
            existing = db.scalar(select(Event).where(
                Event.artist_id == artist_id, Event.title == title,
                Event.city == city, Event.country == country, Event.venue == venue
            ))
            if existing:
                return {"created": False, "event": event_data(existing)}
            item = Event(**payload.model_dump(exclude={"starts_at_local"}))
            db.add(item)
            db.flush()
            ensure_initial_performance(db, item, payload.starts_at, payload.timezone)
            db.commit()
            return {"created": True, "event": event_data(item)}

    def update_event(self, event_id: str, title: str | None = None,
                     city: str | None = None, country: str | None = None,
                     venue: str | None = None, starts_at_local: str | None = None,
                     timezone: str | None = None, source_url: str | None = None):
        with SessionLocal() as db:
            item = db.get(Event, event_id)
            if item is None:
                raise ValueError("Event not found")
            payload = EventInput(
                artist_id=item.artist_id,
                title=title if title is not None else item.title,
                city=city if city is not None else item.city,
                country=country if country is not None else item.country,
                venue=venue if venue is not None else item.venue,
                timezone=timezone if timezone is not None else item.timezone,
                source_url=source_url if source_url is not None else item.source_url,
                starts_at_local=starts_at_local,
                starts_at=None if starts_at_local is not None else item.starts_at,
            )
            for key, value in payload.model_dump(exclude={"starts_at_local", "starts_at"}).items():
                setattr(item, key, value)
            if starts_at_local is not None:
                update_legacy_performance(db, item, payload.starts_at, payload.timezone)
            db.commit()
            return event_data(item)

    def create_sale(self, event_id: str, provider_id: str, booking_url: str,
                    sale_type: str = "general", sale_at_local: str | None = None,
                    timezone: str | None = None, city: str | None = None,
                    country: str | None = None, performance_ids: list[str] | None = None):
        payload = SaleInput(
            event_id=event_id, provider_id=provider_id, booking_url=booking_url,
            sale_type=sale_type, sale_at_local=sale_at_local, timezone=timezone,
            city=city, country=country,
            applies_to_all=not bool(performance_ids), performance_ids=performance_ids or [],
        )
        with SessionLocal() as db:
            if not db.get(Event, event_id) or not db.get(Provider, provider_id):
                raise ValueError("Event or ticket provider not found")
            candidates = db.scalars(select(TicketSale).where(
                TicketSale.event_id == event_id,
                TicketSale.provider_id == provider_id,
                TicketSale.sale_type == sale_type,
                TicketSale.booking_url == booking_url,
            ))
            for existing in candidates:
                if iso_utc(existing.sale_at) == iso_utc(payload.sale_at):
                    return {"created": False, "sale": sale_data(existing)}
            item = TicketSale(**payload.model_dump(exclude={"sale_at_local", "performance_ids"}))
            db.add(item)
            assign_sale_performances(db, item, payload)
            db.commit()
            return {"created": True, "sale": sale_data(item)}

    def update_sale(self, sale_id: str, booking_url: str | None = None,
                    sale_type: str | None = None, sale_at_local: str | None = None,
                    timezone: str | None = None,
                    performance_ids: list[str] | None = None, applies_to_all: bool | None = None):
        with SessionLocal() as db:
            item = db.get(TicketSale, sale_id)
            if item is None:
                raise ValueError("Ticket sale not found")
            payload = SaleInput(
                event_id=item.event_id, provider_id=item.provider_id,
                booking_url=booking_url if booking_url is not None else item.booking_url,
                sale_type=sale_type if sale_type is not None else item.sale_type,
                city=item.city, country=item.country,
                timezone=timezone if timezone is not None else item.timezone,
                sale_at_local=sale_at_local,
                sale_at=None if sale_at_local is not None else item.sale_at,
                applies_to_all=applies_to_all if applies_to_all is not None else (not bool(performance_ids) if performance_ids is not None else item.applies_to_all),
                performance_ids=performance_ids if performance_ids is not None else [link.performance_id for link in item.performance_links],
            )
            if payload.applies_to_all:
                payload.performance_ids = []
            for key, value in payload.model_dump(exclude={"sale_at_local", "performance_ids"}).items():
                setattr(item, key, value)
            assign_sale_performances(db, item, payload)
            db.commit()
            return sale_data(item)

    def performances(self, event_id: str):
        with SessionLocal() as db:
            event = db.get(Event, event_id)
            if event is None:
                raise ValueError("Event not found")
            return {"items": [performance_data(p) for p in event.performances]}

    def create_performance(self, event_id: str, session_key: str, label: str = "",
                           starts_at_local: str | None = None, timezone: str | None = None,
                           status: str = "scheduled"):
        payload = PerformanceInput(event_id=event_id, session_key=session_key,
                                   label=label, starts_at_local=starts_at_local,
                                   timezone=timezone, status=status)
        with SessionLocal() as db:
            event = db.get(Event, event_id)
            if event is None:
                raise ValueError("Event not found")
            item = add_performance(db, event, payload)
            db.commit()
            return performance_data(item)

    def update_performance(self, performance_id: str, session_key: str,
                           label: str = "", starts_at_local: str | None = None,
                           timezone: str | None = None, status: str = "scheduled"):
        with SessionLocal() as db:
            item = db.get(Performance, performance_id)
            if item is None:
                raise ValueError("Performance not found")
            payload = PerformanceInput(event_id=item.event_id, session_key=session_key,
                                       label=label, starts_at_local=starts_at_local,
                                       timezone=timezone, status=status)
            edit_performance(db, item, payload)
            db.commit()
            return performance_data(item)
