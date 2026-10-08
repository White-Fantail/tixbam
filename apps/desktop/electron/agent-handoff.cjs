// The user explicitly supplies the ticket agent URL shown by the official event.
// Neither arbitrary external links nor automatic link guessing are allowed.
const catalog = require("../addons/catalog.json");
const { isSafeWebUrl, isHostAllowed } = require("./security.cjs");

function resolveAgentHandoff(sourceProviderId, ticketUrl) {
  const source = catalog.find(a => a.id === sourceProviderId);
  if (!source || source.kind !== "event-presale") throw new Error("Select an event / presale window first.");
  if (!isSafeWebUrl(ticketUrl)) throw new Error("Enter an official HTTPS ticket agent URL.");
  const parsed = new URL(ticketUrl);
  const candidates = catalog.filter(a => a.kind === "ticketing" && isHostAllowed(parsed.hostname, a.allowedHosts));
  if (candidates.length !== 1) throw new Error("This ticket agent does not have a supported add-on. Open the official link manually.");
  return { providerId: candidates[0].id, url: parsed.toString() };
}
module.exports = { resolveAgentHandoff };
