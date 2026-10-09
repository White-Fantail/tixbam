"use strict";
// The rehearsal renderer receives an intentionally small, immutable snapshot.
// Never expose account tokens, provider cookies, sale URLs or payment details.
const { assertPlanId } = require("./live-workspace-state.cjs");
function rehearsalTarget(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error("Invalid rehearsal plan.");
  const id = assertPlanId(plan.id);
  const artist = String(plan.artist || "").trim();
  const title = String(plan.title || "").trim();
  const providerId = String(plan.providerId || "").trim();
  const currency = String(plan.currency || "").trim();
  if (!artist || artist.length > 120 || !title || title.length > 200 ||
      !/^[a-z0-9_-]{1,60}$/.test(providerId) || !/^[A-Z]{3}$/.test(currency) ||
      !Number.isInteger(plan.quantity) || plan.quantity < 1 || plan.quantity > 20 ||
      !Number.isSafeInteger(plan.budgetMinor) || plan.budgetMinor < 0) {
    throw new Error("Invalid rehearsal conditions. Review and save the Booking Plan.");
  }
  return Object.freeze({
    id, artist, title, providerId, currency, quantity: plan.quantity,
    budgetMinor: plan.budgetMinor, requireTogether: plan.requireTogether === true,
    allowFallback: plan.allowFallback === true,
    preferencesReady: plan.preferencesReady === true
  });
}
function findRehearsalBySender(windows, sender) {
  for (const entry of windows.values()) {
    if (!entry.win.isDestroyed() && entry.win.webContents === sender) return entry;
  }
  return null;
}
module.exports = { rehearsalTarget, findRehearsalBySender };
