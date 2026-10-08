const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const catalog = require("../addons/catalog.json");
const { isSafeWebUrl, isHostAllowed } = require("./security.cjs");

function getInstalledFile() { return path.join(app.getPath("userData"), "addons.json"); }
function readState() {
  try {
    const data = JSON.parse(fs.readFileSync(getInstalledFile(), "utf8"));
    if (data && data.schemaVersion === 1 && Array.isArray(data.installed)) {
      return new Set(data.installed.filter(id => typeof id === "string" && catalog.some(a => a.id === id)));
    }
  } catch (error) { if (error.code !== "ENOENT") console.warn("Add-on state could not be read:", error.message); }
  // Preserve all six previously available providers on the first upgrade.
  return new Set(catalog.map(a => a.id));
}
let installed;
function active() { return installed || (installed = readState()); }
function listAddons() { return catalog.map(a => ({ ...a, installed: active().has(a.id) })); }
function findAddon(id) { return catalog.find(a => a.id === id) || null; }
function requireInstalled(id) {
  const addon = findAddon(id);
  if (!addon) throw new Error("Unknown ticketing add-on.");
  if (!active().has(id)) throw new Error(addon.name + " add-on is not installed.");
  return addon;
}
function setInstalled(id, enabled) {
  if (typeof id !== "string" || typeof enabled !== "boolean") throw new Error("Invalid add-on action.");
  const addon = findAddon(id);
  if (!addon) throw new Error("Unknown ticketing add-on.");
  const next = new Set(active());
  if (enabled) next.add(id); else next.delete(id);
  const destination = getInstalledFile();
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = destination + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, installed: [...next] }), { mode: 0o600 });
  fs.renameSync(temporary, destination);
  installed = next;
  return listAddons();
}
function resolveAddonUrl(id, candidate) {
  const addon = requireInstalled(id);
  if (candidate != null && typeof candidate !== "string") throw new Error("Invalid ticket URL.");
  const target = candidate && candidate.trim() ? candidate.trim() : addon.url;
  if (!isSafeWebUrl(target)) throw new Error("Enter a valid HTTPS ticket URL.");
  const url = new URL(target);
  if (!isHostAllowed(url.hostname, addon.allowedHosts)) throw new Error("That URL does not belong to " + addon.name + ".");
  return { provider: addon, url: url.toString() };
}
module.exports = { listAddons, findAddon, requireInstalled, setInstalled, resolveAddonUrl };
