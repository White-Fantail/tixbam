const path = require('node:path');
const { Notification } = require('electron');
const { CardVault, RunSecret } = require('./vault.cjs');
const { PreferenceStore, eventKey, validatePreferences } = require('./preferences.cjs');
const { CitylineAdapter, schemaFor } = require('./cityline.cjs');
const { RehearsalAdapter, rehearsalOptions } = require('./rehearsal.cjs');
const { BookingRunner, TERMINAL } = require('./runner.cjs');
const { resolveOfficialSaleUrl } = require('../security.cjs');
const { assertBookingWindow } = require('./window-binding.cjs');
function registerBooking({ app, safeStorage, ipcMain, dashboardOnly, ticketWindows, requireInstalled, resolveAddonUrl, send }) {
  const vault = new CardVault(path.join(app.getPath('userData'), 'cards.enc'), safeStorage);
  const preferences = new PreferenceStore(path.join(app.getPath('userData'), 'booking-preferences.json'));
  const contexts = new Map(), runs = new Map();
  function emit(state) {
    send('tixbam:booking-changed', state);
    if (['awaiting_user', 'review', 'completed', 'payment_unknown', 'failed'].includes(state.status) && Notification.isSupported()) {
      try { new Notification({ title: state.rehearsal ? 'TIXBAM rehearsal' : 'TIXBAM booking', body: state.message }).show(); } catch { /* Notifications do not interrupt bookings. */ }
    }
  }
  function handle(name, fn) { ipcMain.handle('tixbam:' + name, (event, ...args) => { dashboardOnly(event); return fn(...args); }); }
  handle('vault-status', () => ({ available: vault.available(), cards: vault.available() ? vault.list() : [] }));
  handle('save-card', input => vault.save(input));
  handle('remove-card', id => {
    if ([...runs.values()].some(r => !TERMINAL.has(r.state.status))) throw new Error('Stop active bookings before removing a card.');
    return vault.remove(id);
  });
  handle('booking-context', async ({ providerId, eventUrl, windowId, planId, rehearsal = false }) => {
    const addon = requireInstalled(providerId);
    if (!addon.booking || providerId !== 'cityline') throw new Error('This add-on does not provide booking options yet.');
    // A published sale can link to an official promoter (e.g. Live Nation)
    // instead of the actual Cityline checkout form. The offline demo never
    // visits that URL, but it must still be a trusted, known HTTPS destination.
    const destination = resolveOfficialSaleUrl(providerId, eventUrl);
    if (!rehearsal && destination.providerId !== providerId) {
      throw new Error('This is an event/promoter page, not a Cityline booking URL. Open the official Cityline event booking form and save its direct URL before reading live options. The offline demo can still run.');
    }
    const url = rehearsal ? destination.url : resolveAddonUrl(providerId, eventUrl).url;
    let key = eventKey(providerId, 'rehearsal:' + url);
    if ([...runs.values()].some(r => r.state.eventKey === key && !TERMINAL.has(r.state.status))) throw new Error('Stop this event’s active run before changing its settings.');
    let page, adapter;
    if (rehearsal) page = rehearsalOptions;
    else {
      const entry = ticketWindows.get(windowId);
      if (!entry || entry.providerId !== providerId) throw new Error('Choose an open window for this provider.');
      assertBookingWindow(entry, planId);
      // A saved direct booking link must identify the same event. Landing pages are bound
      // only after the user opens their booking form and explicitly reads its options.
      const savedEventId = new URL(url).searchParams.get('event');
      const currentEventId = new URL(entry.win.webContents.getURL()).searchParams.get('event');
      if (!currentEventId || (savedEventId && currentEventId !== savedEventId)) throw new Error('Open this event’s Cityline booking form first, then read its options.');
      key = eventKey(providerId, 'cityline:event:' + currentEventId);
      adapter = new CitylineAdapter(entry.win.webContents, addon, key, currentEventId);
      page = await adapter.read();
      if (page.challenge || page.stage !== 'options') throw new Error(page.challenge || 'Performance and price options are not visible. Open the booking form first.');
    }
    if ([...runs.values()].some(r => r.state.eventKey === key && !TERMINAL.has(r.state.status))) throw new Error('This event already has an active booking. Manage it in Live windows.');
    const schema = schemaFor(addon, page);
    const contextId = require('node:crypto').randomUUID();
    const ctx = { contextId, eventKey: key, providerId,
      windowId: rehearsal ? undefined : windowId,
      planId: rehearsal ? undefined : planId,
      windowRef: rehearsal ? undefined : ticketWindows.get(windowId)?.win,
      rehearsal, schema, adapter };
    if (contexts.size >= 100) contexts.delete(contexts.keys().next().value);
    contexts.set(contextId, ctx);
    let saved = null;
    try { saved = preferences.get(key, schema); } catch { /* Changed event options require fresh choices. */ }
    return { contextId, eventKey: key, schema, preferences: saved, rehearsal, providerEventId: page.providerEventId, providerTitle: page.providerTitle };
  });
  handle('save-booking-preferences', (contextId, input) => {
    const ctx = contexts.get(contextId); if (!ctx) throw new Error('Read the event options first.');
    requireInstalled(ctx.providerId);
    return preferences.set(ctx.eventKey, input, ctx.schema);
  });
  handle('start-booking', async ({ contextId, preferences: input, cardId, cvv, paymentConsent }) => {
    const ctx = contexts.get(contextId); if (!ctx) throw new Error('Read event options before starting.');
    requireInstalled(ctx.providerId);
    if ([...runs.values()].some(r => !TERMINAL.has(r.state.status) && (r.state.eventKey === ctx.eventKey || (!ctx.rehearsal && r.state.windowId === ctx.windowId)))) throw new Error('A booking is already active for this event or window.');
    // A context is not authority to use a window indefinitely. Revalidate
    // its exact browser and plan before starting, then before every step.
    const assertWindow = ctx.rehearsal ? null : () => {
      const entry = ticketWindows.get(ctx.windowId);
      if (!entry || entry.providerId !== ctx.providerId || entry.win !== ctx.windowRef)
        throw new Error('The original booking window changed or was closed.');
      assertBookingWindow(entry, ctx.planId);
    };
    if (assertWindow) assertWindow();
    const prefs = validatePreferences(input, ctx.schema);
    // AB-01 has no vendor-approved autonomous checkout release. Rehearsal
    // remains available; real user-supervised selection is unchanged.
    if (!ctx.rehearsal && prefs.checkout === 'automatic') {
      throw new Error('Unattended live checkout is not authorized for this provider. Use review mode.');
    }
    if (prefs.checkout === 'automatic' && paymentConsent !== true) throw new Error('Authorize automatic payment within your budget before starting.');
    preferences.set(ctx.eventKey, prefs, ctx.schema);
    let secret;
    if (ctx.rehearsal) secret = { use: fn => fn(null), clear() {} };
    else if (cardId) secret = new RunSecret(vault.unlock(cardId), cvv);
    else if (prefs.checkout === 'automatic') throw new Error('Choose a local card and enter its security code before starting automatic checkout.');
    const adapter = ctx.rehearsal ? new RehearsalAdapter(ctx.eventKey, prefs) : ctx.adapter;
    const runner = new BookingRunner({ adapter, preferences: prefs, eventKey: ctx.eventKey, windowId: ctx.windowId, secret, notify: emit, payment: ctx.rehearsal ? { verified: true, submit: () => adapter.pay() } : null, rehearsal: ctx.rehearsal, assertWindow });
    // Provider-neutral, non-secret AI context. No cards, CVV, cookies or page content.
    runner.setMetadata({
      providerId: ctx.providerId,
      aiContext: {
        quantity: prefs.quantity, currency: prefs.currency,
        budget_minor: prefs.maxTotalMinor, require_together: prefs.requireTogether,
        allow_fallback: prefs.allowFallback
      }
    });
    runs.set(runner.state.id, runner);
    await runner.step(); return runner.state;
  });
  handle('list-bookings', () => [...runs.values()].map(r => r.state));
  handle('resume-booking', async (id, confirm = false) => {
    const runner = runs.get(id); if (!runner) throw new Error('Booking run not found.');
    if (!['awaiting_user', 'review'].includes(runner.state.status) || runner.busy) throw new Error('This run cannot be resumed now.');
    if (runner.state.status === 'review' && confirm !== true) throw new Error('Confirm the displayed order before payment.');
    const reviewing = runner.state.status === 'review';
    if (!reviewing && confirm === true) {
      // A caller cannot turn "resume after CAPTCHA/queue/3DS" into a
      // checkout confirmation. Only the explicit final-order review does so.
      throw new Error('Payment confirmation is only available at final order review.');
    }
    if (!reviewing && runner.adapter.completeChallenge)
      runner.adapter.completeChallenge();
    await runner.step(reviewing && confirm === true); return runner.state;
  });
  handle('stop-booking', id => { const runner = runs.get(id); if (!runner) throw new Error('Booking run not found.'); runner.stop(); return runner.state; });
  const timer = setInterval(() => { for (const r of runs.values()) if (r.state.status === 'running') void r.step(); }, 2000);
  const stopAll = () => { for (const r of runs.values()) if (!TERMINAL.has(r.state.status)) r.stop(); };
  app.on('before-quit', () => { clearInterval(timer); stopAll(); });
  return { stopAll, providerActive(id) { return [...runs.values()].some(r => !TERMINAL.has(r.state.status) && r.adapter.addon?.id === id); }, windowClosed(id) { for (const [key, ctx] of contexts) if (ctx.windowId === id) contexts.delete(key); for (const r of runs.values()) if (r.state.windowId === id && !TERMINAL.has(r.state.status)) r.stop(); } };
}
module.exports = { registerBooking };
