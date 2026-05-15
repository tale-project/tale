/**
 * Discriminated union returned by every guardrails filter (PII detection,
 * chat-filter, moderation-provider). Blocking is intentionally NOT
 * expressed by throwing — a single dispatcher converts `blocked` into a
 * platform-specific error (e.g. `ConvexError`) so every filter stays
 * independently testable and composable.
 *
 * `kind` discriminator:
 *   pass        — no PII detected, text passed through unchanged
 *   modified    — PII detected and rewritten to `text` (mask mode)
 *   flagged     — PII detected but neither masked nor blocked (audit-only mode)
 *   blocked     — PII detected, caller must reject the input
 *   step_error  — filter failed internally; caller decides fail-open vs closed
 *
 * Field semantics:
 *   categoryIds — opaque pattern names ("email", "phone", "iban-de", …).
 *                 Safe to log; never contains matched text.
 *   matchCount  — total span count across all matches in this filter run.
 *                 Useful for telemetry without needing per-match details.
 *   truncated   — true when input was clamped before scanning. Tells the
 *                 caller "results may be incomplete past the clamp".
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
  /**
   * Which filter raised the error — lets the orchestrator log a single
   * line per step without consulting external context.
   */
  filterName: FilterName;
  /**
   * Short, log-safe description of why the step failed (e.g. `"timeout"`,
   * `"network"`, `"config: missing api key"`). Never include matched text
   * — the reason ends up in logs (GDPR).
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
