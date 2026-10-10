const { app, BrowserWindow, ipcMain, session, safeStorage, shell, dialog } = require("electron");
const path = require("node:path");
const { readLanguage, persistLanguage } = require("./language.cjs");
const { MAX_WINDOWS, isSafeWebUrl, resolveOfficialSaleUrl } = require("./security.cjs");
const { findAddon, requireInstalled, listAddons, setInstalled, resolveAddonUrl } = require("./addon-manager.cjs");
const { resolveAssistanceGuide } = require("./assistance-guide.cjs");
const { resolveAgentHandoff } = require("./agent-handoff.cjs");

const { registerBooking } = require("./booking/controller.cjs");
const { registerAccount } = require("./account.cjs");
const { rehearsalTarget, findRehearsalBySender } = require("./rehearsal-window.cjs");
const { RehearsalDriver } = require("./booking/rehearsal-driver.cjs");
const { RehearsalPlanner } = require("./booking/ai-planner.cjs");
const { RecoveryEngine } = require("./booking/recovery.cjs");
const { LiveCopilot } = require("./copilot/host.cjs");
const { assertPlanId, assertPhase, publicLocation, readHistory, writeHistory,
  activeEntry, mergeHistory, isSensitivePhase, findExistingPlanSession } = require("./live-workspace-state.cjs");
let booking;
let desktopLanguage = "ko";
function nativeCopy(en, ko) { return desktopLanguage === "ko" ? ko : en; }
let dashboard = null;
function notifyLanguage() {
  const wins = [dashboard, ...[...rehearsalWindows.values()].map(e=>e.win)];
  for (const win of wins) if (win && !win.isDestroyed())
    win.webContents.send("tixbam:language-changed", desktopLanguage);
}
const ticketWindows = new Map();
const copilot = new LiveCopilot({ticketWindows,requireInstalled});
const rehearsalWindows = new Map();
const rehearsalWrites = new Map();
let rehearsalRequestSequence = 0;
const REHEARSAL_SAVE_TIMEOUT_MS = 20000;

