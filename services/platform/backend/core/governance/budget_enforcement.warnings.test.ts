import { describe, expect, it } from 'vitest';

import type { BudgetRule } from '../../../lib/shared/schemas/governance';
import {
  collectApiKeyWarnings,
  collectBucketWarnings,
  collectOrgWarnings,
  collectWarnings,
  resolveEffectiveLimits,
} from './budget_enforcement';

/**
 * A `warningThresholdPercent` on an org- or apiKey-scoped rule produces the
 * approach signal it promises. Regression: `resolveEffectiveLimits` resolved
 * `orgWarningThresholdPercent` / `apiKeyWarningThresholdPercent` and nothing
 * read them — the org budget went from silent straight to hard-blocked.
 */
describe('org and API-key budget warnings', () => {
  const rules: BudgetRule[] = [
    {
      scope: 'org',
      period: 'monthly',
      maxCostCents: 10_000,
      maxTokens: 1_000_000,
      warningThresholdPercent: 80,
    },
    {
      scope: 'apiKey',
      apiKeyId: 'key-1',
      period: 'monthly',
      maxRequests: 100,
      warningThresholdPercent: 90,
    },
    { scope: 'default', period: 'monthly', maxTokens: 50_000 },
  ];
  const limits = resolveEffectiveLimits(rules, 'user-1', [], 'member', 'key-1');

  it('resolves the thresholds the warnings read', () => {
    expect(limits.orgWarningThresholdPercent).toBe(80);
    expect(limits.apiKeyWarningThresholdPercent).toBe(90);
    expect(limits.warningThresholdPercent).toBeUndefined();
  });

  it('warns for the org bucket once org usage crosses the org threshold', () => {
    const warnings = collectOrgWarnings(
      limits,
      { totalTokens: 100, costEstimate: 8_500, requestCount: 0 },
      'monthly',
    );
    expect(warnings).toEqual([
      {
        code: 'COST_WARNING',
        scope: 'org',
        period: 'monthly',
        used: 8_500,
        limit: 10_000,
        percent: 85,
      },
    ]);
  });

  it('stays silent for the org bucket below the threshold and at the cap', () => {
    expect(
      collectOrgWarnings(
        limits,
        { totalTokens: 0, costEstimate: 7_999, requestCount: 0 },
        'monthly',
      ),
    ).toEqual([]);
    // At or past the cap the hard block speaks, not a warning.
    expect(
      collectOrgWarnings(
        limits,
        { totalTokens: 0, costEstimate: 10_000, requestCount: 0 },
        'monthly',
      ),
    ).toEqual([]);
  });

  it('projects the prospective spend into the org warning like the user one', () => {
    const warnings = collectOrgWarnings(
      limits,
      { totalTokens: 0, costEstimate: 7_900, requestCount: 0 },
      'monthly',
      200,
    );
    expect(warnings.map((w) => [w.code, w.used])).toEqual([
      ['COST_WARNING', 8_100],
    ]);
  });

  it('warns for the API key bucket at its own threshold', () => {
    const warnings = collectApiKeyWarnings(
      limits,
      { totalTokens: 0, costEstimate: 0, requestCount: 90 },
      'monthly',
    );
    expect(warnings).toEqual([
      {
        code: 'REQUEST_WARNING',
        scope: 'apiKey',
        period: 'monthly',
        used: 90,
        limit: 100,
        percent: 90,
      },
    ]);
  });

  it('keeps the user bucket on its own threshold — none here, so no user warning', () => {
    expect(
      collectWarnings(
        limits,
        { totalTokens: 49_000, costEstimate: 0, requestCount: 0 },
        'monthly',
      ),
    ).toEqual([]);
  });

  it('measures each bucket against its own caps, never another bucket’s', () => {
    // Org usage far past the USER token cap must not raise an org warning:
    // the org bucket has its own 1M-token cap.
    expect(
      collectOrgWarnings(
        limits,
        { totalTokens: 60_000, costEstimate: 0, requestCount: 0 },
        'monthly',
      ),
    ).toEqual([]);
  });

  it('a bucket without a threshold asked for a hard stop only', () => {
    expect(
      collectBucketWarnings(
        'org',
        undefined,
        { maxTokens: 100 },
        { totalTokens: 99, costEstimate: 0, requestCount: 0 },
        'daily',
      ),
    ).toEqual([]);
  });

  it('stamps the user scope on the personal warnings', () => {
    const personal = resolveEffectiveLimits(
      [
        {
          scope: 'default',
          period: 'daily',
          maxTokens: 1_000,
          warningThresholdPercent: 50,
        },
      ],
      'user-1',
      [],
      'member',
    );
    expect(
      collectWarnings(
        personal,
        { totalTokens: 600, costEstimate: 0, requestCount: 0 },
        'daily',
      ).map((w) => w.scope),
    ).toEqual(['user']);
  });
});
