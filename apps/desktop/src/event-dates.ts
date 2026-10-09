import type { CatalogEvent } from "../../../packages/catalog-types";

type EventSchedule = Pick<CatalogEvent, "startsAt" | "timezone" | "performances">;

/**
 * Summarize actual performance dates for a compact favorite-event card.
 * Event times are shown in the venue's time zone, never the viewer's device zone.
 * A sale's on-sale date is intentionally not used as the performance date.
 */
export function formatFavoritePerformanceDate(event: EventSchedule, locale = "en-NZ"): string {
  const sessions = event.performances ?? [];
  const dated = sessions
    .filter(session => Boolean(session.startsAt))
    .map(session => ({ date: new Date(session.startsAt!), timezone: session.timezone }))
    .filter(session => !Number.isNaN(session.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (!sessions.length && event.startsAt) {
    const fallback = new Date(event.startsAt);
    if (!Number.isNaN(fallback.getTime())) dated.push({ date: fallback, timezone: event.timezone });
  }
  if (!dated.length) return "Date TBA";

  const requestedZone = dated[0].timezone || event.timezone || "UTC";
  let timeZone = requestedZone;
  try {
    new Intl.DateTimeFormat(locale, { timeZone });
  } catch {
    timeZone = "UTC";
  }

  const day = new Intl.DateTimeFormat(locale, {
    timeZone, day: "numeric", month: "short", year: "numeric"
  });
  const first = dated[0].date;
  const last = dated[dated.length - 1].date;
  const sessionCount = sessions.length;
  if (sessionCount <= 1) {
    const time = new Intl.DateTimeFormat(locale, {
      timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    });
    return day.format(first) + " · " + time.format(first) + " (venue time)";
  }

  const range = day.formatRange(first, last);
  const tbaCount = sessionCount - dated.length;
  return range + " · " + sessionCount + " sessions" +
    (tbaCount > 0 ? " (" + tbaCount + " date TBA)" : "");
}
