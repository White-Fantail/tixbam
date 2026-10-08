"use client";

import { useEffect, useState } from "react";
import { addArtist, addEvent, addPerformance, updatePerformance, addSale, addSource, updateSource, addProvider, updateProvider, editAddon, updateArtist, updateEvent, updateSale } from "./actions";
import type { Artist, Event, Performance, Provider, Sale } from "./catalog-types";
import { guessZone, priorityZones, toLocalInput } from "./time-zones";

function TimeZonePicker({ value, onChange, required }: {
  value: string; onChange: (value: string) => void; required: boolean;
}) {
  const [available, setAvailable] = useState(priorityZones);
  useEffect(() => {
    const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    setAvailable([...new Set([...priorityZones, ...all])].sort());
  }, []);
  const zones = [...new Set([value, ...available].filter(Boolean))].sort();
  return <label>Location time zone (IANA)
    <select name="timezone" value={value} required={required} onChange={e => onChange(e.target.value)}>
      <option value="">Select time zone</option>
      {zones.map(zone => <option value={zone} key={zone}>{zone}</option>)}
    </select>
    <span className="field-help">Selected from the location when known. Check carefully for multi-zone countries and daylight-saving changes.</span>
  </label>;
}

function applyLocationZone(
  currentZone: string, oldCity: string, oldCountry: string, nextCity: string, nextCountry: string
) {
  const previousGuess = guessZone(oldCity, oldCountry);
  return !currentZone || currentZone === previousGuess
    ? guessZone(nextCity, nextCountry) : currentZone;
}

export function ArtistForm({ artist }: { artist?: Artist }) {
  return <form action={artist ? updateArtist : addArtist}>
    <h3>{artist ? "Edit artist" : "Add artist"}</h3>
    {artist && <input type="hidden" name="id" value={artist.id} />}
    <label>Name<input name="name" required maxLength={200} defaultValue={artist?.name || ""} placeholder="DAY6" /></label>
    <label>Country code<input name="country" maxLength={8} defaultValue={artist?.country || ""} placeholder="KR" /></label>
    <label>Artist image URL (optional)<input name="image_url" type="url" defaultValue={artist?.imageUrl || ""} placeholder="https://..." /></label>
    <button type="submit">{artist ? "Save artist" : "Create artist"}</button>
  </form>;
}

export function EventForm({ artists, event }: { artists: Artist[]; event?: Event }) {
  const [city, setCity] = useState(event?.city || "");
  const [country, setCountry] = useState(event?.country || "");
  const initialZone = event?.timezone || guessZone(event?.city, event?.country);
  const [zone, setZone] = useState(initialZone);
  const [localTime, setLocalTime] = useState(toLocalInput(event?.startsAt, initialZone || "UTC"));
  function changeLocation(nextCity: string, nextCountry: string) {
    setZone(old => applyLocationZone(old, city, country, nextCity, nextCountry));
    setCity(nextCity); setCountry(nextCountry);
  }
  return <form action={event ? updateEvent : addEvent}>
    <h3>{event ? "Edit concert / fan meeting" : "Add concert / fan meeting"}</h3>
    {event && <input type="hidden" name="id" value={event.id} />}
    <label>Artist<select name="artist_id" required defaultValue={event?.artistId || artists[0]?.id || ""}>
      {artists.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}
    </select></label>
    <label>Title<input name="title" required maxLength={250} defaultValue={event?.title || ""} placeholder="World Tour – Hong Kong" /></label>
    <label>Performance city<input name="city" value={city} onChange={e => changeLocation(e.target.value, country)} placeholder="Hong Kong" /></label>
    <label>Country code<input name="country" value={country} maxLength={8} onChange={e => changeLocation(city, e.target.value)} placeholder="HK" /></label>
    <label>Venue<input name="venue" defaultValue={event?.venue || ""} /></label>
    <TimeZonePicker value={zone} onChange={setZone} required={Boolean(localTime)} />
    <label>Initial session time (at venue; for new events)
      <input name="starts_at_local" type="datetime-local" value={localTime} onChange={e => setLocalTime(e.target.value)} />
      <span className="field-help">For multiple shows, manage each date/time separately in Performances below. The event's displayed time is the earliest session.</span>
    </label>
    <label>Official event source URL (optional)<input name="source_url" type="url" defaultValue={event?.sourceUrl || ""} placeholder="https://..." /></label>
    <button type="submit" disabled={!artists.length}>{event ? "Save event" : "Create event"}</button>
  </form>;
}


