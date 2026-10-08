const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tixbam", {
  accountStatus: () => ipcRenderer.invoke("tixbam:account-status"),
  accountOAuthStart: (url, provider) => ipcRenderer.invoke("tixbam:account-oauth-start", url, provider),
  accountOAuthPoll: () => ipcRenderer.invoke("tixbam:account-oauth-poll"),
  accountOAuthCancel: () => ipcRenderer.invoke("tixbam:account-oauth-cancel"),
  accountSignOut: () => ipcRenderer.invoke("tixbam:account-sign-out"),
  accountRequest: (method, endpoint, body) => ipcRenderer.invoke("tixbam:account-request", method, endpoint, body),
  vaultStatus: () => ipcRenderer.invoke("tixbam:vault-status"),
  saveCard: input => ipcRenderer.invoke("tixbam:save-card", input),
  removeCard: id => ipcRenderer.invoke("tixbam:remove-card", id),
  bookingContext: input => ipcRenderer.invoke("tixbam:booking-context", input),
  saveBookingPreferences: (id, input) => ipcRenderer.invoke("tixbam:save-booking-preferences", id, input),
  startBooking: input => ipcRenderer.invoke("tixbam:start-booking", input),
  listBookings: () => ipcRenderer.invoke("tixbam:list-bookings"),
  resumeBooking: (id, confirm) => ipcRenderer.invoke("tixbam:resume-booking", id, confirm),
  stopBooking: id => ipcRenderer.invoke("tixbam:stop-booking", id),
  onBookingChanged: listener => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("tixbam:booking-changed", handler);
    return () => ipcRenderer.removeListener("tixbam:booking-changed", handler);
  },
  listAddons: () => ipcRenderer.invoke("tixbam:list-addons"),
  setAddonInstalled: (id, enabled) => ipcRenderer.invoke("tixbam:set-addon-installed", id, enabled),
  onAddonsChanged: (listener) => {
    const handler = (_event, addons) => listener(addons);
    ipcRenderer.on("tixbam:addons-changed", handler);
    return () => ipcRenderer.removeListener("tixbam:addons-changed", handler);
  },
  openWindow: (options) => ipcRenderer.invoke("tixbam:open-window", options),
  openTicketAgent: (sourceWindowId, agentUrl) => ipcRenderer.invoke("tixbam:open-ticket-agent", sourceWindowId, agentUrl),
  listWindows: () => ipcRenderer.invoke("tixbam:list-windows"),
  focusWindow: (id) => ipcRenderer.invoke("tixbam:focus-window", id),
  closeWindow: (id) => ipcRenderer.invoke("tixbam:close-window", id),
  clearProviderData: (id) => ipcRenderer.invoke("tixbam:clear-provider-data", id),
  onWindowsChanged: (listener) => {
    const handler = (_event, windows) => listener(windows);
    ipcRenderer.on("tixbam:windows-changed", handler);
    return () => ipcRenderer.removeListener("tixbam:windows-changed", handler);
  }
});