function rehearsalEntry(event) {
  const entry = findRehearsalBySender(rehearsalWindows, event.sender);
  if (!entry || event.senderFrame !== entry.win.webContents.mainFrame) {
    throw new Error("Only a TIXBAM rehearsal window can perform this action.");
  }
  return entry;
}
function rejectRehearsalWrites(planId) {
  for (const [id, pending] of rehearsalWrites) {
    if (pending.planId !== planId) continue;
    clearTimeout(pending.timer);
    rehearsalWrites.delete(id);
    pending.reject(new Error("The rehearsal window closed before saving finished."));
  }
}
function openRehearsalWindow(plan, accountId) {
  const target = rehearsalTarget(plan);
  if (accountId !== null && (typeof accountId !== "string" ||
      accountId.length < 1 || accountId.length > 128)) {
    throw new Error("Invalid rehearsal account.");
  }
  const ownerId = accountId;
  const existing = rehearsalWindows.get(target.id);
  if (existing && !existing.win.isDestroyed()) {
    if (existing.ownerId !== ownerId) {
      throw new Error("A rehearsal for this plan is already open under another account. Close that window first.");
    }
    if (existing.win.isMinimized()) existing.win.restore();
    existing.win.show();
    existing.win.focus();
    return { reused: true, planId: target.id };
  }
  const win = new BrowserWindow({
    width: 1200, height: 900, minWidth: 760, minHeight: 600,
    backgroundColor: "#10101b", title: "TIXBAM — Rehearsal · " + target.artist,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "rehearsal-preload.cjs"),
      partition: "persist:tixbam-rehearsal",
      contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true
    }
  });
  // Never pass the protected lab object to the rehearsal renderer.
  const lab = new RehearsalDriver({rootDir:app.getPath("userData"),plan:target,ownerId});
  const labPlanner = new RehearsalPlanner();
  const labRecovery = new RecoveryEngine({planner:labPlanner});
  rehearsalWindows.set(target.id, { win, target, ownerId, lab, labPlanner, labRecovery });
  win.webContents.on("will-navigate", event => event.preventDefault());
  win.webContents.on("will-attach-webview", event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.on("closed", () => {
    const previous = rehearsalWindows.get(target.id);
    if (previous?.win === win) {
      previous.labRecovery.invalidate();
      rehearsalWindows.delete(target.id);
    }
    rejectRehearsalWrites(target.id);
    if (dashboard && !dashboard.isDestroyed()) {
      dashboard.webContents.send("tixbam:rehearsal-closed", target.id);
      if (!closingApplication && !dashboard.isVisible()) dashboard.show();
    }
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const loading = devUrl === "http://127.0.0.1:5173"
    ? win.loadURL(devUrl + "/?rehearsal=1")
    : win.loadFile(path.join(__dirname, "../dist/index.html"), { query: { rehearsal: "1" } });
  loading.catch(error => {
    console.warn("Rehearsal window could not load:", error.message);
    if (!win.isDestroyed()) win.close();
  });
  return { reused: false, planId: target.id };
}

let recoveryFile = null;
let liveHistory = [];
let quittingConfirmed = false;
let closingApplication = false;

function rememberSession(entry, reason = "interrupted") {
  if (!entry?.planId || entry.popup || !recoveryFile) return;
  liveHistory = mergeHistory(liveHistory, { ...activeEntry(entry), reason });
  try { writeHistory(recoveryFile, liveHistory); }
  catch (error) { console.warn("Live session recovery could not be saved:", error.message); }
}

function visibleHistory() {
  const activePlans = new Set([...ticketWindows.values()].map(entry => entry.planId).filter(Boolean));
  return liveHistory.filter(row => !activePlans.has(row.planId));
}

function confirmSessionClose(win, entry, event) {
  if (closingApplication || !entry.planId || win.isDestroyed()) return;
  const response = dialog.showMessageBoxSync(win, {
    type: "warning",
    title: nativeCopy("Leave this ticketing session?", "진행 중인 티켓팅을 종료할까요?"),
    message: nativeCopy("Closing this browser may lose your position or unfinished order.",
      "이 창을 닫으면 대기 순서나 진행 중인 주문이 사라질 수 있어요."),
    detail: isSensitivePhase(entry.phase)
      ? nativeCopy("You marked this session as checkout or verification. Check the ticket provider's order history before retrying or paying again.",
        "결제 또는 인증 중인 것으로 표시돼 있어요. 재시도나 추가 결제 전에 공식 주문 내역을 확인하세요.")
      : nativeCopy("Keep this window open while you are in a waiting room or queue. Closing cannot be undone.",
        "대기실이나 대기열에서는 창을 유지하세요. 닫으면 대기 순서를 복구할 수 없어요."),
    buttons: [nativeCopy("Keep window open", "창 유지"), nativeCopy("Close anyway", "그래도 닫기")],
    defaultId: 0, cancelId: 0, noLink: true
  });
  if (response !== 1) event.preventDefault();
}

function trackWindow(win, { providerId, planId = null, popup = false, parentId = null }) {
  const wc = win.webContents;
  if (popup) wc.setWindowOpenHandler(({ url: requestedUrl }) => {
    if (ticketWindows.size >= MAX_WINDOWS ||
        (requestedUrl !== "about:blank" && !isSafeWebUrl(requestedUrl))) return { action: "deny" };
    return { action: "allow", overrideBrowserWindowOptions: {
      autoHideMenuBar: true,
      webPreferences: { partition: "persist:tixbam-" + providerId,
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true }
    } };
  });
  const entry = {
    win, providerId, planId, popup, parentId, openedAt: Date.now(),
    phase: "preparing", loadError: null
  };
  ticketWindows.set(win.id, entry);
  wc.on("did-start-loading", () => { copilot.clear(win.id); entry.loadError = null; broadcast(); });
  wc.on("did-stop-loading", broadcast);
  wc.on("page-title-updated", broadcast);
  wc.on("did-navigate", () => { copilot.clear(win.id); broadcast(); });
  wc.on("did-navigate-in-page", () => { copilot.clear(win.id); broadcast(); });
  wc.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) { entry.loadError = Number.isInteger(code) ? code : -1; broadcast(); }
  });
  wc.on("did-create-window", child => {
    // Some providers open their login, seat or bank verification in a popup.
    // Keep it visible in Sessions, but do not inspect its contents.
    trackWindow(child, { providerId, planId, popup: true, parentId: win.id });
    broadcast();
  });
  wc.on("will-navigate", (event, target) => {
    if (!isSafeWebUrl(target)) event.preventDefault();
  });
  wc.on("will-attach-webview", event => event.preventDefault());
  win.on("close", event => confirmSessionClose(win, entry, event));
  win.on("closed", () => {
    if (planId && !popup) rememberSession(entry, closingApplication ? "interrupted" : "closed");
    copilot.clear(win.id);
    booking?.windowClosed(win.id);
    ticketWindows.delete(win.id);
    broadcast();
  });
  if (planId && !popup) rememberSession(entry);
  return entry;
}

