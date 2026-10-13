import { describe, expect, it } from 'vitest';

import { parseOrgSessionCutoverAt } from './org-session-cutover.ts';

const NOW = Date.UTC(2026, 9, 12, 23);
describe('operator organization-session cutover', () => {
  it('keeps the unset first rollout compatible', () => {
    expect(parseOrgSessionCutoverAt(undefined, NOW)).toBeNull();
    expect(parseOrgSessionCutoverAt('', NOW)).toBeNull();
  });
  it('accepts an exact reached UTC cutoff, including exactly now', () => {
    expect(parseOrgSessionCutoverAt(new Date(NOW).toISOString(), NOW)).toBe(
      NOW,
    );
    expect(parseOrgSessionCutoverAt(new Date(NOW - 1).toISOString(), NOW)).toBe(
      NOW - 1,
    );
  });
  it.each([
    ' ',
    '2026-10-12',
    '2026-10-12T23:00:00Z',
    '2026-10-12T23:00:00.000+00:00',
    '2026-02-30T23:00:00.000Z',
    '2026-10-12T23:00:00.000Z\n',
  ])('refuses ambiguous or invalid UTC %j', (raw) => {
    expect(() => parseOrgSessionCutoverAt(raw, NOW)).toThrow('exact UTC');
  });
  it('refuses even a one-millisecond future fence', () => {
    expect(() =>
      parseOrgSessionCutoverAt(new Date(NOW + 1).toISOString(), NOW),
    ).toThrow('already have been reached');
  });
});
