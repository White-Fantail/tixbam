const { app, BrowserWindow, ipcMain, session, safeStorage } = require("electron");
const path = require("node:path");
const { MAX_WINDOWS, isSafeWebUrl } = require("./security.cjs");
const { findAddon, requireInstalled, listAddons, setInstalled, resolveAddonUrl } = require("./addon-manager.cjs");
const { resolveAgentHandoff } = require("./agent-handoff.cjs");

const { registerBooking } = require("./booking/controller.cjs");
let booking;
let dashboard = null;
const ticketWindows = new Map();

function serializedWindows() {
  return Array.from(ticketWindows.values()).map(({ win, providerId, openedAt }) => ({
    id: win.id,
    providerId,
    title: win.getTitle(),
    url: win.webContents.getURL(),
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
  dashboard.on("closed", () => { booking?.stopAll(); dashboard = null; });
}

function openTicketWindow({ providerId, url: candidate } = {}) {
  const { provider, url } = resolveAddonUrl(providerId, candidate);
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
  wc.on("will-navigate", (event, target) => {
    if (!isSafeWebUrl(target)) event.preventDefault();
  });
  wc.on("did-start-loading", broadcast);
  wc.on("did-stop-loading", broadcast);
  wc.on("page-title-updated", broadcast);
  wc.on("did-navigate", broadcast);
  wc.on("did-navigate-in-page", broadcast);
  win.on("closed", () => { booking?.windowClosed(win.id); ticketWindows.delete(win.id); broadcast(); });
  ticketWindows.set(win.id, { win, providerId, openedAt: Date.now() });
  wc.loadURL(url).catch(() => { if (!win.isDestroyed()) broadcast(); });
  broadcast();
  return { id: win.id, providerId, url };
}

app.whenReady().then(() => {
  ipcMain.handle("tixbam:open-window", (event, options) => {
    dashboardOnly(event);
    return openTicketWindow(options);
  });
  ipcMain.handle("tixbam:open-ticket-agent", (event, sourceWindowId, agentUrl) => {
    dashboardOnly(event);
    const source = ticketWindows.get(sourceWindowId);
    if (!source) throw new Error("Source browser window is closed.");
    const target = resolveAgentHandoff(source.providerId, agentUrl);
    requireInstalled(target.providerId);
    return openTicketWindow(target);
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
    return true;
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
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createDashboard();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
