const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const catalog = require('../addons/catalog.json');
function loadTS(file) {
  const source = fs.readFileSync(path.join(__dirname, '../src/booking', file), 'utf8');
  const {outputText} = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}});
  const module = {exports: {}};
  const scopedRequire = name => name === '../i18n' ? {tx: text => text, useLanguage() {}} : name === './manual-assist' ? loadTS('manual-assist.ts') : require(name);
  vm.runInNewContext(outputText, {exports: module.exports, module, require: scopedRequire, window: {}, localStorage: {getItem: () => null}});
  return module.exports;
}
const {hkdMinor, parseManualDraft, remainingSeconds, userDeadline} = loadTS('manual-assist.ts');
test('local budget input preserves HKD cents and rejects unsafe or ambiguous amounts', () => {
  assert.equal(hkdMinor('1234.56'), 123456);
  assert.equal(hkdMinor('0.01'), 1);
  for (const value of ['', '0', '-1', '1e5', 'NaN', 'Infinity', '1.001', '1,000', '999999999999999999']) assert.equal(hkdMinor(value), null, value);
});
test('user-entered countdown never invents a default deadline and catches elapsed time after sleep', () => {
  assert.equal(userDeadline('', '', 1000), null);
  assert.equal(userDeadline('0', '0', 1000), null);
  assert.equal(userDeadline('1', '60', 1000), null);
  assert.equal(userDeadline('999', '0', 1000), null);
  assert.equal(userDeadline('1', '30', 1000), 91000);
  assert.equal(remainingSeconds(null, 1000), null);
  assert.equal(remainingSeconds(91000, 1000), 90);
  assert.equal(remainingSeconds(91000, 90500), 1);
  assert.equal(remainingSeconds(91000, 200000), 0);
});
test('persisted preparation excludes cart proof, payment details and hold assertions', () => {
  const parsed = parseManualDraft({quantity: 3, budget: '99.99', performance: 'Evening', cartReported: true, deadline: 123, cvv: '123', receipt: 'fake', seatMode: 'bad'});
  assert.equal(parsed.quantity, 3);
  assert.equal(parsed.budget, '99.99');
  assert.equal(parsed.seatMode, '');
  for (const key of ['cartReported', 'deadline', 'cvv', 'receipt']) assert.equal(Object.hasOwn(parsed, key), false);
  for (const quantity of [NaN, -1, 0, 1.5, 999]) assert.equal(parseManualDraft({quantity}).quantity, 2);
  assert.equal(parseManualDraft({performance: 'x'.repeat(2000)}).performance.length, 1000);
});
test('Cityline assistance is provider-specific and retains restricted automation and user payment', () => {
  const cityline = catalog.find(addon => addon.id === 'cityline');
  assert.equal(cityline.bookingAssistance.mode, 'manual');
  assert.equal(cityline.bookingAssistance.payment, 'user');
  assert.equal(cityline.automation.level2.status, 'restricted');
  assert.equal(cityline.automation.level3.status, 'restricted');
  for (const other of catalog.filter(addon => addon.id !== 'cityline')) assert.equal(other.bookingAssistance, undefined);
});
test('actual manual panel renders useful preparation without starting a booking, reading a page or requesting cards', () => {
  const {renderToStaticMarkup} = require('react-dom/server');
  const React = require('react');
  const {ManualBookingAssist} = loadTS('ManualBookingAssist.tsx');
  const addon = catalog.find(addon => addon.id === 'cityline');
  const html = renderToStaticMarkup(React.createElement(ManualBookingAssist, {addon, event: {id: 'event', title: 'Concert', providerId: 'cityline'}, windows: [], onClose() {}}));
  assert.match(html, /Local booking preparation/);
  assert.match(html, /Your seat priorities/);
  assert.match(html, /Open official ticket window/);
  assert.match(html, /Purchase guide/);
  assert.doesNotMatch(html, /Read live options|Start booking|CVV|Local payment card/);
});

test('guide launcher accepts only bundled official document names, not arbitrary URLs', () => {
  const {resolveAssistanceGuide} = require('./assistance-guide.cjs');
  assert.match(resolveAssistanceGuide('cityline', 'guide'), /^https:\/\/www\.cityline\.com\.hk\//);
  assert.match(resolveAssistanceGuide('cityline', 'faq'), /General_FAQ_en_US\.pdf$/);
  for (const kind of ['__proto__', 'constructor', 'https://evil.example', 'javascript:alert(1)', null]) assert.throws(() => resolveAssistanceGuide('cityline', kind));
  assert.throws(() => resolveAssistanceGuide('other', 'guide'));
});
