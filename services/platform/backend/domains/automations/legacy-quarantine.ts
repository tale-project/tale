import { epochMsSchema } from '@tale/shared/schemas/epoch-ms';
import { z } from 'zod';

import type { LegacyRunQuarantine } from '../../../lib/engine/api/dispatch.ts';

const integer = z.number().int().nonnegative().safe();
const resolution = z.strictObject({
  action: z.literal('stop'),
  actor: z.string().min(1).max(200),
  at: integer,
});
const storedHold = z.strictObject({
  schemaVersion: z.literal(1),
  reason: z.literal('legacy_execution_unproven'),
  observedAtMs: integer,
  prior: z.strictObject({
    status: z.enum(['queued', 'running', 'waiting']),
    claimEpoch: integer,
    chainSeq: integer,
    engineProtocol: integer,
    wakeAtMs: integer.nullable(),
    leaseEpoch: integer.nullable(),
    leaseOwner: z.string().nullable(),
    leaseExpiresAtMs: integer.nullable(),
  }),
  resolution: resolution.nullable(),
});

/** Only the public, non-secret hold facts leave the store. A corrupt hold
 * refuses the read instead of silently appearing to be executable work. */
export function describeLegacyQuarantine(
  value: unknown,
  claimEpoch: number,
): LegacyRunQuarantine | undefined {
  if (value === null || value === undefined) return undefined;
  const hold = storedHold.parse(value);
  return {
    reason: hold.reason,
    observedAt: hold.observedAtMs,
    claimEpoch: integer.parse(claimEpoch),
    priorStatus: hold.prior.status,
    resolution: hold.resolution,
  };
}

export const legacyRunStopSchema = z.strictObject({
  expectedClaimEpoch: integer,
  expectedObservedAt: epochMsSchema,
  action: z.literal('stop'),
  acknowledgeUnknownExternalEffects: z.literal(true),
});
