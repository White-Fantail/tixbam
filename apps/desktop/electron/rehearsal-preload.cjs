const { contextBridge, ipcRenderer } = require("electron");
// Privileged operations intentionally unavailable: provider windows, vault,
// account requests, arbitrary filesystem/network access and booking runner.
contextBridge.exposeInMainWorld("tixbamRehearsal", {
  getContext: () => ipcRenderer.invoke("tixbam:rehearsal-context"),
  complete: () => ipcRenderer.invoke("tixbam:rehearsal-complete"),
  close: () => ipcRenderer.invoke("tixbam:rehearsal-close")
});
