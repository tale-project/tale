/**
 * Generation-parameter governance beyond reasoning.
 *
 * Right now this derives a default sampling **temperature** from the turn's
 * creativity signal — precise/analytical work runs cooler, open-ended
 * generation warmer — but it is the seam for any other automatically-tuned
 * decode parameter (top-p, penalties) as needs grow.
 */

import type { ReasoningCapability } from './capability';
import { clamp01 } from './clamp';

const TEMP_MIN = 0.4;
const TEMP_MAX = 0.9;

/**
 * Decide a default temperature from creativity, or `undefined` when it must not
 * be set because an active reasoning knob already constrains it:
 *  - effort-knob models (OpenAI o-series / gpt-5) ignore or reject `temperature`;
 *  - self-truncating thinking (Anthropic) requires temperature unset/1 *while
 *    thinking is enabled* (it's fine to set when reasoning is off).
 *
 * Callers still let an explicit per-request temperature win over this default.
 */
export function decideTemperature(
  creativity: number,
  capability: ReasoningCapability | null,
  reasoningActive: boolean,
): number | undefined {
  if (capability) {
    if (capability.knob === 'effort') return undefined;
    if (capability.selfTruncates && reasoningActive) return undefined;
  }
  const t = TEMP_MIN + clamp01(creativity) * (TEMP_MAX - TEMP_MIN);
  return Math.round(t * 100) / 100;
}