function serializedWindows() {
  return Array.from(ticketWindows.values()).map(({ win, providerId, planId, phase, popup, parentId, openedAt, loadError }) => ({
    id: win.id,
    providerId,
    planId,
    phase,
    popup,
    parentId,
    title: win.getTitle(),
    url: win.webContents.getURL(),
    site: publicLocation(win.webContents.getURL()),
    loadError,
    loading: win.webContents.isLoading(),
    openedAt
  }));
}

function broadcast() {
  if (dashboard && !dashboard.isDestroyed()) {
    dashboard.webContents.send("tixbam:windows-changed", serializedWindows());
  }
}

function dashboardOnly(event) {
  if (!dashboard || (event.sender !== dashboard.webContents || event.senderFrame !== dashboard.webContents.mainFrame)) {
    throw new Error("This action is only available in the TIXBAM dashboard.");
  }
}

function createDashboard() {
  dashboard = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#090911",
    title: "TIXBAM",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  dashboard.webContents.on("will-navigate", event => event.preventDefault());
  dashboard.webContents.on("will-attach-webview", event => event.preventDefault());
  dashboard.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl === "http://127.0.0.1:5173") {
    dashboard.loadURL(devUrl);
  } else {
    dashboard.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  dashboard.on("close", event => {
    if (closingApplication) return;
    if ([...ticketWindows.values()].some(entry => entry.planId) || rehearsalWindows.size > 0) {
      // Closing the dashboard currently stops booking runs. Hide it instead
      // so the host continues supervising open ticket windows.
      event.preventDefault();
      dashboard.hide();
    }
  });
  dashboard.on("closed", () => { booking?.stopAll(); dashboard = null; });
}

function openTicketWindow({ providerId, url: candidate, planId = null } = {}) {
  const { provider, url } = resolveAddonUrl(providerId, candidate);
  if (planId !== null) assertPlanId(planId);
  if (ticketWindows.size >= MAX_WINDOWS) {
    throw new Error("You can have up to " + MAX_WINDOWS + " ticketing windows open.");
  }
  const count = Array.from(ticketWindows.values()).filter((entry) => entry.providerId === providerId).length;
  const partition = "persist:tixbam-" + provider.id;
  const providerSession = session.fromPartition(partition);
  providerSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 650,
    minHeight: 480,
    x: 80 + count * 44,
    y: 65 + count * 44,
    backgroundColor: "#ffffff",
    title: provider.name + " — TIXBAM",
    autoHideMenuBar: true,
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url: requestedUrl }) => {
    if (ticketWindows.size >= MAX_WINDOWS ||
        (requestedUrl !== "about:blank" && !isSafeWebUrl(requestedUrl))) {
      return { action: "deny" };
    }
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        webPreferences: {
          partition,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true
        }
      }
    };
  });
  trackWindow(win, { providerId, planId });
  wc.loadURL(url).catch(() => { if (!win.isDestroyed()) broadcast(); });
  broadcast();
  return { id: win.id, providerId, url, planId };
}

