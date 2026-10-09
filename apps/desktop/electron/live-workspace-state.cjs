"use strict";
/**
 * Minimal, non-sensitive live booking metadata. Never store full URLs,
 * page text, cookies, CAPTCHA/queue tokens, seats, cards or payment data.
 * Stages are explicitly USER-REPORTED, never inferred from the provider DOM.
 */
const fs = require("node:fs");
const path = require("node:path");

const PHASES = Object.freeze(["preparing", "waiting", "queue", "selecting", "checkout", "verification"]);
const PLAN_ID = /^[a-zA-Z0-9_-]{1,80}$/;
const MAX_HISTORY = 16;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function validPlanId(value) {
  return typeof value === "string" && PLAN_ID.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
}
function assertPlanId(value) {
  if (!validPlanId(value)) throw new Error("Invalid booking plan reference.");
  return value;
}
function assertPhase(value) {
  if (!PHASES.includes(value)) throw new Error("Unknown live booking stage.");
  return value;
}
function publicLocation(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password) return "Ticket site loading";
    // Deliberately omit query, fragments and path (which may contain queue tokens).
    return u.hostname.toLowerCase();
  } catch {
    return "Ticket site loading";
  }
}
function historyRow({ planId, providerId, phase, updatedAt, reason }) {
  if (!validPlanId(planId) || !/^[a-z0-9_-]{1,60}$/.test(providerId || "") ||
      !PHASES.includes(phase) || !Number.isFinite(updatedAt) ||
      !["interrupted", "closed"].includes(reason)) return null;
  return { planId, providerId, phase, updatedAt, reason };
}
function readHistory(filename, now = Date.now()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : [];
    return rows.map(historyRow).filter(row =>
      row && row.updatedAt <= now + 60000 && row.updatedAt > now - MAX_AGE_MS).slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}
function writeHistory(filename, rows) {
  const data = rows.map(historyRow).filter(Boolean).slice(-MAX_HISTORY);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temp = filename + ".tmp";
  try {
    fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(temp, filename);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* best-effort cleanup */ }
    throw error;
  }
}
function activeEntry(entry, now = Date.now()) {
  return historyRow({ planId: entry.planId, providerId: entry.providerId,
    phase: entry.phase || "preparing", updatedAt: now, reason: "interrupted" });
}
function mergeHistory(rows, entry, now = Date.now()) {
  const next = historyRow(entry);
  const keep = rows.filter(row => !(next && row.planId === next.planId));
  return (next ? [...keep, next] : keep).filter(row => row.updatedAt > now - MAX_AGE_MS).slice(-MAX_HISTORY);
}
function isSensitivePhase(phase) {
  return phase === "checkout" || phase === "verification";
}
module.exports = {
  PHASES, assertPlanId, assertPhase, publicLocation, validPlanId, readHistory,
  writeHistory, mergeHistory, activeEntry, isSensitivePhase,
};