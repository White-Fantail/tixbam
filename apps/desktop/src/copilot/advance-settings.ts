/** Device-local preferences only. Never sync a blanket automation approval to cloud plans. */
export type AdvanceMode = "manual" | "observe" | "authorized";
export type AdvanceKind = "performance" | "price_tier" | "quantity" | "seat" | "continue";
export type AdvanceSettings = {mode:AdvanceMode; actions:AdvanceKind[]; shareScreenshots:boolean};
export type AdvanceConsent = AdvanceSettings & {confirmed:true};
const DEFAULT: AdvanceSettings = {mode:"manual",actions:["continue","performance","price_tier","quantity","seat"],shareScreenshots:false};
const GLOBAL_KEY="tixbam.copilot.advance.global.v1";
const PLAN_PREFIX="tixbam.copilot.advance.plan.v1.";
const KINDS:AdvanceKind[]=["continue","performance","price_tier","quantity","seat"];
export function normalizeAdvanceSettings(value:unknown):AdvanceSettings {
  if(!value || typeof value!=="object")return {...DEFAULT,actions:[...DEFAULT.actions]};
  const input=value as Record<string,unknown>;
  const mode:AdvanceMode=["manual","observe","authorized"].includes(String(input.mode))
    ? input.mode as AdvanceMode : "manual";
  const actions=Array.isArray(input.actions)
    ? KINDS.filter(kind=>input.actions.includes(kind)): [...DEFAULT.actions];
  return {mode,actions,shareScreenshots:input.shareScreenshots===true};
}
function read(key:string):AdvanceSettings|null {
  try {const value=localStorage.getItem(key);return value?normalizeAdvanceSettings(JSON.parse(value)):null;}
  catch{return null;}
}
export function globalAdvanceSettings():AdvanceSettings {return read(GLOBAL_KEY)||normalizeAdvanceSettings(null);}
export function planAdvanceSettings(id:string):AdvanceSettings|null {return read(PLAN_PREFIX+id);}
export function effectiveAdvanceSettings(id:string):AdvanceSettings {return planAdvanceSettings(id)||globalAdvanceSettings();}
export function saveGlobalAdvanceSettings(value:AdvanceSettings){
  localStorage.setItem(GLOBAL_KEY,JSON.stringify(normalizeAdvanceSettings(value)));
}
export function savePlanAdvanceSettings(id:string,value:AdvanceSettings|null){
  if(value===null)localStorage.removeItem(PLAN_PREFIX+id);
  else localStorage.setItem(PLAN_PREFIX+id,JSON.stringify(normalizeAdvanceSettings(value)));
}
export function advanceConsent(value:AdvanceSettings):AdvanceConsent|null {
  const normalized=normalizeAdvanceSettings(value);
  return normalized.mode!=="manual" && normalized.shareScreenshots && normalized.actions.length>0
    ? {...normalized,confirmed:true} : null;
}
