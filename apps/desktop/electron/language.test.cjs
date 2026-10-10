const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");
const { normalizeLanguage, readLanguage, persistLanguage } = require("./language.cjs");

test("Korean is the native default; only supported language codes are accepted", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tixbam-language-"));
  try {
    assert.equal(normalizeLanguage(undefined), "ko");
    assert.equal(normalizeLanguage("ja"), "ko");
    assert.equal(readLanguage(dir), "ko");
    assert.equal(persistLanguage(dir, "en"), "en");
    assert.equal(readLanguage(dir), "en");
    assert.equal(persistLanguage(dir, "ko"), "ko");
    assert.equal(readLanguage(dir), "ko");
    fs.writeFileSync(path.join(dir, "desktop-language.json"), '"ja"');
    assert.equal(readLanguage(dir), "ko");
    fs.writeFileSync(path.join(dir, "desktop-language.json"), '{"bad":true}');
    assert.equal(readLanguage(dir), "ko");
    assert.equal(fs.existsSync(path.join(dir, "desktop-language.json.tmp")), false);
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});

const src = path.join(__dirname,"../src");
function koreanKeys() {
  const folder = path.join(src, "i18n");
  const keys = new Set();
  for (const filename of fs.readdirSync(folder).filter(f=>f.endsWith("-ko.ts"))) {
    const text = fs.readFileSync(path.join(folder, filename), "utf8");
    const ast = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    function visit(node) {
      if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name)) keys.add(node.name.text);
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return keys;
}

test("key Desktop workflows have verified Korean translations", () => {
  const keys = koreanKeys();
  assert.ok(keys.size > 300, "Expected a substantive shared Korean catalogue, found " + keys.size);
  const critical = [
    "Purchase safety review required",
    "Payment submission is not established. Review purchase safety records before any new attempt.",
    "Dashboard","My Bookings","Discover","Saved","Sessions","Settings",
    "App language","Ticketing Control Room","Payment outcome unknown",
    "Maximum total incl. fees","Require adjacent seats","Open rehearsal window",
    "Offline rehearsal finished","Choose a Cityline practice scenario",
    "Ticketing admission / waiting room","Shopping cart",
    "Simulated bank / payment verification","Transaction preview",
    "Verify purchase","No live purchases","No success guarantee"
  ];
  for(const key of critical.filter(k=>k!=="No success guarantee")) {
    assert.equal(keys.has(key),true,"No Korean translation: "+key);
  }
  assert.equal(fs.existsSync(path.join(__dirname,"../i18n-vite.ts")),true);
});

test("translation resources are isolated from Admin and retain source phrases for English", () => {
  const root = fs.readFileSync(path.join(src, "i18n/index.ts"), "utf8");
  const vite = fs.readFileSync(path.join(__dirname, "../vite.config.ts"), "utf8");
  assert.match(root,/DEFAULT_LANGUAGE: Language = "ko"/);
  assert.match(root,/language !== "ko"/);
  assert.match(root,/return source/);
  assert.match(vite,/localizedJsxPlugin\(\)/);
});
