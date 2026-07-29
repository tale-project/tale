/**
 * The guardrails filter outcome — the contract every input/output filter
 * in the chat pipeline's guardrail chain (chat_filter → pii → moderation)
 * returns. Blocking is a VALUE, not an exception: one dispatcher converts
 * `blocked` into the platform error, so each filter stays independently
 * testable and composable.
 *
 * `kind`:
 *  - `pass`       — nothing detected; text unchanged.
 *  - `modified`   — detections rewritten into `text` (mask/tokenize).
 *  - `flagged`    — detections recorded, text untouched (audit-only).
 *  - `blocked`    — caller must reject the input.
 *  - `step_error` — the filter itself failed; caller decides fail-open or
 *                   fail-closed.
 *
 * `categoryIds` carries opaque pattern names only — safe to log, never
 * matched text. `truncated` marks that the input was clamped before
 * scanning, i.e. results past the clamp point may be incomplete.
 */

export type FilterName = 'pii' | 'chat_filter' | 'moderation_provider';

export type GuardrailsDirection = 'input' | 'output';

export interface FilterPassOutcome {
  kind: 'pass';
}

export interface FilterModifiedOutcome {
  kind: 'modified';
  text: string;
  categoryIds: string[];
  matchCount: number;
  truncated?: boolean;
}

export interface FilterFlaggedOutcome {
  kind: 'flagged';
  categoryIds: string[];
  matchCount: number;
  truncated?: boolean;
}

export interface FilterBlockedOutcome {
  kind: 'blocked';
  categoryIds: string[];
  matchCount: number;
  truncated?: boolean;
}

export interface FilterStepErrorOutcome {
  kind: 'step_error';
  filterName: FilterName;
  /**
   * Short, log-safe failure description ("timeout", "config: …"). Never
   * matched text — the reason ends up in logs.
   */
  reason: string;
}

export type FilterOutcome =
  | FilterPassOutcome
  | FilterModifiedOutcome
  | FilterFlaggedOutcome
  | FilterBlockedOutcome
  | FilterStepErrorOutcome;

export function pass(): FilterPassOutcome {
  return { kind: 'pass' };
}

export function modified(
  text: string,
  categoryIds: string[],
  matchCount: number,
  truncated?: boolean,
): FilterModifiedOutcome {
  return { kind: 'modified', text, categoryIds, matchCount, truncated };
}

export function flagged(
  categoryIds: string[],
  matchCount: number,
  truncated?: boolean,
): FilterFlaggedOutcome {
  return { kind: 'flagged', categoryIds, matchCount, truncated };
}

export function blocked(
  categoryIds: string[],
  matchCount: number,
  truncated?: boolean,
): FilterBlockedOutcome {
  return { kind: 'blocked', categoryIds, matchCount, truncated };
}
