const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  PHASES, assertPlanId, assertPhase, publicLocation,
  readHistory, writeHistory, mergeHistory, activeEntry, isSensitivePhase, findExistingPlanSession,
} = require("./live-workspace-state.cjs");

test("only safe opaque plan references and manually reported phases are accepted", () => {
  for (const id of ["e63ac5a3-f3d3-448c-99d0-44ed33e4bc66", "legacy_123"]) {
    assert.equal(assertPlanId(id), id);
  }
  for (const id of ["../admin", "", "a".repeat(81), "__proto__", "http://evil", "한글"]) {
    assert.throws(() => assertPlanId(id), /Invalid booking plan/);
  }
  assert.deepEqual(PHASES, ["preparing", "waiting", "queue", "selecting", "checkout", "verification"]);
  for (const phase of PHASES) assert.equal(assertPhase(phase), phase);
  for (const phase of ["completed", "purchased", "payment_success", "paid", "automatic", "unknown"]) {
    assert.throws(() => assertPhase(phase), /Unknown live booking stage/);
  }
  assert.equal(isSensitivePhase("verification"), true);
  assert.equal(isSensitivePhase("queue"), false);
});

test("only the HTTPS hostname, never an embedded queue token, reaches the live card", () => {
  const secret = "SECRET_SESSION_TOKEN_DO_NOT_PERSIST";
  assert.equal(publicLocation("https://tickets.example.com/checkout/" + secret + "?queue=" + secret + "#token"),
    "tickets.example.com");
  for (const url of ["javascript:alert(1)", "http://insecure.example/", "about:blank",
    "https://name:password@example.com/"]) {
    assert.equal(publicLocation(url), "Ticket site loading");
  }
});

test("recovery journal writes minimal fields and survives interruptions without restoring a queue", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tixbam-live-"));
  const file = path.join(root, "nested", "recovery.json");
  try {
    const clock = 1785000000000;
    const session = {
      planId: "fbc4f681-69ea-4145-95d2-6a099b07bec9",
      providerId: "cityline", phase: "checkout",
      url: "https://tickets.example/?token=secret",
      title: "secret buyer",
      cardNumber: "4111111111111111",
      cvv: "999"
    };
    const active = activeEntry(session, clock);
    assert.deepEqual(Object.keys(active).sort(),
      ["phase", "planId", "providerId", "reason", "updatedAt"].sort());
    assert.equal(active.reason, "interrupted");
    let rows = mergeHistory([], active, clock);
    writeHistory(file, rows);
    assert.deepEqual(readHistory(file, clock), rows);
    const raw = fs.readFileSync(file, "utf8");
    for (const secret of ["cardNumber", "4111111111111111", "cvv", "999",
      "https://tickets.example", "secret buyer", "token=secret"]) {
      assert.equal(raw.includes(secret), false, secret);
    }
    rows = mergeHistory(rows, { ...active, phase: "verification",
      reason: "closed", updatedAt: clock + 1000 }, clock + 1000);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reason, "closed");
    assert.equal(rows[0].phase, "verification");
    assert.equal(fs.existsSync(file + ".tmp"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("invalid, oversized or stale journal rows are ignored", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tixbam-live-"));
  const file = path.join(root, "recovery.json");
  try {
    const now = Date.now();
    const valid = { planId: "ab12", providerId: "cityline", phase: "queue", updatedAt: now, reason: "interrupted" };
    const stale = { ...valid, planId: "old", updatedAt: now - 40 * 86400000 };
    const malformed = { ...valid, planId: "__proto__" };
    fs.writeFileSync(file, JSON.stringify([malformed, stale, valid]));
    assert.deepEqual(readHistory(file, now), [valid]);
    const many = Array.from({ length: 25 }, (_, i) => ({ ...valid, planId: "plan" + i }));
    writeHistory(file, many);
    assert.equal(readHistory(file, now).length, 16);
    fs.writeFileSync(file, "broken JSON");
    assert.deepEqual(readHistory(file, now), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test("reuse existing plan browser without reloading, even if only payment popup remains", () => {
  const roots = [
    { planId: "a", popup: false, id: 1 },
    { planId: "b", popup: false, id: 2 },
    { planId: "a", popup: true, id: 3 }
  ];
  assert.equal(findExistingPlanSession(roots, "a").id, 1);
  assert.equal(findExistingPlanSession(roots.filter(item => item.id !== 1), "a").id, 3);
  assert.equal(findExistingPlanSession(roots, "c"), null);
});
test("a malformed history row cannot hide otherwise valid recovery records", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tixbam-live-"));
  const file = path.join(root, "recovery.json");
  try {
    const now = Date.now();
    const valid = { planId: "safe", providerId: "cityline", phase: "queue", updatedAt: now, reason: "interrupted" };
    fs.writeFileSync(file, JSON.stringify([null, 42, valid, { ...valid, phase: "paid" }]));
    assert.deepEqual(readHistory(file, now), [valid]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
