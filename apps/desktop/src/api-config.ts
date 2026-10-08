/** Official API is built into production; local override is development-only. */
export const PRODUCTION_API_URL = "https://tixbam-production.up.railway.app";

export function resolvePlatformApiUrl(isDevelopment: boolean, developmentOverride?: string): string {
  if (!isDevelopment || !developmentOverride) return PRODUCTION_API_URL;

  const candidate = developmentOverride.trim().replace(/\/+$/, "");
  try {
    const url = new URL(candidate);
    const isLocalHttp = url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol === "https:" || isLocalHttp) &&
        !url.username && !url.password && !url.search && !url.hash && url.pathname === "/") {
      return candidate;
    }
  } catch {
    // Invalid development override: use the official service.
  }
  return PRODUCTION_API_URL;
}
