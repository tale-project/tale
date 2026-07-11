import { describe, expect, it } from 'vitest';

import {
  metricsPeriodSearchSchema as searchSchema,
  metricsPeriodToParam,
  parseMetricsPeriodDays,
} from '@/app/components/metrics/metrics-period';

// Regression coverage for the #1987/#2024 bug class on the consolidated
// metrics routes (usage, automations, projects): a shared/bookmarked
// `?period=90` URL is parsed by the router as the JSON number 90, which must
// not crash the route via SearchParamError.
describe('shared metrics period searchSchema', () => {
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

describe('parseMetricsPeriodDays', () => {
  it('maps every param to its day window', () => {
    expect(parseMetricsPeriodDays('7')).toBe(7);
    expect(parseMetricsPeriodDays('30')).toBe(30);
    expect(parseMetricsPeriodDays('90')).toBe(90);
  });

  it('falls back to the default window when the param is absent', () => {
    expect(parseMetricsPeriodDays(undefined)).toBe(30);
    expect(parseMetricsPeriodDays(undefined, 7)).toBe(7);
  });
});

describe('metricsPeriodToParam', () => {
  it('round-trips every day window', () => {
    expect(metricsPeriodToParam(7)).toBe('7');
    expect(metricsPeriodToParam(30)).toBe('30');
    expect(metricsPeriodToParam(90)).toBe('90');
  });
});
