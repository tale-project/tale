/**
 * Discriminated union returned by every guardrails filter (pii, chat_filter,
 * moderation_provider). Blocking is NOT expressed by throwing — sanitize.ts
 * is the single site that converts a `blocked` outcome into a ConvexError,
 * so every filter stays independently testable and composable.
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
  errorClass:
    | 'timeout'
    | 'network'
    | 'parse'
    | 'http_4xx'
    | 'http_5xx'
    | 'config'
    | 'unknown';
  httpStatus?: number;
  durationMs?: number;
  attempt?: number;
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
