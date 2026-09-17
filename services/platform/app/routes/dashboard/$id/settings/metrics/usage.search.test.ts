import { describe, expect, it } from 'vitest';

import { usageSearchSchema } from '@/app/features/analytics/usage/usage-metrics-search';

describe('usage report URL state', () => {
  it('preserves every supported chart dimension through a serialized URL', () => {
    const params = new URLSearchParams({
      period: '90',
      granularity: 'weekly',
      metric: 'cost',
    });
    expect(usageSearchSchema.parse(Object.fromEntries(params))).toEqual({
      period: '90',
      granularity: 'weekly',
      metric: 'cost',
    });
  });

  it('handles invalid and absent filters without a route error', () => {
    expect(
      usageSearchSchema.parse({
        period: 7,
        granularity: 'never',
        metric: 'wrong',
      }),
    ).toEqual({ period: '7', granularity: 'daily', metric: 'tokens' });
    expect(usageSearchSchema.parse({})).toEqual({});
  });
});
