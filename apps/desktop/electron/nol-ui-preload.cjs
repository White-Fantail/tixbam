'use strict';
/**
 * Isolated NOL UI test preload. Only compiled by a separate Vite fixture and
 * executed in the dedicated offline Electron harness, never the real app.
 * No provider window / network connection / real browser session exists.
 */
const {contextBridge,ipcRenderer}=require('electron');
const initial={
  windowId:42,planId:'nol-offline-ui-plan',providerId:'nol',
  mode:'observe',requestedMode:'observe',status:'armed',
  reason:'Offline UI fixture armed. Not an official booking session.',
  attempts:0,targets:[],automaticClicks:0
};
const noBrowser=()=>Promise.reject(new Error('Offline UI fixture has no provider connection'));
contextBridge.exposeInMainWorld('tixbam',{
  listBookings:async()=>[],
  onBookingChanged:()=>()=>{},
  onCopilotAdvanceUpdate:listener=>{
    const handler=(_event,info)=>listener(info);
    ipcRenderer.on('tixbam:copilot-advance-update',handler);
    return ()=>ipcRenderer.removeListener('tixbam:copilot-advance-update',handler);
  },
  copilotAdvanceStatus:async()=>initial,
  copilotAdvanceResume:()=>ipcRenderer.invoke('nol-ui:resume'),
  copilotAdvanceStop:()=>ipcRenderer.invoke('nol-ui:stop'),
  copilotCapture:noBrowser,
  copilotAnalyze:noBrowser,
  copilotHighlight:noBrowser,
  copilotClick:noBrowser,
  listWindows:async()=>[],
  getLanguage:async()=>'ko',
  setLivePhase:noBrowser
});
