/**
 * Pure helpers that translate the per-agent `responseTuning` config (see
 * `responseTuningSchema` in `./schemas/agents`) into the primitives the chat
 * backend consumes:
 *
 *  - a FIXED reasoning-tier override (bypasses the adaptive controller),
 *  - a creativity score in [0,1] feeding the temperature governor,
 *  - effort floor/ceiling tiers that BOUND the adaptive controller,
 *  - per-difficulty thinking-budget caps,
 *  - a temperature range,
 *  - a quality-feedback preset,
 *  - system-prompt fragments for style and verbosity.
 *
 * Pure and dependency-free — shared by the agent settings UI and the chat
 * backend.
 */

import type { ResponseTuningConfig } from './schemas/agents';

/**
 * Fixed effort → reasoning-tier override. `undefined` means "adaptive": leave
 * the governor in control. ('off' is not a valid *fixed* effort — the composer
 * only ever exposed low/medium/high — so the enum here excludes it.)
 */
export function effortToTierOverride(
  effort: ResponseTuningConfig['effort'],
): 'low' | 'medium' | 'high' | undefined {
  if (!effort || effort === 'adaptive') return undefined;
  return effort;
}

/**
 * Fixed creativity → sampling-creativity score in [0,1]. `undefined` = adaptive
 * (difficulty-scaled). The backend feeds this into `decideTemperature`, so
 * reasoning-only models that forbid temperature still correctly omit it.
 */
export function creativityToScoreOverride(
  creativity: ResponseTuningConfig['creativity'],
): number | undefined {
  switch (creativity) {
    case 'precise':
      return 0;
    case 'balanced':
      return 0.5;
    case 'creative':
      return 1;
    default:
      return undefined;
  }
}

/**
 * Fixed style → a short system-prompt instruction fragment. Empty string means
 * "adaptive" (no override). Appended to the agent instructions for the turn.
 */
export function styleInstructionFragment(
  style: ResponseTuningConfig['style'],
): string {
  switch (style) {
    case 'concise':
      return 'Response style: be concise. Keep answers brief and to the point; avoid preamble and filler.';
    case 'detailed':
      return 'Response style: be thorough. Provide detailed, comprehensive answers with relevant context and examples.';
    case 'formal':
      return 'Response style: use a professional, formal tone.';
    case 'friendly':
      return 'Response style: use a warm, conversational, friendly tone.';
    default:
      return '';
  }
}

/**
 * Verbosity → a soft length-target fragment, independent of `style`. Empty
 * string means "adaptive". `style` controls tone/depth phrasing; `verbosity`
 * targets length specifically, so both can be set together.
 */
export function verbosityInstructionFragment(
  verbosity: ResponseTuningConfig['verbosity'],
): string {
  switch (verbosity) {
    case 'terse':
      return 'Length: answer in as few words as possible — ideally one or two sentences.';
    case 'normal':
      return 'Length: aim for a moderate, balanced answer length.';
    case 'verbose':
      return 'Length: be expansive — cover edge cases, caveats, and worked examples.';
    default:
      return '';
  }
}

/**
 * Compose the style + verbosity fragments (either may be empty) into the suffix
 * appended to an agent's system instructions for the turn. Returns '' when
 * neither is set.
 */
export function tuningInstructionSuffix(
  tuning: ResponseTuningConfig | undefined,
): string {
  if (!tuning) return '';
  const parts = [
    styleInstructionFragment(tuning.style),
    verbosityInstructionFragment(tuning.verbosity),
  ].filter(Boolean);
  return parts.join('\n');
}
