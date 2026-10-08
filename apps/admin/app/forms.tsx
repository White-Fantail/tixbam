import { addArtist, addEvent, addSale, addSource, editAddon } from "./actions";

export function ArtistForm() {
  return <form action={addArtist}>
    <h3>Add artist</h3>
    <label>Name<input name="name" required placeholder="DAY6" /></label>
    <label>Country code<input name="country" maxLength={8} placeholder="KR" /></label>
    <button type="submit">Create artist</button>
  </form>;
}

export function EventForm({ artists }: { artists: any[] }) {
  return <form action={addEvent}>
    <h3>Add concert / fan meeting</h3>
    <label>Artist<select name="artist_id" required>{artists.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
    <label>Title<input name="title" required placeholder="World Tour – Hong Kong" /></label>
    <label>City<input name="city" placeholder="Hong Kong" /></label>
    <label>Country<input name="country" placeholder="HK" /></label>
    <label>Venue<input name="venue" /></label>
    <label>Performance date/time (UTC)<input name="starts_at" type="datetime-local" /></label>
    <button type="submit" disabled={!artists.length}>Create event</button>
  </form>;
}

export function SaleForm({ events, providers }: { events: any[]; providers: any[] }) {
  return <form action={addSale}>
    <h3>Add ticket sale</h3>
    <label>Event<select name="event_id" required>{events.map(e => <option value={e.id} key={e.id}>{e.artist} — {e.title}</option>)}</select></label>
    <label>Ticketing provider<select name="provider_id">{providers.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
    <label>Sale type<select name="sale_type"><option value="general">General</option><option value="presale">Presale</option><option value="fanclub">Fanclub</option></select></label>
    <label>Ticket sale date/time (UTC)<input name="sale_at" type="datetime-local" /></label>
    <label>Official booking URL<input name="booking_url" type="url" placeholder="https://..." required /></label>
    <button type="submit" disabled={!events.length || !providers.length}>Add sale</button>
  </form>;
}

export function SourceForm() {
  return <form action={addSource}>
    <h3>Add crawl source</h3>
    <label>Source name<input name="name" required placeholder="Official event calendar" /></label>
    <label>Approved source URL<input name="url" type="url" required placeholder="https://..." /></label>
    <label>Refresh interval (minutes)<input name="interval_minutes" type="number" min={15} max={43200} defaultValue={360} /></label>
    <button type="submit">Add source</button>
  </form>;
}

export function AddonForm({ provider }: { provider: any }) {
  return <form action={editAddon}>
    <input type="hidden" name="id" value={provider.id} />
    <label>Version<input name="version" defaultValue={provider.version} required /></label>
    <label>Description<input name="description" defaultValue={provider.description} /></label>
    <label>Artifact URL (metadata only)<input name="artifact_url" type="url" defaultValue={provider.artifactUrl || ""} /></label>
    <label>Artifact SHA-256<input name="artifact_sha256" minLength={64} maxLength={64} defaultValue={provider.artifactSha256 || ""} /></label>
    <label className="inline"><input type="checkbox" name="published" defaultChecked={provider.published} /> Published</label>
    <button type="submit">Save {provider.name}</button>
  </form>;
}
