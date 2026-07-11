import { describe, expect, it } from 'vitest';

import { feedbackMetricsSearchSchema as searchSchema } from '@/app/features/analytics/feedback/feedback-metrics-search';

// Regression coverage for #2034 on the consolidated metrics route: a
// shared/bookmarked `?period=90` (or `?comments=1`) URL is parsed by the
// router as the JSON number 90/1, which must not crash the route via
// SearchParamError.
describe('metrics feedback searchSchema', () => {
  it('coerces numeric period values to the string enum', () => {
    expect(searchSchema.parse({ period: 90 }).period).toBe('90');
    expect(searchSchema.parse({ period: 30 }).period).toBe('30');
    expect(searchSchema.parse({ period: 7 }).period).toBe('7');
    expect(searchSchema.parse({ period: 1 }).period).toBe('1');
  });

  it('accepts string period values, including "all"', () => {
    expect(searchSchema.parse({ period: '90' }).period).toBe('90');
    expect(searchSchema.parse({ period: 'all' }).period).toBe('all');
  });

  it('falls back to the default window for out-of-range period values', () => {
    expect(searchSchema.parse({ period: 999 }).period).toBe('7');
    expect(searchSchema.parse({ period: 'nonsense' }).period).toBe('7');
  });

  it('leaves an omitted period undefined', () => {
    expect(searchSchema.parse({}).period).toBeUndefined();
  });

  it('coerces a numeric comments flag to the string enum', () => {
    expect(searchSchema.parse({ comments: 1 }).comments).toBe('1');
    expect(searchSchema.parse({ comments: '1' }).comments).toBe('1');
  });

  it('falls back to undefined for an out-of-range comments value', () => {
    expect(searchSchema.parse({ comments: 0 }).comments).toBeUndefined();
    expect(searchSchema.parse({ comments: 2 }).comments).toBeUndefined();
    expect(searchSchema.parse({}).comments).toBeUndefined();
  });

  it('leaves unaffected string params intact', () => {
    expect(searchSchema.parse({ kind: 'arena' }).kind).toBe('arena');
    expect(searchSchema.parse({ agent: 'foo' }).agent).toBe('foo');
  });
});
