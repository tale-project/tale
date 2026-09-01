import { describe, it, expect } from 'vitest';

import { isLoosening } from './dsar_policy';

/**
 * `isLoosening` is the DIRECTION rule for a DSAR policy edit: tightening
 * applies at once, loosening has to sit out the cooling-off window. It is the
 * one part of the 0.4 DSAR module the 0.5 governance tail still calls
 * (`backend/domains/governance/settings-tail.ts`), so it is tested here.
 *
 * The propose / stage / cancel / elapsed-apply arc around it was rebuilt
 * natively on `/api/app/governance/dsar/policy` — 0.5 applies a staged change
 * lazily on the next read instead of from a scheduled job — and is covered
 * end-to-end by the integration run against a real database.
 */

describe('isLoosening', () => {
  const base = {
    coolingOffHours: 24,
    requireDualApproval: true,
    dailyLimitPerAdmin: 5,
  };
  it('detects shorter cooling-off as loosening', () => {
    expect(isLoosening(base, { ...base, coolingOffHours: 4 })).toBe(true);
  });
  it('detects disabling dual approval as loosening', () => {
    expect(isLoosening(base, { ...base, requireDualApproval: false })).toBe(
      true,
    );
  });
  it('detects raising daily limit as loosening', () => {
    expect(isLoosening(base, { ...base, dailyLimitPerAdmin: 50 })).toBe(true);
  });
  it('treats tightening as not loosening', () => {
    expect(isLoosening(base, { ...base, coolingOffHours: 48 })).toBe(false);
    expect(
      isLoosening(
        { ...base, requireDualApproval: false },
        { ...base, requireDualApproval: true },
      ),
    ).toBe(false);
    expect(isLoosening(base, { ...base, dailyLimitPerAdmin: 1 })).toBe(false);
  });
  it('mixed direction: any single loosening axis triggers true', () => {
    expect(
      isLoosening(base, {
        coolingOffHours: 4, // looser
        requireDualApproval: true,
        dailyLimitPerAdmin: 1, // tighter
      }),
    ).toBe(true);
  });
  it('no change returns false', () => {
    expect(isLoosening(base, { ...base })).toBe(false);
  });
});
