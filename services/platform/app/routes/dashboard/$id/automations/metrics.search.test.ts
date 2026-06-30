import { describe, expect, it } from 'vitest';

import { searchSchema } from './metrics';

// Regression coverage for #2024: a shared/bookmarked
// `/automations/metrics?period=90` URL is parsed by the router as the JSON
// number 90, which must not crash the route via SearchParamError.
describe('automations metrics searchSchema', () => {
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
