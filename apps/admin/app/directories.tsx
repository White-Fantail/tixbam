"use client";
import { useEffect, useState } from "react";
import { ArtistForm, EventForm, SaleForm } from "./forms";
import type { Artist, Event, Provider, Sale } from "./catalog-types";
import { formattedTime, guessZone } from "./time-zones";

function DualTime({ utc, timezone, city, country, label }: {
  utc: string | null; timezone: string | null; city: string | null;
  country: string | null; label: string;
}) {
  const [myZone, setMyZone] = useState("");
  useEffect(() => {
    setMyZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);
  if (!utc) return <span className="muted">TBA</span>;
  const guessed = guessZone(city, country);
  const zone = timezone || guessed || "UTC";
  const note = timezone ? "" : guessed ? " (inferred; verify on edit)" : " (legacy UTC; set zone on edit)";
  return <div className="dual-time">
    <strong>{label}: {formattedTime(utc, zone)}</strong>
    <small>{zone}{note}</small>
    <span>Your local: {myZone ? formattedTime(utc, myZone) : "—"}</span>
    {myZone && <small>{myZone}</small>}
  </div>;
}

export function ArtistsManager({ artists }: { artists: Artist[] }) {
  const [selected, setSelected] = useState<Artist | null>(null);
  return <div className="columns">
    <div className="panel">
      {selected && <button className="button-subtle" type="button" onClick={() => setSelected(null)}>+ New artist</button>}
      <ArtistForm key={selected?.id || "create-artist"} artist={selected || undefined} />
    </div>
    <div className="panel tablewrap"><h3>Artist directory</h3><table>
      <thead><tr><th>Name</th><th>Country</th><th>Actions</th></tr></thead>
      <tbody>{artists.map(artist => <tr key={artist.id} className={selected?.id === artist.id ? "selected-row" : ""}>
        <td>{artist.name}</td><td>{artist.country || "—"}</td>
        <td><button className="table-edit" type="button" onClick={() => setSelected(artist)}>Edit</button></td>
      </tr>)}</tbody>
    </table>{!artists.length && <p className="muted">No artists yet.</p>}</div>
  </div>;
}

export function EventsManager({ artists, events }: { artists: Artist[]; events: Event[] }) {
  const [selected, setSelected] = useState<Event | null>(null);
  return <div className="columns">
    <div className="panel">
      {selected && <button className="button-subtle" type="button" onClick={() => setSelected(null)}>+ New event</button>}
      <EventForm key={selected?.id || "create-event"} artists={artists} event={selected || undefined} />
    </div>
    <div className="panel tablewrap"><h3>Event directory</h3><table>
      <thead><tr><th>Artist / title</th><th>Location</th><th>Performance time</th><th>Actions</th></tr></thead>
      <tbody>{events.map(event => <tr key={event.id} className={selected?.id === event.id ? "selected-row" : ""}>
        <td><strong>{event.artist}</strong><div>{event.title}</div></td>
        <td>{event.city || "—"}{event.country ? ", " + event.country : ""}{event.venue && <small className="table-secondary">{event.venue}</small>}</td>
        <td><DualTime utc={event.startsAt} timezone={event.timezone} city={event.city} country={event.country} label="Venue" /></td>
        <td><button className="table-edit" type="button" onClick={() => setSelected(event)}>Edit</button></td>
      </tr>)}</tbody>
    </table>{!events.length && <p className="muted">Add an event or configure a permitted crawler feed.</p>}</div>
  </div>;
}

export function SalesManager({ events, providers }: { events: Event[]; providers: Provider[] }) {
  const [selected, setSelected] = useState<Sale | null>(null);
  const sales = events.flatMap(event => event.sales.map(sale => ({ sale, event })));
  return <div className="columns">
    <div className="panel">
      {selected && <button className="button-subtle" type="button" onClick={() => setSelected(null)}>+ New ticket sale</button>}
      <SaleForm key={selected?.id || "create-sale"} events={events} providers={providers.filter(p => p.kind !== "event-presale" || p.id === selected?.providerId)} sale={selected || undefined} />
    </div>
    <div className="panel tablewrap"><h3>Sale schedules</h3><table>
      <thead><tr><th>Event / provider</th><th>Sale type</th><th>Sale time</th><th>Actions</th></tr></thead>
      <tbody>{sales.map(({sale,event}) => <tr key={sale.id} className={selected?.id === sale.id ? "selected-row" : ""}>
        <td>{event.title}<small className="table-secondary">{providers.find(p => p.id === sale.providerId)?.name || sale.providerId}</small></td>
        <td>{sale.saleType}</td>
        <td><DualTime utc={sale.saleAt} timezone={sale.timezone || event.timezone}
          city={sale.city || event.city} country={sale.country || event.country} label="Sale region" /></td>
        <td><button className="table-edit" type="button" onClick={() => setSelected(sale)}>Edit</button></td>
      </tr>)}</tbody>
    </table>{!sales.length && <p className="muted">No ticket sales yet.</p>}</div>
  </div>;
}
