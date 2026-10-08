const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveAgentHandoff } = require("./agent-handoff.cjs");

test("Live Nation presale handoff accepts explicitly supplied approved ticket agents", () => {
  assert.deepEqual(resolveAgentHandoff("livenation", "https://www.cityline.com.hk/utsvInternet/internet/eventDetail?event=ABC"), {
    providerId: "cityline", url: "https://www.cityline.com.hk/utsvInternet/internet/eventDetail?event=ABC"
  });
  assert.equal(resolveAgentHandoff("livenation", "https://www.ticketmaster.com/event/123").providerId, "ticketmaster");
});
test("handoff rejects unsupported, unsafe and forged URLs", () => {
  for (const url of [
    "https://www.cityline.com.hk.evil.example/",
    "https://example.com/",
    "https://username:password@cityline.com.hk/",
    "javascript:alert(1)",
    "http://www.cityline.com.hk/",
    "https://livenation.hk/"
  ]) assert.throws(() => resolveAgentHandoff("livenation", url));
  assert.throws(() => resolveAgentHandoff("cityline", "https://www.ticketmaster.com/"));
});
