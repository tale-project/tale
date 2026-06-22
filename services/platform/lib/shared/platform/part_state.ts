/**
 * The lifecycle / streaming STATE axis — an orthogonal concern carried by every
 * render-part, NOT a render-kind. Modeling it once here (rather than folding it
 * into the `status` kind) means every panel can show loading / running / error /
 * waiting / empty uniformly, and dissolves the need for separate error/empty/
 * wait render-kinds. The renderer wraps every kind in a shared part envelope
 * that reads this from the step's runtime output.
 */
export const PART_STATES = [
  'upcoming', // in the plan but not yet reached — a quiet preview row, no skeleton
  'loading',
  'running',
  'output_available',
  'output_error',
  'waiting_human',
  'waiting_external',
  'empty',
] as const;

export type PartState = (typeof PART_STATES)[number];

const PART_STATE_SET = new Set<string>(PART_STATES);

export function isPartState(value: string): value is PartState {
  return PART_STATE_SET.has(value);
}

/**
 * SLA / escalation annotation tokens — an orthogonal annotation overlay on
 * actionable parts (deferred / P2). Declared so packs can reference them without
 * a schema change when the overlay lands.
 */
export const SLA_ACTIONS = [
  'timeout',
  'escalate',
  'delegate',
  'reminder',
] as const;