export function PerformanceForm({ events, performance }: { events: Event[]; performance?: Performance }) {
  const originalEvent = events.find(e => e.id === performance?.eventId) || events[0];
  const [eventId, setEventId] = useState(originalEvent?.id || "");
  const selected = events.find(e => e.id === eventId);
  const [zone, setZone] = useState(performance?.timezone || selected?.timezone || guessZone(selected?.city, selected?.country));
  const [localTime, setLocalTime] = useState(toLocalInput(performance?.startsAt, zone || "UTC"));
  function chooseEvent(id: string) {
    setEventId(id);
    const event = events.find(e => e.id === id);
    setZone(event?.timezone || guessZone(event?.city, event?.country));
    if (!performance) setLocalTime("");
  }
  return <form action={performance ? updatePerformance : addPerformance}>
    <h3>{performance ? "Edit performance" : "Add performance"}</h3>
    {performance && <input name="id" type="hidden" value={performance.id} />}
    <label>Event<select name="event_id" required value={eventId} onChange={e => chooseEvent(e.target.value)}
      disabled={Boolean(performance)}>
      {events.map(e => <option key={e.id} value={e.id}>{e.artist} — {e.title} ({e.city})</option>)}
    </select></label>
    {performance && <input type="hidden" name="event_id" value={eventId} />}
    <label>Session key (stable unique identifier)<input name="session_key" required maxLength={160}
      defaultValue={performance?.sessionKey || ""} placeholder="2026-11-07-17:00 or show-2" />
      <span className="field-help">Unique within this event. Never use the source URL as a session ID.</span>
    </label>
    <label>Session label<input name="label" maxLength={160} defaultValue={performance?.label || ""}
      placeholder="Saturday evening / Show 2" /></label>
    <TimeZonePicker value={zone} onChange={setZone} required={Boolean(localTime)} />
    <label>Show time (venue local time)<input type="datetime-local" name="starts_at_local"
      value={localTime} onChange={e => setLocalTime(e.target.value)} />
      <span className="field-help">Leave blank if TBA. Multiple shows on the same day must have different session keys.</span>
    </label>
    <label>Status<select name="status" defaultValue={performance?.status || "scheduled"}>
      {["scheduled", "postponed", "cancelled", "sold_out"].map(x=><option key={x} value={x}>{x.replaceAll("_", " ")}</option>)}
    </select></label>
    <button type="submit" disabled={!events.length}>{performance ? "Save performance" : "Add performance"}</button>
  </form>;
}

