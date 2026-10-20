/**
 * NOL field observation journal. No provider commands, screenshots, browser URLs,
 * account identifiers, order references, arbitrary notes or seat details.
 * A human-reported step is NEVER independent provider evidence.
 */
export type NolFieldStep =
  | "site_ready" | "login_complete" | "queue_seen"
  | "seat_selection" | "cart_review";
export type NolFieldIssue =
  | "screen_mismatch" | "analysis_slow" | "seat_conflict"
  | "sold_out" | "manual_handoff" | "other_blocker";
export type NolFieldEvent = {
  kind: "step" | "issue";
  code: NolFieldStep | NolFieldIssue;
  elapsedMs: number;
  source: "human_report";
};
export type NolFieldSession = {
  startedAt: number;
  windowId: number;
  planId: string;
  status: "running" | "stopped";
  events: NolFieldEvent[];
  endedAt?: number;
};
export type NolAggregate = {
  classification: "diagnostic_only";
  observationCount: number;
  observationLatencyMs: { p50: number | null; p95: number | null; max: number | null };
  queueEntries: number;
  queueResumptions: number;
  manualPauses: number;
  clickAttempts: number;
  clickRejections: number;
  seatConflicts: number;
  soldOut: number;
  holdUnverified: number;
  officialHoldVerified: false;
};
export const FIELD_STEPS: NolFieldStep[] = [
  "site_ready", "login_complete", "queue_seen", "seat_selection", "cart_review"
];
export const FIELD_ISSUES: NolFieldIssue[] = [
  "screen_mismatch", "analysis_slow", "seat_conflict",
  "sold_out", "manual_handoff", "other_blocker"
];
const safeCount = (n: unknown) =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? Math.min(n, 100000) : 0;
const safeLatency = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;

/** Only locally whitelisted aggregate fields are exported. Never spread IPC data. */
export function safeNolAggregate(input?: Partial<NolAggregate> | null): NolAggregate | null {
  if (!input || input.classification !== "diagnostic_only") return null;
  return {
    classification: "diagnostic_only",
    observationCount: safeCount(input.observationCount),
    observationLatencyMs: {
      p50: safeLatency(input.observationLatencyMs?.p50),
      p95: safeLatency(input.observationLatencyMs?.p95),
      max: safeLatency(input.observationLatencyMs?.max)
    },
    queueEntries: safeCount(input.queueEntries),
    queueResumptions: safeCount(input.queueResumptions),
    manualPauses: safeCount(input.manualPauses),
    clickAttempts: safeCount(input.clickAttempts),
    clickRejections: safeCount(input.clickRejections),
    seatConflicts: safeCount(input.seatConflicts),
    soldOut: safeCount(input.soldOut),
    holdUnverified: safeCount(input.holdUnverified),
    officialHoldVerified: false
  };
}
export function beginNolFieldSession(now: number, windowId: number, planId: string): NolFieldSession {
  return { startedAt: now, windowId, planId, status: "running",
    events: [{ kind: "step", code: "site_ready", elapsedMs: 0, source: "human_report" }] };
}
export function recordNolFieldEvent(
  session: NolFieldSession, kind: "step" | "issue",
  code: NolFieldStep | NolFieldIssue, now: number
): NolFieldSession {
  if (session.status !== "running" || !Number.isFinite(now)) return session;
  if (kind === "step") {
    const index = FIELD_STEPS.indexOf(code as NolFieldStep);
    const last = session.events.filter(e => e.kind === "step").at(-1)?.code as NolFieldStep;
    const lastIndex = FIELD_STEPS.indexOf(last);
    // Do not double count steps, go backwards, or report a cart before selection.
    if (index < 1 || index <= lastIndex ||
      (code === "cart_review" && lastIndex < FIELD_STEPS.indexOf("seat_selection"))) return session;
  } else if (!FIELD_ISSUES.includes(code as NolFieldIssue)) return session;
  return { ...session, events: [...session.events, {
    kind, code, elapsedMs: Math.max(0, Math.round(now - session.startedAt)),
    source: "human_report" as const
  }].slice(0, 100) };
}
export function stopNolFieldSession(session: NolFieldSession, now: number): NolFieldSession {
  return session.status === "stopped" ? session :
    { ...session, status: "stopped", endedAt: Math.max(session.startedAt, now) };
}
export function exportNolFieldReport(session: NolFieldSession, metrics?: Partial<NolAggregate> | null) {
  const end = session.endedAt ?? Date.now();
  const stepEvents = session.events.filter(e => e.kind === "step");
  const lastStep = stepEvents.at(-1)?.code ?? "site_ready";
  const issues = session.events.filter(e => e.kind === "issue");
  return {
    schemaVersion: 1,
    provider: "nol",
    source: "human_reported_live_session",
    validationScope: "non_payment_screen_guidance",
    result: "unverified",
    releaseDecision: "HOLD",
    officialHoldVerified: false,
    purchaseVerified: false,
    providerPermissionEstablished: false,
    humanReportedStage: lastStep,
    humanReportedSteps: stepEvents.length,
    humanReportedIssues: issues.length,
    elapsedMs: Math.max(0, Math.round(end - session.startedAt)),
    // Event codes and relative durations only: deliberately no URL, title,
    // account, exact timestamp, browser ID, order or seat data.
    events: session.events.map(e => ({
      kind: e.kind, code: e.code, elapsedMs: e.elapsedMs, source: e.source
    })),
    copilotAggregate: safeNolAggregate(metrics ?? null),
    interpretation: "Human-reported steps and local diagnostics; not proof of inventory, seat hold, checkout or ticket issuance."
  };
}
