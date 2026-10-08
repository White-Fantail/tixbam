"use client";
import { useEffect, useState } from "react";
import { formattedTime, guessZone } from "../time-zones";
export function DualTime({iso, timezone, city, country, label}: {
  iso: string | null | undefined; timezone?: string | null; city?: string | null;
  country?: string | null; label?: string;
}) {
  const [localZone, setLocalZone] = useState("");
  useEffect(() => setLocalZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"), []);
  if (!iso) return <span className="muted">TBA</span>;
  const guessed = guessZone(city, country);
  const zone = timezone || guessed || "UTC";
  return <div className="dual-time">
    <strong>{label || "Venue"}: {formattedTime(iso, zone)}</strong>
    <small>{zone}{!timezone ? (guessed ? " · inferred" : " · verify timezone") : ""}</small>
    {localZone && <span>Your local: {formattedTime(iso, localZone)} <small>({localZone})</small></span>}
  </div>;
}
