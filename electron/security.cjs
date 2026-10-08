const providers = require("../providers.json");

const MAX_WINDOWS = 6;

function findProvider(id) {
  return providers.find((provider) => provider.id === id) || null;
}

function isSafeWebUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isHostAllowed(hostname, allowedHosts) {
  const host = hostname.toLowerCase();
  return allowedHosts.some((root) => host === root || host.endsWith("." + root));
}

function resolveStartUrl(providerId, candidate) {
  const provider = findProvider(providerId);
  if (!provider) throw new Error("Unknown ticketing provider.");
  const url = candidate && candidate.trim() ? candidate.trim() : provider.url;
  if (!isSafeWebUrl(url)) throw new Error("Enter a valid HTTPS ticket URL.");
  const parsed = new URL(url);
  if (!isHostAllowed(parsed.hostname, provider.allowedHosts)) {
    throw new Error("That URL does not belong to " + provider.name + ".");
  }
  return { provider, url: parsed.toString() };
}

module.exports = { MAX_WINDOWS, findProvider, isSafeWebUrl, isHostAllowed, resolveStartUrl };
