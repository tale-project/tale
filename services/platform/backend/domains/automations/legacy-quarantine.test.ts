import { describe, expect, it } from 'vitest';

import {
  describeLegacyQuarantine,
  legacyRunStopSchema,
} from './legacy-quarantine.ts';

const hold = {
  schemaVersion: 1,
  reason: 'legacy_execution_unproven',
  observedAtMs: 100,
  prior: {
    status: 'waiting',
    claimEpoch: 2,
    chainSeq: 3,
    engineProtocol: 1,
    wakeAtMs: null,
    leaseEpoch: null,
    leaseOwner: null,
    leaseExpiresAtMs: null,
  },
  resolution: null,
};

describe('legacy run quarantine boundaries [AUTO-R26]', () => {
  it('exposes only public hold facts without original lease ownership', () => {
    expect(describeLegacyQuarantine(hold, 3)).toEqual({
      reason: 'legacy_execution_unproven',
      observedAt: 100,
      claimEpoch: 3,
      priorStatus: 'waiting',
      resolution: null,
    });
    expect(describeLegacyQuarantine(null, 0)).toBeUndefined();
    expect(describeLegacyQuarantine(undefined, 0)).toBeUndefined();
  });
  it('refuses corrupt or unrecognized hold evidence rather than hiding it', () => {
    for (const value of [
      {},
      { ...hold, reason: 'other' },
      { ...hold, extra: true },
      { ...hold, resolution: { action: 'retry', actor: 'u1', at: 120 } },
      { ...hold, observedAtMs: -1 },
      { ...hold, prior: { ...hold.prior, status: 'success' } },
    ]) {
      expect(() => describeLegacyQuarantine(value, 3)).toThrow();
    }
    expect(() => describeLegacyQuarantine(hold, Number.NaN)).toThrow();
  });
  it('requires exact expected hold identity and an explicit unknown-effects acknowledgement', () => {
    const request = {
      expectedClaimEpoch: 3,
      expectedObservedAt: 100,
      action: 'stop',
      acknowledgeUnknownExternalEffects: true,
    };
    expect(legacyRunStopSchema.parse(request)).toEqual(request);
    for (const value of [
      { ...request, acknowledgeUnknownExternalEffects: false },
      { ...request, acknowledgeUnknownExternalEffects: undefined },
      { ...request, action: 'retry' },
      { ...request, expectedClaimEpoch: 1.1 },
      { ...request, expectedObservedAt: Number.MAX_SAFE_INTEGER + 1 },
      { ...request, expectedObservedAt: 9e15 },
      { ...request, actor: 'spoof' },
    ]) {
      expect(legacyRunStopSchema.safeParse(value).success).toBe(false);
    }
  });
});