export function SaleForm({ events, providers, sale }: { events: Event[]; providers: Provider[]; sale?: Sale }) {
  const startEvent = events.find(e => e.id === sale?.eventId) || events[0];
  const [eventId, setEventId] = useState(startEvent?.id || "");
  const [city, setCity] = useState(sale?.city || startEvent?.city || "");
  const [country, setCountry] = useState(sale?.country || startEvent?.country || "");
  const initialZone = sale?.timezone || guessZone(sale?.city, sale?.country)
    || startEvent?.timezone || guessZone(startEvent?.city, startEvent?.country);
  const [zone, setZone] = useState(initialZone);
  const [localTime, setLocalTime] = useState(toLocalInput(sale?.saleAt, initialZone || "UTC"));
  const [allPerformances, setAllPerformances] = useState(sale?.appliesToAll !== false);
  const [selectedPerformances, setSelectedPerformances] = useState<string[]>(sale?.performanceIds || []);

  function changeLocation(nextCity: string, nextCountry: string) {
    setZone(old => applyLocationZone(old, city, country, nextCity, nextCountry));
    setCity(nextCity); setCountry(nextCountry);
  }
  function chooseEvent(id: string) {
    setEventId(id);
    const event = events.find(e => e.id === id);
    const nextCity = event?.city || "", nextCountry = event?.country || "";
    setCity(nextCity); setCountry(nextCountry);
    setZone(event?.timezone || guessZone(nextCity, nextCountry));
    setAllPerformances(true);
    setSelectedPerformances([]);
  }

  return <form action={sale ? updateSale : addSale}>
    <h3>{sale ? "Edit ticket sale" : "Add ticket sale"}</h3>
    {sale && <input type="hidden" name="id" value={sale.id} />}
    <label>Event<select name="event_id" value={eventId} required onChange={e => chooseEvent(e.target.value)}>
      {events.map(e => <option value={e.id} key={e.id}>{e.artist} — {e.title}</option>)}
    </select></label>
    <label>Ticketing provider<select name="provider_id" defaultValue={sale?.providerId || providers[0]?.id || ""} required>
      {providers.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
    </select></label>
    <label>Sale type<select name="sale_type" defaultValue={sale?.saleType || "general"}>
      {[...new Set(["general", "presale", "fanclub", ...(sale?.saleType ? [sale.saleType] : [])])].map(type =>
        <option value={type} key={type}>{type === "general" ? "General" : type === "presale" ? "Presale" : type === "fanclub" ? "Fanclub" : type}</option>)}
    </select></label>
    <label>Sale time reference city<input name="city" value={city} onChange={e => changeLocation(e.target.value, country)} placeholder="Hong Kong" /></label>
    <label>Sale time reference country<input name="country" maxLength={8} value={country} onChange={e => changeLocation(city, e.target.value)} placeholder="HK" />
      <span className="field-help">Initially uses the event location. Change it if presale tickets go on sale according to another region.</span>
    </label>
    <TimeZonePicker value={zone} onChange={setZone} required={Boolean(localTime)} />
    <label>Ticket sale date/time (in sale region)
      <input name="sale_at_local" type="datetime-local" value={localTime} onChange={e => setLocalTime(e.target.value)} />
      <span className="field-help">For example, an advertised 1 PM Hong Kong sale is entered as 13:00 with Asia/Hong_Kong.</span>
    </label>
    <div className="scope-picker">
      <label className="inline"><input type="checkbox" name="applies_to_all" checked={allPerformances}
        onChange={e => setAllPerformances(e.target.checked)} /> Sale applies to all performances</label>
      {!allPerformances && <div className="scope-options">
        {(events.find(e => e.id === eventId)?.performances || []).map(p =>
          <label className="inline" key={p.id}>
            <input type="checkbox" name="performance_ids" value={p.id}
              checked={selectedPerformances.includes(p.id)}
              onChange={e => setSelectedPerformances(prev =>
                e.target.checked ? [...prev, p.id] : prev.filter(x => x !== p.id))} />
            {p.label || p.sessionKey} — {p.startsAt ? toLocalInput(p.startsAt, p.timezone || zone || "UTC").replace("T", " ") : "TBA"}
          </label>)}
        {!events.find(e => e.id === eventId)?.performances.length && <p className="muted">Add sessions first.</p>}
      </div>}
    </div>
    <label>Official booking URL<input name="booking_url" type="url" required defaultValue={sale?.bookingUrl || ""} placeholder="https://..." /></label>
    <button type="submit" disabled={!events.length || !providers.length || (!allPerformances && !selectedPerformances.length)}>{sale ? "Save ticket sale" : "Add sale"}</button>
  </form>;
}

export type SourceRecord = { id: string; name: string; url: string; enabled: boolean; intervalMinutes: number; lastCheckedAt: string | null };
export type ProviderRecord = { id: string; name: string; kind?: "ticketing" | "event-presale"; url: string; region: string; country: string;
  allowedHosts: string[]; capabilities: string[]; automation: Record<string, unknown>;
  version: string; description: string; published: boolean; artifactUrl: string | null; artifactSha256: string | null };

export function SourceForm({ source }: { source?: SourceRecord }) {
  return <form action={source ? updateSource : addSource}>
    <h3>{source ? "Edit crawler source" : "Add crawler source"}</h3>
    {source && <input name="id" type="hidden" value={source.id} />}
    <label>Source name<input name="name" required defaultValue={source?.name || ""} /></label>
    <label>Approved source URL<input name="url" type="url" required defaultValue={source?.url || ""} placeholder="https://..." /></label>
    <label>Refresh interval (minutes)<input name="interval_minutes" type="number" min={15} max={43200} defaultValue={source?.intervalMinutes || 360} required /></label>
    <label className="inline"><input name="enabled" type="checkbox" defaultChecked={source?.enabled ?? true} /> Enabled</label>
    <button type="submit">{source ? "Save source" : "Add source"}</button>
  </form>;
}

export function ProviderForm({ provider }: { provider?: ProviderRecord }) {
  return <form action={provider ? updateProvider : addProvider}>
    <h3>{provider ? "Edit provider" : "Register provider"}</h3>
    <label>Provider ID (permanent slug)<input name="id" required pattern="[a-z0-9][a-z0-9_-]{1,59}"
      readOnly={Boolean(provider)} defaultValue={provider?.id || ""} placeholder="cityline" /></label>
    <label>Name<input name="name" required maxLength={160} defaultValue={provider?.name || ""} /></label>
    <label>Official URL<input name="url" type="url" required pattern="https://.*" defaultValue={provider?.url || ""} /></label>
    <label>Region<input name="region" defaultValue={provider?.region || "Global"} /></label>
    <label>Country code<input name="country" defaultValue={provider?.country || "GL"} /></label>
    <label>Allowed hosts (comma or newline separated)<textarea name="allowed_hosts" rows={2}
      defaultValue={(provider?.allowedHosts || []).join(", ")} placeholder="tickets.example.com" /></label>
    <label>Capabilities (comma or newline separated)<input name="capabilities"
      defaultValue={(provider?.capabilities || []).join(", ")} placeholder="ticketing, event-presale" /></label>
    <label>Automation metadata JSON<textarea name="automation" rows={3}
      defaultValue={JSON.stringify(provider?.automation || {}, null, 2)} /></label>
    <label>Version<input name="version" required defaultValue={provider?.version || "1.0.0"} /></label>
    <label>Description<textarea name="description" rows={3} defaultValue={provider?.description || ""} /></label>
    <label>Artifact URL (metadata only)<input name="artifact_url" type="url" defaultValue={provider?.artifactUrl || ""} /></label>
    <label>Artifact SHA-256<input name="artifact_sha256" minLength={64} maxLength={64}
      defaultValue={provider?.artifactSha256 || ""} /></label>
    <label className="inline"><input name="published" type="checkbox"
      defaultChecked={provider?.published ?? false} /> Published in public catalog</label>
    <p className="muted">Registration does not install or enable a browser add-on. Publish only verified metadata.</p>
    <button type="submit">{provider ? "Save provider" : "Register provider"}</button>
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
