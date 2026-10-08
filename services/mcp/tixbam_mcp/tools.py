"""The only externally callable MCP tool surface. Writes require extra scope."""
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.types import ToolAnnotations
from .auth import MCPConfig, WRITE_SCOPE
from .catalog import Catalog


def register_tools(server, config: MCPConfig):
    catalog = Catalog()
    read = ToolAnnotations(read_only_hint=True, open_world_hint=False)
    write = ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=False)

    def require_write():
        token = get_access_token()
        if token is None or token.subject != config.owner_sub or WRITE_SCOPE not in token.scopes:
            raise PermissionError("TixBam write scope required")

    @server.tool(annotations=read)
    def search_artists(query: str = "", limit: int = 50) -> dict:
        """Find artists already stored in TixBam. Does not search the public web."""
        return catalog.artists(query, limit)

    @server.tool(annotations=read)
    def list_events(artist_id: str = "", limit: int = 50) -> dict:
        """List registered concerts/fan meetings, including ticket-sale details."""
        return catalog.events(artist_id, limit)

    @server.tool(annotations=read)
    def get_event(event_id: str) -> dict:
        """Fetch a registered event and its ticket-sale schedules."""
        return catalog.event(event_id)


    @server.tool(annotations=read)
    def list_performances(event_id: str) -> dict:
        """Show every session for an event, with local IANA time zone and status."""
        return catalog.performances(event_id)

    @server.tool(annotations=read)
    def list_providers(include_unpublished: bool = False) -> dict:
        """List provider registry IDs. Include unpublished entries for owner reconciliation."""
        return catalog.providers(include_unpublished)

    @server.tool(annotations=write)
    def create_provider(provider_id: str, name: str, url: str,
                        region: str = "Global", country: str = "GL",
                        allowed_hosts: list[str] | None = None,
                        capabilities: list[str] | None = None,
                        description: str = "", published: bool = False) -> dict:
        """Register a ticketing provider from an official verified HTTPS website.

        Provider ID is a stable lowercase slug and must not already exist.
        This creates registry metadata only: no add-on code, checkout integration,
        seat selection or automation is enabled by registration.
        Unverified providers should remain unpublished.
        """
        require_write()
        return catalog.create_provider(provider_id, name, url, region, country,
                                       allowed_hosts, capabilities, description, published)

    @server.tool(annotations=write)
    def update_provider(provider_id: str, name: str | None = None,
                        url: str | None = None, region: str | None = None,
                        country: str | None = None, allowed_hosts: list[str] | None = None,
                        capabilities: list[str] | None = None,
                        description: str | None = None,
                        published: bool | None = None) -> dict:
        """Update verified provider metadata. Omitted fields remain unchanged.

        Publishing only affects public catalog visibility and does not install an add-on.
        """
        require_write()
        return catalog.update_provider(provider_id, name, url, region, country,
                                       allowed_hosts, capabilities, description, published)

    @server.tool(annotations=write)
    def create_artist(name: str, country: str | None = None, image_url: str | None = None) -> dict:
        """Add an artist after checking whether a matching artist already exists."""
        require_write()
        return catalog.create_artist(name, country, image_url)

    @server.tool(annotations=write)
    def update_artist(artist_id: str, name: str | None = None,
                      country: str | None = None, image_url: str | None = None) -> dict:
        """Update an artist's identity or metadata after verifying the change."""
        require_write()
        return catalog.update_artist(artist_id, name, country, image_url)

    @server.tool(annotations=write)
    def create_event(artist_id: str, title: str, source_url: str,
                     city: str = "", country: str = "", venue: str | None = None,
                     starts_at_local: str | None = None, timezone: str | None = None) -> dict:
        """Register a verified concert. Require its official HTTPS source URL.
        starts_at_local is YYYY-MM-DDTHH:MM in the named IANA timezone.
        Avoid guessing unannounced concerts or start times.
        """
        require_write()
        return catalog.create_event(artist_id, title, source_url, city, country,
                                    venue, starts_at_local, timezone)

    @server.tool(annotations=write)
    def update_event(event_id: str, title: str | None = None,
                     city: str | None = None, country: str | None = None,
                     venue: str | None = None, starts_at_local: str | None = None,
                     timezone: str | None = None, source_url: str | None = None) -> dict:
        """Edit an existing event from official information, using its ID."""
        require_write()
        return catalog.update_event(event_id, title, city, country, venue,
                                    starts_at_local, timezone, source_url)


    @server.tool(annotations=write)
    def create_performance(event_id: str, session_key: str, label: str = "",
                           starts_at_local: str | None = None, timezone: str | None = None,
                           status: str = "scheduled") -> dict:
        """Add one verified show session to an event. session_key must be stable within the event."""
        require_write()
        return catalog.create_performance(event_id, session_key, label, starts_at_local, timezone, status)

    @server.tool(annotations=write)
    def update_performance(performance_id: str, session_key: str, label: str = "",
                           starts_at_local: str | None = None, timezone: str | None = None,
                           status: str = "scheduled") -> dict:
        """Correct an existing show session, including its time or cancellation status."""
        require_write()
        return catalog.update_performance(performance_id, session_key, label, starts_at_local, timezone, status)

    @server.tool(annotations=write)
    def create_ticket_sale(event_id: str, provider_id: str, booking_url: str,
                           sale_type: str = "general", sale_at_local: str | None = None,
                           timezone: str | None = None, city: str | None = None,
                           country: str | None = None,
                           performance_ids: list[str] | None = None) -> dict:
        """Record a verified on-sale/presale with official HTTPS booking URL.
        sale_at_local uses YYYY-MM-DDTHH:MM and the sale's IANA timezone.
        """
        require_write()
        return catalog.create_sale(event_id, provider_id, booking_url, sale_type,
                                   sale_at_local, timezone, city, country, performance_ids)

    @server.tool(annotations=write)
    def update_ticket_sale(sale_id: str, booking_url: str | None = None,
                           sale_type: str | None = None, sale_at_local: str | None = None,
                           timezone: str | None = None,
                           performance_ids: list[str] | None = None,
                           applies_to_all: bool | None = None) -> dict:
        """Update a verified ticket sale or change which performances it covers.

        Omit both performance_ids and applies_to_all to preserve its existing
        scope. Set applies_to_all=True to cover every performance. Set
        applies_to_all=False and provide nonempty performance_ids for a subset.
        Each performance must belong to this ticket sale's event.
        """
        require_write()
        return catalog.update_sale(sale_id, booking_url, sale_type, sale_at_local,
                                   timezone, performance_ids, applies_to_all)
