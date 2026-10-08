// Event-local IANA zones. Keep explicit selection for countries with multiple zones.
const cityZones: Record<string, string> = {
  "hong kong": "Asia/Hong_Kong", "seoul": "Asia/Seoul", "busan": "Asia/Seoul",
  "taipei": "Asia/Taipei", "tokyo": "Asia/Tokyo", "osaka": "Asia/Tokyo",
  "singapore": "Asia/Singapore", "christchurch": "Pacific/Auckland",
  "auckland": "Pacific/Auckland", "wellington": "Pacific/Auckland",
  "chatham islands": "Pacific/Chatham", "sydney": "Australia/Sydney",
  "melbourne": "Australia/Melbourne", "brisbane": "Australia/Brisbane",
  "gold coast": "Australia/Brisbane", "adelaide": "Australia/Adelaide",
  "perth": "Australia/Perth", "darwin": "Australia/Darwin",
  "hobart": "Australia/Hobart", "new york": "America/New_York",
  "los angeles": "America/Los_Angeles", "san francisco": "America/Los_Angeles",
  "chicago": "America/Chicago", "denver": "America/Denver",
  "vancouver": "America/Vancouver", "toronto": "America/Toronto",
  "london": "Europe/London", "paris": "Europe/Paris",
  "berlin": "Europe/Berlin", "bangkok": "Asia/Bangkok",
  "jakarta": "Asia/Jakarta", "kuala lumpur": "Asia/Kuala_Lumpur",
  "manila": "Asia/Manila", "beijing": "Asia/Shanghai",
  "shanghai": "Asia/Shanghai", "guangzhou": "Asia/Shanghai",
  "mumbai": "Asia/Kolkata", "delhi": "Asia/Kolkata"
};
const countryZones: Record<string, string> = {
  HK: "Asia/Hong_Kong", KR: "Asia/Seoul", TW: "Asia/Taipei",
  JP: "Asia/Tokyo", SG: "Asia/Singapore", NZ: "Pacific/Auckland",
  GB: "Europe/London", UK: "Europe/London", FR: "Europe/Paris",
  DE: "Europe/Berlin", TH: "Asia/Bangkok", MY: "Asia/Kuala_Lumpur",
  PH: "Asia/Manila", CN: "Asia/Shanghai", IN: "Asia/Kolkata"
};
const aliases: Record<string, string> = {
  "HONG KONG": "HK", "SOUTH KOREA": "KR", "KOREA": "KR",
  "TAIWAN": "TW", "JAPAN": "JP", "SINGAPORE": "SG",
  "NEW ZEALAND": "NZ", "UNITED KINGDOM": "GB", "UK": "GB",
  "FRANCE": "FR", "GERMANY": "DE", "CHINA": "CN", "INDIA": "IN",
  "THAILAND": "TH", "MALAYSIA": "MY", "PHILIPPINES": "PH",
  "UNITED STATES": "US", "USA": "US", "AUSTRALIA": "AU",
  "CANADA": "CA"
};
const zoneCountries: Record<string, string> = {
  "Asia/Hong_Kong": "HK", "Asia/Seoul": "KR", "Asia/Taipei": "TW",
  "Asia/Tokyo": "JP", "Asia/Singapore": "SG", "Pacific/Auckland": "NZ",
  "Pacific/Chatham": "NZ", "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU", "Australia/Brisbane": "AU",
  "Australia/Adelaide": "AU", "Australia/Perth": "AU",
  "Australia/Darwin": "AU", "Australia/Hobart": "AU",
  "America/New_York": "US", "America/Los_Angeles": "US",
  "America/Chicago": "US", "America/Denver": "US",
  "America/Vancouver": "CA", "America/Toronto": "CA",
  "Europe/London": "GB", "Europe/Paris": "FR", "Europe/Berlin": "DE",
  "Asia/Bangkok": "TH", "Asia/Jakarta": "ID", "Asia/Kuala_Lumpur": "MY",
  "Asia/Manila": "PH", "Asia/Shanghai": "CN", "Asia/Kolkata": "IN"
};
export function guessZone(city: string | null | undefined, country: string | null | undefined): string {
  const place = (city || "").trim().toLowerCase();
  const rawCode = (country || "").trim().toUpperCase();
  const code = aliases[rawCode] || rawCode;
  const cityZone = cityZones[place];
  // "London, CA" and "Paris, US" must never silently use UK/France time.
  if (cityZone && (!code || zoneCountries[cityZone] === code)) return cityZone;
  return countryZones[code] || "";
}

export const priorityZones = [
  "Asia/Hong_Kong", "Asia/Seoul", "Asia/Taipei", "Asia/Tokyo",
  "Asia/Singapore", "Pacific/Auckland", "Pacific/Chatham",
  "Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane",
  "Australia/Perth", "Australia/Adelaide", "Australia/Darwin",
  "America/New_York", "America/Los_Angeles", "America/Chicago",
  "Europe/London", "Europe/Paris", "Asia/Shanghai", "UTC"
];

export function toLocalInput(iso: string | null | undefined, zone: string): string {
  if (!iso) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date(iso));
    const part = (key: string) => parts.find(item => item.type === key)?.value || "00";
    return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  } catch { return ""; }
}

export function formattedTime(iso: string | null | undefined, zone: string): string {
  if (!iso) return "TBA";
  try {
    return new Intl.DateTimeFormat("en-NZ", {
      timeZone: zone, dateStyle: "medium", timeStyle: "short"
    }).format(new Date(iso));
  } catch { return "Invalid date/time zone"; }
}
