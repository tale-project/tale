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

const DEFAULT_TEMP_MIN = 0.4;
const DEFAULT_TEMP_MAX = 0.9;

/**
 * Decide a default temperature from creativity, or `undefined` when it must not
 * be set because an active reasoning knob already constrains it:
 *  - effort-knob models (OpenAI o-series / gpt-5) ignore or reject `temperature`;
 *  - self-truncating thinking (Anthropic) requires temperature unset/1 *while
 *    thinking is enabled* (it's fine to set when reasoning is off).
 *
 * `range` lets a per-agent `responseTuning.temperatureRange` override the
 * default [0.4, 0.9] band; partial ranges fall back to the default endpoint.
 * Callers still let an explicit per-request temperature win over this default.
 */
export function decideTemperature(
  creativity: number,
  capability: ReasoningCapability | null,
  reasoningActive: boolean,
  range?: { min?: number; max?: number },
): number | undefined {
  if (capability) {
    if (capability.knob === 'effort') return undefined;
    if (capability.selfTruncates && reasoningActive) return undefined;
  }
  const min = range?.min ?? DEFAULT_TEMP_MIN;
  const max = Math.max(min, range?.max ?? DEFAULT_TEMP_MAX);
  const t = min + clamp01(creativity) * (max - min);
  return Math.round(t * 100) / 100;
}
