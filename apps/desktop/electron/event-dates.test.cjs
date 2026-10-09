const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const typescript = require("typescript");

// The production formatter is TypeScript; transpile the same source for Node's
// test runner rather than maintaining a second, divergent date implementation.
const source = fs.readFileSync(path.join(__dirname, "../src/event-dates.ts"), "utf8");
const compiled = typescript.transpileModule(source, {
  compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 }
}).outputText;
const exportsUnderTest = {};
vm.runInNewContext(compiled, { exports: exportsUnderTest });
const { formatFavoritePerformanceDate: format } = exportsUnderTest;

function event(performances, timezone = "Asia/Hong_Kong", startsAt = null) {
  return { performances, timezone, startsAt };
}

test("favorite dates use venue timezone, not the viewer timezone or sale date", () => {
  const show = { startsAt: "2027-01-15T12:00:00Z", timezone: "Asia/Hong_Kong" };
  const display = format(event([show]));
  assert.match(display, /15 Jan 2027/);
  assert.match(display, /20:00/);
  assert.match(display, /venue time/);
});

test("favorite dates handle the next calendar day at the venue", () => {
  const show = { startsAt: "2027-01-15T23:30:00Z", timezone: "Pacific/Auckland" };
  const display = format(event([show], "Pacific/Auckland"));
  assert.match(display, /16 Jan 2027/);
  assert.match(display, /12:30/);
});

test("multiple performances show an inclusive local date range and session count", () => {
  const performances = [
    { startsAt: "2026-11-08T07:30:00Z", timezone: "Asia/Tokyo" },
    { startsAt: "2026-11-06T09:00:00Z", timezone: "Asia/Tokyo" },
    { startsAt: "2026-11-07T08:00:00Z", timezone: "Asia/Tokyo" }
  ];
  const display = format(event(performances, "Asia/Tokyo"));
  assert.match(display, /6[^0-9]+8 Nov 2026/);
  assert.match(display, /3 sessions/);
});

test("partially unknown dates are not silently omitted", () => {
  const display = format(event([
    { startsAt: "2027-01-15T12:00:00Z", timezone: "Asia/Hong_Kong" },
    { startsAt: null, timezone: "Asia/Hong_Kong" }
  ]));
  assert.match(display, /15 Jan 2027/);
  assert.match(display, /2 sessions/);
  assert.match(display, /1 date TBA/);
});

test("unknown performances show TBA rather than legacy or ticket sale dates", () => {
  assert.equal(format(event([{ startsAt: null }], "Asia/Tokyo", "2027-01-15T12:00:00Z")), "Date TBA");
  assert.equal(format(event([], "Asia/Tokyo")), "Date TBA");
});

test("older events without performances may use their legacy start time", () => {
  assert.match(format(event([], "Asia/Hong_Kong", "2027-01-15T12:00:00Z")), /15 Jan 2027/);
});

test("invalid venue time zones safely fall back to UTC", () => {
  const display = format(event([{ startsAt: "2027-01-15T12:00:00Z", timezone: "Invalid/Timezone" }]));
  assert.match(display, /15 Jan 2027/);
  assert.match(display, /12:00/);
});
