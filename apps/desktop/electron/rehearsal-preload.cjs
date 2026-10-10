const { contextBridge, ipcRenderer } = require("electron");
// Privileged operations intentionally unavailable: provider windows, vault,
// account requests, arbitrary filesystem/network access and booking runner.
contextBridge.exposeInMainWorld("tixbamRehearsal", {
  getLanguage: () => ipcRenderer.invoke("tixbam:language-get"),
  onLanguageChanged: listener => {
    const handler = (_event, code) => listener(code);
    ipcRenderer.on("tixbam:language-changed", handler);
    return () => ipcRenderer.removeListener("tixbam:language-changed", handler);
  },
  getContext: () => ipcRenderer.invoke("tixbam:rehearsal-context"),
  labScenarios: () => ipcRenderer.invoke("tixbam:rehearsal-lab-scenarios"),
  labStatus: () => ipcRenderer.invoke("tixbam:rehearsal-lab-status"),
  labStart: (scenarioId,seed) => ipcRenderer.invoke("tixbam:rehearsal-lab-start",scenarioId,seed),
  labNext: action => ipcRenderer.invoke("tixbam:rehearsal-lab-next",action),
  labStop: () => ipcRenderer.invoke("tixbam:rehearsal-lab-stop"),
  labPropose: () => ipcRenderer.invoke("tixbam:rehearsal-lab-propose"),
  labRecover: () => ipcRenderer.invoke("tixbam:rehearsal-lab-recover"),
  labRestart: () => ipcRenderer.invoke("tixbam:rehearsal-lab-restart"),
  labReviewUnknown: (outcome,confirmed) => ipcRenderer.invoke("tixbam:rehearsal-lab-review-unknown",outcome,confirmed),
  aiAdvice: input => ipcRenderer.invoke("tixbam:ai-advice", input),
  complete: () => ipcRenderer.invoke("tixbam:rehearsal-complete"),
  close: () => ipcRenderer.invoke("tixbam:rehearsal-close")
});
