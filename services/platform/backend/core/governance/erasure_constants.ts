/**
 * GDPR Art 17 erasure constants. Lives in its own file (rather than
 * `schema.ts`) so unit tests can import the literal lists without
 * pulling in `defineTable` / `v.object()` calls that need a real Convex
 * value-validator runtime.
 */

/**
 * Lawful grounds enumerated by GDPR Art 17(1)(a)–(f), plus the
 * operational `contract_termination` ground used when an HR offboarding
 * triggers erasure of a former employee.
 */
export const ERASURE_REASON_CODES = [
  'consent_withdrawn',
  'no_longer_necessary',
  'unlawful_processing',
  'legal_obligation',
  'objection',
  'child',
  'contract_termination',
] as const;

export type ErasureReasonCode = (typeof ERASURE_REASON_CODES)[number];

/** Live state-machine values for `gdprErasureRequests.status`. */
export const ERASURE_STATUSES = [
  'pending',
  'running',
  'done',
  'partial',
  'failed',
  'blocked',
  'cancelled',
] as const;

export type ErasureStatus = (typeof ERASURE_STATUSES)[number];

/**
 * Sentinel `error` value the watchdog writes when it flips a stuck
 * `running` receipt to `'failed'`. Load-bearing beyond the message: the
 * retry path refuses a receipt carrying it (`retryErasure` — a run that
 * timed out mid-cascade has unknown partial state, so the next attempt
 * must be a FRESH request, not a resume).
 *
 * Centralised so the writer (`recoverStuckErasureRequests`) and the
 * matcher (`retryErasure`) cannot drift apart — the value is persisted on
 * receipt rows, so it must NEVER change without a data migration.
 */
export const ERASURE_WATCHDOG_TIMEOUT_MESSAGE =
  'Erasure timed out and was stopped by the watchdog. File a new request.' as const;
