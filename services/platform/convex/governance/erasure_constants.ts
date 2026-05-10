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
] as const;

export type ErasureStatus = (typeof ERASURE_STATUSES)[number];