app.whenReady().then(() => {
  // No renderer—dashboard, synthetic rehearsal, or provider—may request
  // microphone/camera/geolocation/notifications/clipboard privileges.
  // Official OAuth and 3DS remain in the external browser/provider session.
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback) => callback(false));
  session.fromPartition("persist:tixbam-rehearsal")
    .setPermissionRequestHandler((_wc,_permission,callback) => callback(false));
  desktopLanguage = readLanguage(app.getPath("userData"));
  recoveryFile = path.join(app.getPath("userData"), "tixbam-live-recovery.json");
  liveHistory = readHistory(recoveryFile);
  const account = registerAccount({ ipcMain, dashboardOnly, safeStorage, app, shell,
    onSessionChanged: () => {
      booking?.accountChanged?.();
      copilot.clearAll();
      for(const entry of rehearsalWindows.values())entry.labRecovery.invalidate();
    }
  });
  copilot.setVisionProvider(payload=>account.aiVision(payload));
  ipcMain.handle("tixbam:ai-advice", (event, payload) => {
    if (event.sender === dashboard?.webContents) dashboardOnly(event);
    else {
      const entry = rehearsalEntry(event);
      if (!payload || payload.provider_id !== entry.target.providerId ||
          payload.task !== "rehearsal_guidance") {
        throw new Error("Rehearsal AI may analyze only its own provider and practice task.");
      }
    }
    return account.aiAdvice(payload);
  });
  ipcMain.handle("tixbam:language-get", event => {
    if (event.sender === dashboard?.webContents) dashboardOnly(event);
    else rehearsalEntry(event);
    return desktopLanguage;
  });
  ipcMain.handle("tixbam:language-set", (event, code) => {
    // The main app owns the language preference. Rehearsal windows only read it.
    dashboardOnly(event);
    if (code !== "ko" && code !== "en") throw new Error("Unsupported language.");
    desktopLanguage = persistLanguage(app.getPath("userData"), code);
    notifyLanguage();
    return desktopLanguage;
  });
  ipcMain.handle("tixbam:open-rehearsal", (event, plan, accountId) => {
    dashboardOnly(event);
    return openRehearsalWindow(plan, accountId);
  });
  ipcMain.handle("tixbam:rehearsal-context", event => rehearsalEntry(event).target);
  // AB-07: sandboxed renderer can only advance a preset, offline simulator.
  // The host does not expose arbitrary URLs, DOM selectors, payment handlers,
  // card details, provider sessions, or host action commands.
  ipcMain.handle("tixbam:rehearsal-lab-scenarios", event =>
    rehearsalEntry(event).lab.scenarios);
  ipcMain.handle("tixbam:rehearsal-lab-status", event =>
    rehearsalEntry(event).lab.state);
  ipcMain.handle("tixbam:rehearsal-lab-start", (event, scenarioId, seed) =>
    rehearsalEntry(event).lab.start(scenarioId,seed));
  ipcMain.handle("tixbam:rehearsal-lab-next", (event, action) => {
    const lab=rehearsalEntry(event).lab;
    if(action==='advance')return lab.next();
    if(action==='manual')return lab.next({completeChallenge:true});
    if(action==='confirm')return lab.next({confirm:true});
    throw new Error("Unsupported rehearsal action.");
  });
  // A user-triggered read-only proposal, never an automatic task callback.
  ipcMain.handle("tixbam:rehearsal-lab-propose", event => {
    const entry=rehearsalEntry(event);
    return entry.labPlanner.propose({
      driver:entry.lab,providerId:entry.target.providerId,
      locale:desktopLanguage,send:payload=>account.aiPlan(payload)
    });
  });
    // A separate user click approves at most one safe, offline recovery step.
  ipcMain.handle("tixbam:rehearsal-lab-recover", event => {
    const entry=rehearsalEntry(event);
    return entry.labRecovery.executeApproved({driver:entry.lab,approve:true});
  });
    ipcMain.handle("tixbam:rehearsal-lab-stop", event =>
    rehearsalEntry(event).lab.stop());
  ipcMain.handle("tixbam:rehearsal-lab-restart", event =>
    rehearsalEntry(event).lab.simulateRestart());
  // Restricted to an active, isolated lab window. Never marks merchant paid,
  // clears a purchase claim, or releases any real booking lease.
  ipcMain.handle("tixbam:rehearsal-lab-review-unknown",(event,outcome,confirmed)=>
    rehearsalEntry(event).lab.reviewUnknown(outcome,confirmed));
  ipcMain.handle("tixbam:rehearsal-close", event => {
    const entry = rehearsalEntry(event);
    entry.win.close();
    if (dashboard && !dashboard.isDestroyed()) {
      if (dashboard.isMinimized()) dashboard.restore();
      dashboard.show();
      dashboard.focus();
    }
    return true;
  });
  ipcMain.handle("tixbam:rehearsal-complete", event => {
    const entry = rehearsalEntry(event);
    if (!dashboard || dashboard.isDestroyed() || dashboard.webContents.isLoading()) {
      throw new Error("Main TIXBAM window is not ready to save this rehearsal. Reopen the dashboard and retry.");
    }
    if ([...rehearsalWrites.values()].some(item => item.planId === entry.target.id)) {
      throw new Error("The rehearsal completion is already being saved.");
    }
    const requestId = ++rehearsalRequestSequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        rehearsalWrites.delete(requestId);
        reject(new Error("Saving timed out. Check the main TIXBAM window and retry."));
      }, REHEARSAL_SAVE_TIMEOUT_MS);
      rehearsalWrites.set(requestId, { planId: entry.target.id, resolve, reject, timer });
      dashboard.webContents.send("tixbam:rehearsal-save-request", {
        requestId, planId: entry.target.id, ownerId: entry.ownerId
      });
    });
  });
  ipcMain.handle("tixbam:rehearsal-save-ack", (event, requestId, success, message) => {
    dashboardOnly(event);
    const pending = rehearsalWrites.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    rehearsalWrites.delete(requestId);
    if (success === true) pending.resolve({ saved: true });
    else pending.reject(new Error(typeof message === "string" && message.length <= 300 ?
      message : "Could not save rehearsal. Retry after checking the main TIXBAM window."));
    return true;
  });
  ipcMain.handle("tixbam:open-assistance-guide", async (event, providerId, kind) => {
    dashboardOnly(event);
    requireInstalled(providerId);
    await shell.openExternal(resolveAssistanceGuide(providerId, kind));
    return true;
  });
  ipcMain.handle("tixbam:open-window", (event, options) => {
    dashboardOnly(event);
    // Only the explicit plan launch path may bind a browser to a plan.
    return openTicketWindow({ providerId: options?.providerId, url: options?.url });
  });
  ipcMain.handle("tixbam:open-sale-window", (event, options) => {
    dashboardOnly(event);
    if (!options || typeof options !== "object") throw new Error("Invalid ticket sale link.");
    return openTicketWindow(resolveOfficialSaleUrl(options.providerId, options.url));
  });
  ipcMain.handle("tixbam:open-plan-window", (event, options) => {
    dashboardOnly(event);
    if (!options || typeof options !== "object") throw new Error("Invalid booking target.");
    const planId = assertPlanId(options.planId);
    const destination = resolveOfficialSaleUrl(options.providerId, options.url);
    requireInstalled(destination.providerId);
    // Never reload a live plan's browser: a reload can discard a queue position.
    // An orphan payment/login popup still owns this plan. Never create a
    // replacement window that might trigger duplicate checkout.
    const existing = findExistingPlanSession([...ticketWindows.values()], planId);
    if (existing) {
      if (existing.win.isMinimized()) existing.win.restore();
      existing.win.show(); existing.win.focus();
      return { id: existing.win.id, providerId: existing.providerId, planId,
        reused: true, popup: existing.popup,
        site: publicLocation(existing.win.webContents.getURL()) };
    }
    return { ...openTicketWindow({ ...destination, planId }), reused: false };
  });
  ipcMain.handle("tixbam:copilot-capture", (event, windowId) => {
    dashboardOnly(event);
    return copilot.snapshot(windowId);
  });
  ipcMain.handle("tixbam:copilot-highlight", (event, windowId, token, point) => {
    dashboardOnly(event);
    return copilot.highlight(windowId,token,point);
  });
  ipcMain.handle("tixbam:copilot-analyze", (event, windowId, token, preferences) => {
    dashboardOnly(event);
    return copilot.analyze(windowId,token,preferences);
  });
  ipcMain.handle("tixbam:copilot-click", (event, windowId, token, point) => {
    dashboardOnly(event);
    return copilot.click(windowId,token,point);
  });
  ipcMain.handle("tixbam:set-live-phase", (event, windowId, phase) => {
    dashboardOnly(event);
    const entry = ticketWindows.get(windowId);
    if (!entry?.planId || entry.popup) throw new Error("No active booking plan for this window.");
    copilot.clear(windowId);
    entry.phase = assertPhase(phase);
    rememberSession(entry);
    broadcast();
    return true;
  });
  ipcMain.handle("tixbam:list-live-history", event => {
    dashboardOnly(event);
    return visibleHistory();
  });
  ipcMain.handle("tixbam:dismiss-live-history", (event, planId) => {
    dashboardOnly(event);
    assertPlanId(planId);
    liveHistory = liveHistory.filter(row => row.planId !== planId);
    if (recoveryFile) writeHistory(recoveryFile, liveHistory);
    return visibleHistory();
  });
  ipcMain.handle("tixbam:open-ticket-agent", (event, sourceWindowId, agentUrl) => {
    dashboardOnly(event);
    const source = ticketWindows.get(sourceWindowId);
    if (!source) throw new Error("Source browser window is closed.");
    const target = resolveAgentHandoff(source.providerId, agentUrl);
    requireInstalled(target.providerId);
    return openTicketWindow({ ...target, planId: source.planId || null });
  });
  ipcMain.handle("tixbam:list-windows", (event) => {
    dashboardOnly(event);
    return serializedWindows();
  });
  ipcMain.handle("tixbam:focus-window", (event, id) => {
    dashboardOnly(event);
    const item = ticketWindows.get(id);
    if (!item) throw new Error("Window not found.");
    if (item.win.isMinimized()) item.win.restore();
    item.win.show();
    item.win.focus();
    return true;
  });
  ipcMain.handle("tixbam:close-window", (event, id) => {
    dashboardOnly(event);
    const item = ticketWindows.get(id);
    if (!item) throw new Error("Window not found.");
    item.win.close();
    return !ticketWindows.has(id);
  });
  ipcMain.handle("tixbam:clear-provider-data", async (event, providerId) => {
    dashboardOnly(event);
    if (!findAddon(providerId)) throw new Error("Unknown ticketing provider.");
    if (Array.from(ticketWindows.values()).some((item) => item.providerId === providerId)) {
      throw new Error("Close all " + findAddon(providerId).name + " windows first.");
    }
    await session.fromPartition("persist:tixbam-" + providerId).clearStorageData();
    return true;
  });
  ipcMain.handle("tixbam:list-addons", (event) => {
    dashboardOnly(event);
    return listAddons();
  });
  ipcMain.handle("tixbam:set-addon-installed", (event, id, enabled) => {
    dashboardOnly(event);
    if (!enabled && (booking?.providerActive(id) || Array.from(ticketWindows.values()).some(item => item.providerId === id))) {
      throw new Error("Close this provider's windows before removing the add-on.");
    }
    const result = setInstalled(id, enabled);
    if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send("tixbam:addons-changed", result);
    return result;
  });
  booking = registerBooking({ app, safeStorage, ipcMain, dashboardOnly, ticketWindows, requireInstalled, resolveAddonUrl,
    bookingTarget: account.bookingTarget, bookingLease: account.bookingLease,
    send(channel, state) { if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send(channel, state); }
  });
  createDashboard();
  app.on("before-quit", event => {
    if (quittingConfirmed) { copilot.clearAll(); closingApplication = true; return; }
    const active = [...ticketWindows.values()].filter(entry => entry.planId);
    if (!active.length) { closingApplication = true; return; }
    const response = dialog.showMessageBoxSync({
      type: "warning",
      title: nativeCopy("Quit TIXBAM during ticketing?", "티켓팅 중 TIXBAM을 종료할까요?"),
      message: nativeCopy("Quitting will close live ticketing sessions and may lose queue positions.",
        "TIXBAM을 종료하면 예매 창이 닫히고 대기 순서가 사라질 수 있어요."),
      detail: nativeCopy("If a checkout has been attempted, check the provider's order history before trying another payment.",
        "결제를 시도했다면 다시 결제하기 전에 예매처 주문 내역을 확인하세요."),
      buttons: [nativeCopy("Keep ticketing open", "티켓팅 계속하기"), nativeCopy("Quit anyway", "그래도 종료")],
      defaultId: 0, cancelId: 0, noLink: true
    });
    if (response !== 1) { event.preventDefault(); return; }
    quittingConfirmed = true; closingApplication = true;
  });
  app.on("activate", () => {
    // The control room can be hidden while ticket windows remain alive.
    if (!dashboard || dashboard.isDestroyed()) createDashboard();
    else { dashboard.show(); dashboard.focus(); }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
