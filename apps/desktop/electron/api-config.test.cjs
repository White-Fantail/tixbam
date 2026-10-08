const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = readFileSync(path.join(__dirname, "../src/api-config.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const context = { exports: {}, URL };
vm.runInNewContext(compiled, context);
const { PRODUCTION_API_URL, resolvePlatformApiUrl } = context.exports;

test("production always uses the official API, even with a developer override", () => {
  assert.equal(PRODUCTION_API_URL, "https://tixbam-production.up.railway.app");
  assert.equal(resolvePlatformApiUrl(false), PRODUCTION_API_URL);
  assert.equal(resolvePlatformApiUrl(false, "http://localhost:8000"), PRODUCTION_API_URL);
  assert.equal(resolvePlatformApiUrl(false, "https://another.example"), PRODUCTION_API_URL);
});

test("development may use a secure or local API override", () => {
  assert.equal(resolvePlatformApiUrl(true, "http://127.0.0.1:8000/"), "http://127.0.0.1:8000");
  assert.equal(resolvePlatformApiUrl(true, " http://localhost:8000 "), "http://localhost:8000");
  assert.equal(resolvePlatformApiUrl(true, "https://dev.example/"), "https://dev.example");
});

test("invalid or unsafe development overrides fall back to production", () => {
  for (const input of ["", "invalid", "http://external.example", "file:///tmp/api",
    "https://user:pass@dev.example", "https://dev.example/path",
    "https://dev.example?token=abc", "https://dev.example/#fragment"]) {
    assert.equal(resolvePlatformApiUrl(true, input), PRODUCTION_API_URL, input);
  }
});
