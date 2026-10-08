const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tixbam", {
  listAddons: () => ipcRenderer.invoke("tixbam:list-addons"),
  setAddonInstalled: (id, enabled) => ipcRenderer.invoke("tixbam:set-addon-installed", id, enabled),
  onAddonsChanged: (listener) => {
    const handler = (_event, addons) => listener(addons);
    ipcRenderer.on("tixbam:addons-changed", handler);
    return () => ipcRenderer.removeListener("tixbam:addons-changed", handler);
  },
  openWindow: (options) => ipcRenderer.invoke("tixbam:open-window", options),
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
