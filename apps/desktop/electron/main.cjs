const { app, BrowserWindow, ipcMain, session, safeStorage, shell, dialog } = require("electron");
const path = require("node:path");
const { MAX_WINDOWS, isSafeWebUrl, resolveOfficialSaleUrl } = require("./security.cjs");
const { findAddon, requireInstalled, listAddons, setInstalled, resolveAddonUrl } = require("./addon-manager.cjs");
const { resolveAgentHandoff } = require("./agent-handoff.cjs");

const { registerBooking } = require("./booking/controller.cjs");
const { registerAccount } = require("./account.cjs");
const { assertPlanId, assertPhase, publicLocation, readHistory, writeHistory,
  activeEntry, mergeHistory, isSensitivePhase } = require("./live-workspace-state.cjs");
let booking;
let dashboard = null;
const ticketWindows = new Map();
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
    type: "warning", title: "Leave this ticketing session?",
    message: "Closing this browser may lose your position or unfinished order.",
    detail: isSensitivePhase(entry.phase)
      ? "You marked this session as checkout or verification. Check the ticket provider's order history before retrying or paying again."
      : "Keep this window open while you are in a waiting room or queue. Closing cannot be undone.",
    buttons: ["Keep window open", "Close anyway"], defaultId: 0, cancelId: 0, noLink: true
  });
  if (response !== 1) event.preventDefault();
}

function trackWindow(win, { providerId, planId = null, popup = false, parentId = null }) {
  const wc = win.webContents;
  if (popup) wc.setWindowOpenHandler(({ url: requestedUrl }) => {
    if (requestedUrl !== "about:blank" && !isSafeWebUrl(requestedUrl)) return { action: "deny" };
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
  wc.on("did-start-loading", () => { entry.loadError = null; broadcast(); });
  wc.on("did-stop-loading", broadcast);
  wc.on("page-title-updated", broadcast);
  wc.on("did-navigate", broadcast);
  wc.on("did-navigate-in-page", broadcast);
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
  win.on("close", event => confirmSessionClose(win, entry, event));
  win.on("closed", () => {
    if (planId && !popup) rememberSession(entry, closingApplication ? "interrupted" : "closed");
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
  dashboard.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl === "http://127.0.0.1:5173") {
    dashboard.loadURL(devUrl);
  } else {
    dashboard.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  dashboard.on("close", event => {
    if (closingApplication) return;
    if ([...ticketWindows.values()].some(entry => entry.planId)) {
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
    if (requestedUrl !== "about:blank" && !isSafeWebUrl(requestedUrl)) {
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
  recoveryFile = path.join(app.getPath("userData"), "tixbam-live-recovery.json");
  liveHistory = readHistory(recoveryFile);
  registerAccount({ ipcMain, dashboardOnly, safeStorage, app, shell });
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
    const matches = [...ticketWindows.values()].filter(entry => entry.planId === planId);
    // An orphan payment/login popup still owns this plan. Never create a
    // replacement window that might trigger duplicate checkout.
    const existing = matches.filter(entry => !entry.popup).at(-1) || matches.at(-1);
    if (existing) {
      if (existing.win.isMinimized()) existing.win.restore();
      existing.win.show(); existing.win.focus();
      return { id: existing.win.id, providerId: existing.providerId, planId,
        reused: true, popup: existing.popup,
        site: publicLocation(existing.win.webContents.getURL()) };
    }
    return { ...openTicketWindow({ ...destination, planId }), reused: false };
  });
  ipcMain.handle("tixbam:set-live-phase", (event, windowId, phase) => {
    dashboardOnly(event);
    const entry = ticketWindows.get(windowId);
    if (!entry?.planId || entry.popup) throw new Error("No active booking plan for this window.");
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
    send(channel, state) { if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send(channel, state); }
  });
  createDashboard();
  app.on("before-quit", event => {
    if (quittingConfirmed) { closingApplication = true; return; }
    const active = [...ticketWindows.values()].filter(entry => entry.planId && !entry.popup);
    if (!active.length) { closingApplication = true; return; }
    const response = dialog.showMessageBoxSync({
      type: "warning", title: "Quit TIXBAM during ticketing?",
      message: "Quitting will close live ticketing sessions and may lose queue positions.",
      detail: "If a checkout has been attempted, check the provider's order history before trying another payment.",
      buttons: ["Keep ticketing open", "Quit anyway"], defaultId: 0, cancelId: 0, noLink: true
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
