import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { EPOCH_MS_MAX, epochMsSchema, isEpochMs } from './epoch-ms';

/**
 * One stored `sentAt: 9e15` — a safe integer, so `.int()` let it in — made
 * `new Date(x).toISOString()` throw and failed an organization's whole Inbox
 * list. Every timestamp a door takes is held to the range a `Date` can hold.
 */
describe('epochMsSchema', () => {
  it.each([0, Date.UTC(2026, 8, 27), EPOCH_MS_MAX])(
    'takes %s, which a Date renders',
    (value) => {
      expect(epochMsSchema.parse(value)).toBe(value);
      expect(new Date(value).toISOString()).toMatch(/Z$/);
    },
  );

  it.each([
    9e15,
    EPOCH_MS_MAX + 1,
    Number.MAX_SAFE_INTEGER + 2,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '1790400000000',
    null,
  ])('refuses %s', (value) => {
    expect(epochMsSchema.safeParse(value).success).toBe(false);
  });

  it('reports one issue per refused value', () => {
    for (const value of [
      9e15,
      Number.MAX_SAFE_INTEGER + 2,
      1e300,
      -1e300,
      -1,
      1.5,
    ]) {
      expect(epochMsSchema.safeParse(value).error?.issues).toHaveLength(1);
    }
  });

  it('publishes the bound in its JSON Schema', () => {
    expect(
      z.toJSONSchema(epochMsSchema, { target: 'openapi-3.0', io: 'input' }),
    ).toMatchObject({ type: 'integer', minimum: 0, maximum: EPOCH_MS_MAX });
  });
});

describe('isEpochMs', () => {
  it('admits exactly what the schema takes', () => {
    for (const value of [0, EPOCH_MS_MAX, 1_790_400_000_000]) {
      expect(isEpochMs(value)).toBe(true);
    }
    for (const value of [9e15, EPOCH_MS_MAX + 1, -1, 0.5, undefined, null]) {
      expect(isEpochMs(value)).toBe(false);
    }
  });
});
