const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Exercise exactly the same pure code that the Electron renderer executes.
const source = fs.readFileSync(path.join(__dirname, "../src/ticket-sales.ts"), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const exportsUnderTest = {};
vm.runInNewContext(js, { exports: exportsUnderTest, Intl, Date });
const { getSaleTiming: status, pickNextSale: pick, matchesSaleFilter: filter,
  formatSaleLocalTime: date, saleAppliesToPerformance: applies } = exportsUnderTest;
const now = Date.parse("2026-10-09T00:00:00Z");
const at = (delta) => new Date(now + delta).toISOString();
const day = 86400000;

test("upcoming countdown transitions through D-days, days/hours, minutes and started", () => {
  assert.deepEqual(Object.assign({},status(at(10*day),now)), { phase:"upcoming",label:"D-10 until sale" });
  assert.deepEqual(Object.assign({},status(at(3*day+3*3600000),now)), {phase:"soon",label:"Opens in 3d 3h"});
  assert.deepEqual(Object.assign({},status(at(3*3600000+5*60000),now)), {phase:"soon",label:"Opens in 3h 5m"});
  assert.deepEqual(Object.assign({},status(at(45*60000),now)), {phase:"imminent",label:"Opens in 45m"});
  assert.equal(status(at(5000),now).label,"Opens in 1m");
  assert.equal(status(at(0),now).label,"Sale started");
  assert.equal(status(at(-day),now).phase,"started");
});

test("past opening never guesses tickets unavailable or sold out", () => {
  assert.equal(status(at(-day),now).label, "Sale started");
  assert.equal(status(null,now).phase, "tba");
  assert.equal(status("nonsense",now).phase, "tba");
  assert.equal(status(at(-day),now,"sold_out").phase,"sold-out");
  assert.equal(status(at(day),now,"cancelled").phase,"cancelled");
  assert.equal(status(at(day),now,"postponed").phase,"postponed");
});

test("pick the next upcoming sale across multiple presales, then most recent past one", () => {
  const items = [
    {id:"old",saleAt:at(-day),appliesToAll:true,performanceIds:[]},
    {id:"late",saleAt:at(6*day),appliesToAll:true,performanceIds:[]},
    {id:"soon",saleAt:at(2*day),appliesToAll:true,performanceIds:[]},
    {id:"tba",saleAt:null,appliesToAll:true,performanceIds:[]}
  ];
  assert.equal(pick(items,now).id,"soon");
  assert.equal(pick(items,now+3*day).id,"late");
  assert.equal(pick(items,now+8*day).id,"late");
  assert.equal(pick([items[3]],now).id,"tba");
  assert.equal(pick([],now),null);
});

test("performance-restricted sales never leak into another session's countdown", () => {
  const items = [
    {id:"a",saleAt:at(day),appliesToAll:false,performanceIds:["A"]},
    {id:"b",saleAt:at(2*day),appliesToAll:false,performanceIds:["B"]},
    {id:"both",saleAt:at(3*day),appliesToAll:true,performanceIds:[]}
  ];
  assert.equal(applies(items[0],"B"),false);
  assert.equal(pick(items,now,"B").id,"b");
  assert.equal(pick(items,now,"missing").id,"both");
});

test("upcoming filters ignore past and unknown sales and include seven-day boundary", () => {
  assert.equal(filter([at(-day),null],now,"all"),true);
  assert.equal(filter([at(-day),null],now,"upcoming"),false);
  assert.equal(filter([at(day)],now,"week"),true);
  assert.equal(filter([at(7*day)],now,"week"),true);
  assert.equal(filter([at(7*day+1000)],now,"week"),false);
  assert.equal(filter([at(8*day)],now,"upcoming"),true);
  assert.equal(filter([],now,"week"),false);
});

test("on-sale schedule formatting uses sale timezone rather than desktop timezone", () => {
  assert.match(date("2026-10-15T07:00:00Z","Asia/Hong_Kong"),/15 Oct 2026, 15:00 \(Asia\/Hong_Kong\)/);
  assert.match(date("2026-10-15T07:00:00Z","Invalid/Zone"),/UTC/);
  assert.equal(date(null,"Asia/Hong_Kong"),"Sale date TBA");
});
