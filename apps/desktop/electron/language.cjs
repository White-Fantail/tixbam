"use strict";
const fs = require("node:fs");
const path = require("node:path");
const LANGUAGE_VALUES = ["ko", "en"];
function normalizeLanguage(code) { return LANGUAGE_VALUES.includes(code) ? code : "ko"; }
function readLanguage(dir) {
  try {
    const code = JSON.parse(fs.readFileSync(path.join(dir, "desktop-language.json"), "utf8"));
    return normalizeLanguage(code);
  } catch { return "ko"; }
}
function persistLanguage(dir, language) {
  const value = normalizeLanguage(language);
  const file = path.join(dir, "desktop-language.json");
  fs.mkdirSync(dir, { recursive: true });
  const temp = file + ".tmp";
  try {
    fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temp, file);
  } catch(err) {
    try { fs.unlinkSync(temp); } catch {}
    throw err;
  }
  return value;
}
module.exports = { normalizeLanguage, readLanguage, persistLanguage };
