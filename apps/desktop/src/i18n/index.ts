import { useSyncExternalStore } from "react";
import { ko } from "./ko";

export const LANGUAGE_STORAGE_KEY = "tixbam.desktop.language.v1";
export const LANGUAGES = [
  { code: "ko", nativeName: "한국어", englishName: "Korean" },
  { code: "en", nativeName: "English", englishName: "English" }
] as const;
export type Language = (typeof LANGUAGES)[number]["code"];
export const DEFAULT_LANGUAGE: Language = "ko";
const subscribers = new Set<() => void>();

export function normalizeLanguage(value: unknown): Language {
  return value === "en" || value === "ko" ? value : DEFAULT_LANGUAGE;
}
function savedLanguage(): Language {
  try { return normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY)); }
  catch { return DEFAULT_LANGUAGE; }
}
let language: Language = savedLanguage();
export function getLanguage(): Language { return language; }
export function setLanguage(next: Language) {
  const normalized = normalizeLanguage(next);
  if (language === normalized) return;
  language = normalized;
  try { localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized); } catch { /* private mode */ }
  document.documentElement.lang = normalized;
  document.title = normalized === "ko" ? "TIXBAM — 티켓팅 준비와 예매" : "TIXBAM — Ticketing Command Center";
  for (const listener of subscribers) listener();
}
export function subscribeLanguage(listener: () => void) {
  subscribers.add(listener); return () => { subscribers.delete(listener); };
}
export function useLanguage() {
  return { language: useSyncExternalStore(subscribeLanguage, getLanguage, () => DEFAULT_LANGUAGE), setLanguage };
}
export function tx(source: string): string {
  if (language !== "ko") return source;
  const leading = source.match(/^\s*/)?.[0] || "";
  const trailing = source.match(/\s*$/)?.[0] || "";
  const key = source.trim().replace(/\s+/g, " ");
  if (!key) return source;
  return leading + (ko as Record<string,string>)[key] ?? source;
}
export function tr(source: string, vars?: Record<string, string | number>): string {
  const translated = tx(source);
  return vars ? translated.replace(/\{([\w]+)\}/g, (_, key) =>
    vars[key] === undefined ? "{" + key + "}" : String(vars[key])) : translated;
}
export function localDate(value: string | number | Date, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-NZ",
    options || { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
export function localNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(language === "ko" ? "ko-KR" : "en-NZ", options).format(value);
}

if (typeof document !== "undefined") document.documentElement.lang = language;
