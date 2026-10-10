import { coreKo } from "./core-ko";
import { bookingKo } from "./booking-ko";
import { liveKo } from "./live-ko";
import { citylineKo } from "./cityline-ko";
import { supplementalKo } from "./supplemental-ko";
import { bookingCopilotKo } from "./booking-copilot-ko";
export const ko: Readonly<Record<string, string>> = Object.freeze({
  ...coreKo, ...bookingKo, ...liveKo, ...citylineKo, ...supplementalKo, ...bookingCopilotKo
});
