// Local, user-entered preparation only. These values never prove a provider hold.
export interface ManualDraft {
  quantity: number; budget: string; performance: string; priceTier: string;
  section: string; floor: string; requireTogether: boolean; allowFallback: boolean;
  seatMode: '' | 'assigned' | 'standing' | 'automatic'; fulfillment: string;
}
export const EMPTY_MANUAL_DRAFT: ManualDraft = {
  quantity: 2, budget: '', performance: '', priceTier: '', section: '', floor: '',
  requireTogether: true, allowFallback: true, seatMode: '', fulfillment: ''
};
export function parseManualDraft(value: unknown): ManualDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {...EMPTY_MANUAL_DRAFT};
  const source = value as Record<string, unknown>;
  const text = (key: string) => typeof source[key] === 'string' ? source[key].slice(0, 1000) : '';
  return {
    quantity: Number.isSafeInteger(source.quantity) && Number(source.quantity) > 0 && Number(source.quantity) <= 20 ? Number(source.quantity) : 2,
    budget: text('budget'), performance: text('performance'), priceTier: text('priceTier'),
    section: text('section'), floor: text('floor'), fulfillment: text('fulfillment'),
    requireTogether: source.requireTogether !== false, allowFallback: source.allowFallback !== false,
    seatMode: ['assigned', 'standing', 'automatic'].includes(String(source.seatMode)) ? source.seatMode as ManualDraft['seatMode'] : ''
  };
}
export function hkdMinor(text: string): number | null {
  const cleaned = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}
export function remainingSeconds(deadline: number | null, now: number): number | null {
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}
export function userDeadline(minutes: string, seconds: string, now: number): number | null {
  if (!/^\d{1,3}$/.test(minutes) || !/^\d{1,2}$/.test(seconds)) return null;
  const duration = Number(minutes) * 60 + Number(seconds);
  if (Number(seconds) > 59 || duration <= 0 || duration > 3600) return null;
  return now + duration * 1000;
}
export function rankedLines(value: string): string[] {
  return [...new Set(value.split('\n').map(line => line.trim()).filter(Boolean))];
}
