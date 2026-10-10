const path = require('node:path');
const { Notification } = require('electron');
const { CardVault } = require('./vault.cjs');
const { PreferenceStore, eventKey, validatePreferences } = require('./preferences.cjs');
const { CitylineAdapter, schemaFor } = require('./cityline.cjs');
const { RehearsalAdapter, rehearsalOptions } = require('./rehearsal.cjs');
const { BookingRunner, TERMINAL } = require('./runner.cjs');
const { PaymentAttemptLedger } = require('./payment-attempts.cjs');
const { SessionCoordinator } = require('./session-coordinator.cjs');
const { resolveOfficialSaleUrl } = require('../security.cjs');
const { assertBookingWindow } = require('./window-binding.cjs');
const { ObservationPipeline } = require('./observation.cjs');
const { checkoutReadiness } = require('./checkout-readiness.cjs');
function registerBooking({ app, safeStorage, ipcMain, dashboardOnly, ticketWindows, requireInstalled, resolveAddonUrl, send,
  bookingTarget=null, bookingLease=null }) {
  const vault = new CardVault(path.join(app.getPath('userData'), 'cards.enc'), safeStorage);
  const preferences = new PreferenceStore(path.join(app.getPath('userData'), 'booking-preferences.json'));
  const contexts = new Map(), runs = new Map();
  const observations = new ObservationPipeline();
  const sessionCoordinator = new SessionCoordinator({remote:bookingLease});
  const renewing=new Set();
  // Ledger initialization is fail-closed but cannot prevent manual browsing.
  // A corruption/lock is shown in the booking list instead of being silently
  // treated as an empty journal. Real auto-payment remains disabled by AB-01.
  let paymentLedger = null, journalUnavailable = false;
  try { paymentLedger = new PaymentAttemptLedger(app.getPath('userData')); }
  catch { journalUnavailable = true; }
  function emit(state) {
    if (TERMINAL.has(state.status)) void sessionCoordinator.release(state.id,{
      mayHaveCommitted: state.status==='payment_unknown'||state.status==='completed',
    });
    send('tixbam:booking-changed', state);
    if(!state.rehearsal&&state.phase==='MANUAL_PAYMENT'){
      try{
        const runner=runs.get(state.id);if(!runner)throw Error('Unknown run');
        runner.orchestrator.assertOwner();
        const entry=ticketWindows.get(state.windowId);
        entry.win.show();entry.win.focus();
      }catch{/* Ownership change or a closed window must not redirect payment. */}
    }
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
    // Bundled provider policy controls page access, independently of renderer flags.
    const policy = require('../../addons/catalog.json').find(item => item.id === providerId);
    if (!rehearsal && policy?.bookingAssistance?.mode === 'manual') {
      throw new Error('This provider uses manual booking assistance. Configure local preferences and continue in the official window; live page reading is disabled.');
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
      observations.watchWindow({
        windowId,webContents:entry.win.webContents,providerId,planId:planId||null,
        expectedEventId:currentEventId,allowedHosts:addon.allowedHosts,
        eventQueryParam:'event',pathSuffix:'/eventDetail'
      });
      observations.noteRead({windowId,providerId,page});
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
    return { contextId, eventKey: key, schema, preferences: saved, rehearsal,
      checkoutReadiness:checkoutReadiness(providerId,addon.version),
      providerEventId: page.providerEventId, providerTitle: page.providerTitle };
  });
  handle('booking-readiness', ({providerId}={}) => {
    const addon=requireInstalled(providerId);return checkoutReadiness(providerId,addon.version);
  });
  handle('save-booking-preferences', (contextId, input) => {
    const ctx = contexts.get(contextId); if (!ctx) throw new Error('Read the event options first.');
    requireInstalled(ctx.providerId);
    return preferences.set(ctx.eventKey, input, ctx.schema);
  });
  handle('start-booking', async ({ contextId, preferences: input, cardId, cvv, paymentConsent }) => {
    const ctx = contexts.get(contextId); if (!ctx) throw new Error('Read event options before starting.');
    const installed=requireInstalled(ctx.providerId);
    const readiness=checkoutReadiness(ctx.providerId,installed.version);
    // A level-3 payment restriction must not by itself disable permitted
    // level-2 selection. Cityline's level-2 restriction still blocks it.
    if(!ctx.rehearsal&&(readiness.selectionStatus==='restricted'||
       readiness.blockers.includes('unknown_or_upgraded_addon')))
      throw new Error('Cityline prohibits automated interaction and transactions under its current terms. Use the official window manually; a separately authorized integration is required.');
    if ([...runs.values()].some(r => !TERMINAL.has(r.state.status) && (r.state.eventKey === ctx.eventKey || (!ctx.rehearsal && r.state.windowId === ctx.windowId)))) throw new Error('A booking is already active for this event or window.');
    // A context is not authority to use a window indefinitely. Revalidate
    // its exact browser and plan before starting, then before every step.
    let ownerAcquired=false,runnerId=null;
    const assertWindow = ctx.rehearsal ? null : () => {
      const entry = ticketWindows.get(ctx.windowId);
      if (!entry || entry.providerId !== ctx.providerId || entry.win !== ctx.windowRef)
        throw new Error('The original booking window changed or was closed.');
      assertBookingWindow(entry, ctx.planId);
      if(ownerAcquired) sessionCoordinator.assertOwner(runnerId,ctx.windowId,ctx.eventKey);
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
    // User payment must not unlock or receive a local card.
    else if (prefs.checkout === 'automatic') throw new Error('Choose a local card and enter its security code before starting automatic checkout.');
    const adapter = ctx.rehearsal ? new RehearsalAdapter(ctx.eventKey, prefs) : ctx.adapter;
    const onPageRead=ctx.rehearsal?null:(page,state)=>
      observations.noteRead({windowId:ctx.windowId,providerId:ctx.providerId,page,runId:state.id});
    const runner = new BookingRunner({ adapter, preferences: prefs, eventKey: ctx.eventKey, windowId: ctx.windowId, secret, notify: emit, payment: ctx.rehearsal ? { verified: true, submit: () => adapter.pay() } : null, rehearsal: ctx.rehearsal, assertWindow, onPageRead,
      sessionCoordinator:ctx.rehearsal?null:sessionCoordinator,
      // Rehearsal is simulated and never charges. Live checkout requires a
      // verified permit and journal before a payment executor can be attached.
      ledger: ctx.rehearsal ? null : paymentLedger,
      purchasePermit: null });
    // Provider-neutral, non-secret AI context. No cards, CVV, cookies or page content.
    runner.setMetadata({
      providerId: ctx.providerId,
      aiContext: {
        quantity: prefs.quantity, currency: prefs.currency,
        budget_minor: prefs.maxTotalMinor, require_together: prefs.requireTogether,
        allow_fallback: prefs.allowFallback
      }
    });
    if(!ctx.rehearsal){
      // Lease acquisition is based exclusively on a fresh authenticated
      // account/plan read, never a renderer-supplied user or sale ID.
      try{
        if(typeof bookingTarget!=='function'||typeof bookingLease!=='function'||
           !ctx.planId)throw new Error('A registered Booking Plan and signed-in account are required.');
        const target=await bookingTarget(ctx.planId,ctx.providerId);
        if(!target||!target.performanceId||!target.saleId||!target.accountId)
          throw new Error('A verified performance and sale are required.');
        await sessionCoordinator.acquire({
          runId:runner.state.id,windowId:ctx.windowId,
          eventKey:ctx.eventKey,...target,
        });
        ownerAcquired=true;runnerId=runner.state.id;
        if(assertWindow)assertWindow();
      }catch{
        runner.stop();throw new Error('Cannot acquire the verified booking session on this device. Use the official provider window manually.');
      }
    }
    runs.set(runner.state.id, runner);
    await runner.step(); return runner.state;
  });
  handle('list-bookings', () => {
    const live=[...runs.values()].map(r=>r.state);
    if(journalUnavailable || !paymentLedger) return [...live,{
      id:'journal-unavailable',eventKey:'unverified',status:'payment_unknown',
      phase:'PAYMENT_UNKNOWN',revision:0,generation:0,
      message:'Payment safety journal is unavailable. Automatic payment is blocked until reviewed.',
      startedAt:0,rehearsal:false,storageRecovered:true
    }];
    try {return [...live,...paymentLedger.recovered()];}
    catch {return [...live,{
      id:'journal-unavailable',eventKey:'unverified',status:'payment_unknown',
      phase:'PAYMENT_UNKNOWN',revision:0,generation:0,
      message:'Payment safety journal cannot be verified. Automatic payment is blocked.',
      startedAt:0,rehearsal:false,storageRecovered:true
    }];}
  });
  handle('resume-booking', async (id, confirm = false) => {
    const runner = runs.get(id); if (!runner) throw new Error('Booking run not found.');
    if(['MANUAL_PAYMENT','RESERVATION_UNKNOWN'].includes(runner.state.phase))
      throw new Error('Complete payment in the same provider window. This run cannot resume automation.');
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
  const timer = setInterval(() => {
    for(const r of runs.values()){
      if(TERMINAL.has(r.state.status))continue;
      if(!r.state.rehearsal){
        try{
          const own=sessionCoordinator.assertOwner(r.state.id,r.state.windowId,r.state.eventKey);
          if(own.expiresAtMs-Date.now()<20000 && !renewing.has(r.state.id)){
            renewing.add(r.state.id);
            void sessionCoordinator.renew(r.state.id).catch(()=>r.stop()).finally(()=>renewing.delete(r.state.id));
          }
        }catch{r.stop();continue;}
      }
      if(r.state.status==='running')void r.step();
    }
  },2000);
  const stopAll = () => { for (const r of runs.values()) if (!TERMINAL.has(r.state.status)) r.stop(); sessionCoordinator.invalidateAll(); observations.invalidateAll(); };
  app.on('before-quit', () => { clearInterval(timer); stopAll(); });
  return { stopAll, accountChanged() { stopAll(); contexts.clear(); }, invalidateObservations() { observations.invalidateAll(); }, providerActive(id) { return [...runs.values()].some(r => !TERMINAL.has(r.state.status) && r.adapter.addon?.id === id); }, windowClosed(id) { sessionCoordinator.invalidateWindow(id); observations.unwatchWindow(id); for (const [key, ctx] of contexts) if (ctx.windowId === id) contexts.delete(key); for (const r of runs.values()) if (r.state.windowId === id && !TERMINAL.has(r.state.status)) r.stop(); } };
}
module.exports = { registerBooking };
