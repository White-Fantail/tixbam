"use client";

import { useEffect, useState } from "react";
import { addArtist, addEvent, addSale, addSource, editAddon, updateArtist, updateEvent, updateSale } from "./actions";
import type { Artist, Event, Provider, Sale } from "./catalog-types";
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
    <label>Performance date/time (at venue)
      <input name="starts_at_local" type="datetime-local" value={localTime} onChange={e => setLocalTime(e.target.value)} />
      <span className="field-help">Enter the clock time printed on the official event listing, not UTC. Leave empty if TBA.</span>
    </label>
    <label>Official event source URL (optional)<input name="source_url" type="url" defaultValue={event?.sourceUrl || ""} placeholder="https://..." /></label>
    <button type="submit" disabled={!artists.length}>{event ? "Save event" : "Create event"}</button>
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
    <label>Official booking URL<input name="booking_url" type="url" required defaultValue={sale?.bookingUrl || ""} placeholder="https://..." /></label>
    <button type="submit" disabled={!events.length || !providers.length}>{sale ? "Save ticket sale" : "Add sale"}</button>
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
