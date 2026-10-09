const { contextBridge, ipcRenderer } = require("electron");
// Privileged operations intentionally unavailable: provider windows, vault,
// account requests, arbitrary filesystem/network access and booking runner.
contextBridge.exposeInMainWorld("tixbamRehearsal", {
  getLanguage: () => ipcRenderer.invoke("tixbam:language-get"),
  setLanguage: code => ipcRenderer.invoke("tixbam:language-set", code),
  onLanguageChanged: listener => {
    const handler = (_event, code) => listener(code);
    ipcRenderer.on("tixbam:language-changed", handler);
    return () => ipcRenderer.removeListener("tixbam:language-changed", handler);
  },
  getContext: () => ipcRenderer.invoke("tixbam:rehearsal-context"),
  complete: () => ipcRenderer.invoke("tixbam:rehearsal-complete"),
  close: () => ipcRenderer.invoke("tixbam:rehearsal-close")
});
