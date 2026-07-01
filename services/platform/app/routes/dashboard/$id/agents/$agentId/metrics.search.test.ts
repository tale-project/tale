import { describe, expect, it } from 'vitest';

import { searchSchema } from './metrics';

// The per-agent scorecard threads the shared metrics period (7/30/90) instead
// of a hard-pinned 30-day window. It reuses the workforce dashboard's coercion,
// so it carries the same #1987 regression guard: a shared/bookmarked
// `/agents/<id>/metrics?period=90` URL is parsed by the router as the JSON
// number 90, which must not crash the route via SearchParamError.
describe('agent scorecard searchSchema', () => {
  it('coerces numeric period values to the string enum', () => {
    expect(searchSchema.parse({ period: 90 }).period).toBe('90');
    expect(searchSchema.parse({ period: 30 }).period).toBe('30');
    expect(searchSchema.parse({ period: 7 }).period).toBe('7');
  });

  it('accepts string period values', () => {
    expect(searchSchema.parse({ period: '90' }).period).toBe('90');
  });

  it('falls back to the default window for out-of-range values', () => {
    expect(searchSchema.parse({ period: 999 }).period).toBe('30');
    expect(searchSchema.parse({ period: 'nonsense' }).period).toBe('30');
  });

  it('leaves an omitted period undefined', () => {
    expect(searchSchema.parse({}).period).toBeUndefined();
  });
});
