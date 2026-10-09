"use strict";

/** Ensure a provider option read never uses a window linked to another ticket target. */
function assertBookingWindow(entry, planId) {
  if (!entry || entry.popup) throw new Error("Choose a main ticketing window for this booking.");
  if (planId != null && (typeof planId !== "string" || entry.planId !== planId)) {
    throw new Error("This browser is not linked to the selected Booking Plan. Open the plan's official ticket site first.");
  }
  if (planId == null && entry.planId) {
    throw new Error("This browser belongs to another Booking Plan. Open that plan's booking settings.");
  }
  return true;
}
module.exports = { assertBookingWindow };