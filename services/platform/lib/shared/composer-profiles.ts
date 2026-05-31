import { v } from 'convex/values';

/**
 * Composer "response tuning" profiles. Each lever defaults to `adaptive`,
 * which means "let the platform's own algorithms decide" (the Adaptive
 * Reasoning Governor for effort, creativity-scaled temperature, and no style
 * override). Any other value is a FIXED choice that bypasses the adaptive
 * path for that lever only.
 *
 * Shared by the composer UI (labels + persistence) and the chat backend
 * (which translates the fixed choices into a reasoning-effort override, a
 * temperature/creativity override, and a system-prompt style fragment).
 */

export type EffortProfile = 'adaptive' | 'low' | 'medium' | 'high';
export type CreativityProfile =
  | 'adaptive'
  | 'precise'
  | 'balanced'
  | 'creative';
export type StyleProfile =
  | 'adaptive'
  | 'concise'
  | 'detailed'
  | 'formal'
  | 'friendly';

export interface ComposerProfiles {
  effort: EffortProfile;
  creativity: CreativityProfile;
  style: StyleProfile;
}

export const DEFAULT_COMPOSER_PROFILES: ComposerProfiles = {
  effort: 'adaptive',
  creativity: 'adaptive',
  style: 'adaptive',
};

export const EFFORT_PROFILES: EffortProfile[] = [
  'adaptive',
  'low',
  'medium',
  'high',
];
export const CREATIVITY_PROFILES: CreativityProfile[] = [
  'adaptive',
  'precise',
  'balanced',
  'creative',
];
export const STYLE_PROFILES: StyleProfile[] = [
  'adaptive',
  'concise',
  'detailed',
  'formal',
  'friendly',
];

/** Convex validator for the optional per-message profiles payload. */
export const composerProfilesValidator = v.object({
  effort: v.optional(
    v.union(
      v.literal('adaptive'),
      v.literal('low'),
      v.literal('medium'),
      v.literal('high'),
    ),
  ),
  creativity: v.optional(
    v.union(
      v.literal('adaptive'),
      v.literal('precise'),
      v.literal('balanced'),
      v.literal('creative'),
    ),
  ),
  style: v.optional(
    v.union(
      v.literal('adaptive'),
      v.literal('concise'),
      v.literal('detailed'),
      v.literal('formal'),
      v.literal('friendly'),
    ),
  ),
});

export function isEffortProfile(value: string): value is EffortProfile {
  return (EFFORT_PROFILES as string[]).includes(value);
}
export function isCreativityProfile(value: string): value is CreativityProfile {
  return (CREATIVITY_PROFILES as string[]).includes(value);
}
export function isStyleProfile(value: string): value is StyleProfile {
  return (STYLE_PROFILES as string[]).includes(value);
}

/**
 * Fixed effort → reasoning tier override. `undefined` means "adaptive":
 * leave the Reasoning Governor in control. The returned literals match the
 * backend `ReasoningTier` ('low' | 'medium' | 'high').
 */
export function effortToTierOverride(
  effort: EffortProfile | undefined,
): 'low' | 'medium' | 'high' | undefined {
  if (!effort || effort === 'adaptive') return undefined;
  return effort;
}

/**
 * Fixed creativity → sampling-creativity score in [0, 1]. `undefined` means
 * "adaptive" (difficulty-scaled). The backend feeds this into the same
 * `decideTemperature` path, so reasoning-only models that forbid temperature
 * still correctly omit it.
 */
export function creativityToScoreOverride(
  creativity: CreativityProfile | undefined,
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
 * Fixed style → a short system-prompt instruction fragment. Empty string
 * means "adaptive" (no override). Appended to the agent instructions for the
 * turn only.
 */
export function styleInstructionFragment(
  style: StyleProfile | undefined,
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
