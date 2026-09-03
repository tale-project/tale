import { describe, expect, it } from 'vitest';

import type { BudgetRule } from '../../../lib/shared/schemas/governance';
import {
  checkRuleAgainstUsage,
  collectAllApplicableRules,
  resolveEffectiveLimits,
} from './budget_enforcement';

describe('collectAllApplicableRules', () => {
  const rules: BudgetRule[] = [
    { scope: 'default', period: 'monthly', maxTokens: 500_000 },
    {
      scope: 'user',
      scopeId: 'user-1',
      period: 'monthly',
      maxTokens: 1_000_000,
    },
    { scope: 'user', scopeId: 'user-2', period: 'monthly', maxTokens: 200_000 },
    {
      scope: 'team',
      scopeId: 'team-a',
      period: 'monthly',
      maxTokens: 2_000_000,
    },
    { scope: 'team', scopeId: 'team-b', period: 'monthly', maxCostCents: 5000 },
    { scope: 'role', scopeId: 'member', period: 'monthly', maxRequests: 100 },
    { scope: 'role', scopeId: 'admin', period: 'monthly', maxRequests: 1000 },
  ];

  it('returns user-scoped rule for matching user', () => {
    const result = collectAllApplicableRules(rules, 'user-1', [], 'member');
    expect(
      result.some((r) => r.scope === 'user' && r.scopeId === 'user-1'),
    ).toBe(true);
  });

  it('does not return user-scoped rule for non-matching user', () => {
    const result = collectAllApplicableRules(rules, 'user-99', [], 'member');
    expect(result.some((r) => r.scope === 'user')).toBe(false);
  });

  it('returns team-scoped rules for matching user teams', () => {
    const result = collectAllApplicableRules(
      rules,
      'user-99',
      ['team-a'],
      'member',
    );
    expect(
      result.some((r) => r.scope === 'team' && r.scopeId === 'team-a'),
    ).toBe(true);
  });

  it('returns multiple team rules when user is in multiple teams', () => {
    const result = collectAllApplicableRules(
      rules,
      'user-99',
      ['team-a', 'team-b'],
      'member',
    );
    const teamRules = result.filter((r) => r.scope === 'team');
    expect(teamRules).toHaveLength(2);
  });

  it('returns role-scoped rule for matching role', () => {
    const result = collectAllApplicableRules(rules, 'user-99', [], 'member');
    expect(
      result.some((r) => r.scope === 'role' && r.scopeId === 'member'),
    ).toBe(true);
  });

  it('does not return role-scoped rule when no role provided', () => {
    const result = collectAllApplicableRules(rules, 'user-99', []);
    expect(result.some((r) => r.scope === 'role')).toBe(false);
  });

  it('always returns default-scoped rules', () => {
    const result = collectAllApplicableRules(rules, 'user-99', []);
    expect(result.some((r) => r.scope === 'default')).toBe(true);
  });

  it('returns all applicable rules combined', () => {
    const result = collectAllApplicableRules(
      rules,
      'user-1',
      ['team-a'],
      'member',
    );
    expect(result.length).toBeGreaterThanOrEqual(3); // user + team + role + default
  });

  it('returns empty array when no rules match', () => {
    const result = collectAllApplicableRules(
      [],
      'user-1',
      ['team-a'],
      'member',
    );
    expect(result).toEqual([]);
  });
});

describe('checkRuleAgainstUsage', () => {
  it('returns null when no limits are set', () => {
    const rule: BudgetRule = { scope: 'default', period: 'monthly' };
    const result = checkRuleAgainstUsage(rule, {
      totalTokens: 999_999,
      costEstimate: 999_999,
      requestCount: 999_999,
    });
    expect(result).toBeNull();
  });

  it('returns TOKEN_LIMIT when tokens exceeded', () => {
    const rule: BudgetRule = {
      scope: 'default',
      period: 'monthly',
      maxTokens: 1000,
    };
    const result = checkRuleAgainstUsage(rule, {
      totalTokens: 1000,
      costEstimate: 0,
      requestCount: 0,
    });
    expect(result).not.toBeNull();
    expect(result?.allowed).toBe(false);
    expect(result?.code).toBe('TOKEN_LIMIT');
  });

  it('returns COST_LIMIT when cost exceeded', () => {
    const rule: BudgetRule = {
      scope: 'default',
      period: 'monthly',
      maxCostCents: 500,
    };
    const result = checkRuleAgainstUsage(rule, {
      totalTokens: 0,
      costEstimate: 500,
      requestCount: 0,
    });
    expect(result).not.toBeNull();
    expect(result?.code).toBe('COST_LIMIT');
  });

  it('returns REQUEST_LIMIT when requests exceeded', () => {
    const rule: BudgetRule = {
      scope: 'default',
      period: 'monthly',
      maxRequests: 10,
    };
    const result = checkRuleAgainstUsage(rule, {
      totalTokens: 0,
      costEstimate: 0,
      requestCount: 10,
    });
    expect(result).not.toBeNull();
    expect(result?.code).toBe('REQUEST_LIMIT');
  });

  it('returns null when usage is under limits', () => {
    const rule: BudgetRule = {
      scope: 'default',
      period: 'monthly',
      maxTokens: 1000,
      maxCostCents: 500,
      maxRequests: 10,
    };
    const result = checkRuleAgainstUsage(rule, {
      totalTokens: 999,
      costEstimate: 499,
      requestCount: 9,
    });
    expect(result).toBeNull();
  });

  it('checks token limit first (priority order)', () => {
    const rule: BudgetRule = {
      scope: 'default',
      period: 'monthly',
      maxTokens: 100,
      maxCostCents: 100,
      maxRequests: 1,
    };
    const result = checkRuleAgainstUsage(rule, {
      totalTokens: 100,
      costEstimate: 100,
      requestCount: 1,
    });
    expect(result?.code).toBe('TOKEN_LIMIT');
  });

  it('includes period in violation result', () => {
    const rule: BudgetRule = {
      scope: 'default',
      period: 'daily',
      maxTokens: 100,
    };
    const result = checkRuleAgainstUsage(rule, {
      totalTokens: 100,
      costEstimate: 0,
      requestCount: 0,
    });
    expect(result?.period).toBe('daily');
  });
});

describe('resolveEffectiveLimits', () => {
  it('uses user-scoped limits as highest priority', () => {
    const rules: BudgetRule[] = [
      { scope: 'default', period: 'monthly', maxTokens: 500_000 },
      {
        scope: 'user',
        scopeId: 'user-1',
        period: 'monthly',
        maxTokens: 1_000_000,
      },
    ];
    const result = resolveEffectiveLimits(rules, 'user-1', [], 'member');
    expect(result.maxTokens).toBe(1_000_000);
  });

  it('falls back to team-scoped limits when no user limit', () => {
    const rules: BudgetRule[] = [
      { scope: 'default', period: 'monthly', maxTokens: 500_000 },
      {
        scope: 'team',
        scopeId: 'team-a',
        period: 'monthly',
        maxTokens: 750_000,
      },
    ];
    const result = resolveEffectiveLimits(
      rules,
      'user-1',
      ['team-a'],
      'member',
    );
    expect(result.maxTokens).toBe(750_000);
  });

  it('falls back to role-scoped limits when no user or team limit', () => {
    const rules: BudgetRule[] = [
      { scope: 'default', period: 'monthly', maxTokens: 500_000 },
      {
        scope: 'role',
        scopeId: 'member',
        period: 'monthly',
        maxTokens: 600_000,
      },
    ];
    const result = resolveEffectiveLimits(rules, 'user-1', [], 'member');
    expect(result.maxTokens).toBe(600_000);
  });

  it('falls back to default when no more specific limits exist', () => {
    const rules: BudgetRule[] = [
      { scope: 'default', period: 'monthly', maxTokens: 500_000 },
    ];
    const result = resolveEffectiveLimits(rules, 'user-1', [], 'member');
    expect(result.maxTokens).toBe(500_000);
  });

  it('resolves each limit field independently', () => {
    const rules: BudgetRule[] = [
      { scope: 'default', period: 'monthly', maxCostCents: 10_000 },
      {
        scope: 'user',
        scopeId: 'user-1',
        period: 'monthly',
        maxTokens: 1_000_000,
      },
    ];
    // User-level maxTokens overrides, but default maxCostCents still applies
    const result = resolveEffectiveLimits(rules, 'user-1', [], 'member');
    expect(result.maxTokens).toBe(1_000_000);
    expect(result.maxCostCents).toBe(10_000);
  });

  it('returns undefined for unset limits', () => {
    const rules: BudgetRule[] = [
      { scope: 'default', period: 'monthly', maxTokens: 500_000 },
    ];
    const result = resolveEffectiveLimits(rules, 'user-1', [], 'member');
    expect(result.maxCostCents).toBeUndefined();
    expect(result.maxRequests).toBeUndefined();
  });

  it('picks most permissive team rule for multi-team users', () => {
    const rules: BudgetRule[] = [
      {
        scope: 'team',
        scopeId: 'team-a',
        period: 'monthly',
        maxTokens: 500_000,
      },
      {
        scope: 'team',
        scopeId: 'team-b',
        period: 'monthly',
        maxTokens: 1_000_000,
      },
    ];
    const result = resolveEffectiveLimits(
      rules,
      'user-1',
      ['team-a', 'team-b'],
      'member',
    );
    expect(result.maxTokens).toBe(1_000_000);
  });

  it("returns the team's own caps as its shared teamLimits entry", () => {
    const rules: BudgetRule[] = [
      {
        scope: 'team',
        scopeId: 'team-a',
        period: 'monthly',
        maxTokens: 500_000,
      },
    ];
    const result = resolveEffectiveLimits(
      rules,
      'user-1',
      ['team-a'],
      'member',
    );
    expect(result.teamLimits).toEqual([
      { teamId: 'team-a', maxTokens: 500_000 },
    ]);
  });

  it('keeps the team shared cap in force when a user rule wins the personal tier', () => {
    const rules: BudgetRule[] = [
      {
        scope: 'user',
        scopeId: 'user-1',
        period: 'monthly',
        maxTokens: 1_000_000,
      },
      {
        scope: 'team',
        scopeId: 'team-a',
        period: 'monthly',
        maxTokens: 500_000,
      },
    ];
    const result = resolveEffectiveLimits(
      rules,
      'user-1',
      ['team-a'],
      'member',
    );
    // Personal tier: the narrower user rule. Shared tier: the team's own cap
    // still binds the team aggregate — a personal override never silently
    // lifts the pool everyone else is measured against.
    expect(result.maxTokens).toBe(1_000_000);
    expect(result.teamLimits).toEqual([
      { teamId: 'team-a', maxTokens: 500_000 },
    ]);
  });

  it('mixed resolution: a default-tier cap never joins the team aggregate check', () => {
    // The admin set a shared cost pool on the team and a per-member token
    // cap as the org default. The token cap is personal (default tier); the
    // team entry must carry ONLY the team rule's cost cap.
    const rules: BudgetRule[] = [
      { scope: 'default', period: 'monthly', maxTokens: 50_000 },
      {
        scope: 'team',
        scopeId: 'team-a',
        period: 'monthly',
        maxCostCents: 5_000,
      },
    ];
    const result = resolveEffectiveLimits(
      rules,
      'user-1',
      ['team-a'],
      'member',
    );
    expect(result.maxTokens).toBe(50_000);
    expect(result.maxCostCents).toBe(5_000);
    expect(result.teamLimits).toEqual([
      { teamId: 'team-a', maxCostCents: 5_000 },
    ]);
  });

  it('measures each team against its own rule, not the most permissive union', () => {
    const rules: BudgetRule[] = [
      {
        scope: 'team',
        scopeId: 'team-a',
        period: 'monthly',
        maxCostCents: 5_000,
      },
      {
        scope: 'team',
        scopeId: 'team-b',
        period: 'monthly',
        maxCostCents: 20_000,
        maxRequests: 100,
      },
    ];
    const result = resolveEffectiveLimits(
      rules,
      'user-1',
      ['team-a', 'team-b'],
      'member',
    );
    // Personal tier keeps the multi-team "most permissive" rule.
    expect(result.maxCostCents).toBe(20_000);
    expect(result.teamLimits).toEqual([
      { teamId: 'team-a', maxCostCents: 5_000 },
      { teamId: 'team-b', maxCostCents: 20_000, maxRequests: 100 },
    ]);
  });

  it('tightens per field when one team carries several rules for the period', () => {
    const rules: BudgetRule[] = [
      {
        scope: 'team',
        scopeId: 'team-a',
        period: 'monthly',
        maxCostCents: 5_000,
      },
      {
        scope: 'team',
        scopeId: 'team-a',
        period: 'monthly',
        maxCostCents: 3_000,
        maxTokens: 900_000,
      },
    ];
    const result = resolveEffectiveLimits(
      rules,
      'user-1',
      ['team-a'],
      'member',
    );
    expect(result.teamLimits).toEqual([
      { teamId: 'team-a', maxTokens: 900_000, maxCostCents: 3_000 },
    ]);
  });

  it('returns no teamLimits when the user is in no rule-bearing team', () => {
    const rules: BudgetRule[] = [
      { scope: 'default', period: 'monthly', maxTokens: 50_000 },
      {
        scope: 'team',
        scopeId: 'team-z',
        period: 'monthly',
        maxCostCents: 5_000,
      },
    ];
    const result = resolveEffectiveLimits(
      rules,
      'user-1',
      ['team-a'],
      'member',
    );
    expect(result.teamLimits).toEqual([]);
  });

  it('returns empty limits when no rules match', () => {
    const rules: BudgetRule[] = [
      {
        scope: 'user',
        scopeId: 'other-user',
        period: 'monthly',
        maxTokens: 100,
      },
    ];
    const result = resolveEffectiveLimits(rules, 'user-1', [], 'member');
    expect(result.maxTokens).toBeUndefined();
    expect(result.maxCostCents).toBeUndefined();
    expect(result.maxRequests).toBeUndefined();
  });

  it('handles org-scoped rules separately', () => {
    const rules: BudgetRule[] = [
      { scope: 'org', period: 'monthly', maxTokens: 10_000_000 },
      { scope: 'default', period: 'monthly', maxTokens: 500_000 },
    ];
    const result = resolveEffectiveLimits(rules, 'user-1', [], 'member');
    // org-scoped rules are independent, per-user effective limit comes from default
    expect(result.maxTokens).toBe(500_000);
    expect(result.orgMaxTokens).toBe(10_000_000);
  });

  it('handles org limits independently from per-user limits', () => {
    const rules: BudgetRule[] = [
      {
        scope: 'org',
        period: 'monthly',
        maxCostCents: 100_000,
        maxTokens: 50_000_000,
      },
      {
        scope: 'user',
        scopeId: 'user-1',
        period: 'monthly',
        maxTokens: 2_000_000,
      },
      { scope: 'default', period: 'monthly', maxCostCents: 5_000 },
    ];
    const result = resolveEffectiveLimits(rules, 'user-1', [], 'member');
    expect(result.maxTokens).toBe(2_000_000);
    expect(result.maxCostCents).toBe(5_000);
    expect(result.orgMaxTokens).toBe(50_000_000);
    expect(result.orgMaxCostCents).toBe(100_000);
  });

  it('resolves limits independently across different periods', () => {
    const rules: BudgetRule[] = [
      { scope: 'default', period: 'daily', maxRequests: 10 },
      { scope: 'default', period: 'monthly', maxTokens: 500_000 },
    ];
    const dailyResult = resolveEffectiveLimits(
      rules.filter((r) => r.period === 'daily'),
      'user-1',
      [],
      'member',
    );
    const monthlyResult = resolveEffectiveLimits(
      rules.filter((r) => r.period === 'monthly'),
      'user-1',
      [],
      'member',
    );
    expect(dailyResult.maxRequests).toBe(10);
    expect(dailyResult.maxTokens).toBeUndefined();
    expect(monthlyResult.maxTokens).toBe(500_000);
    expect(monthlyResult.maxRequests).toBeUndefined();
  });
});

describe('checkRuleAgainstUsage — multi-period scenarios', () => {
  it('enforces daily request limit', () => {
    const rule: BudgetRule = {
      scope: 'default',
      period: 'daily',
      maxRequests: 2,
    };
    const result = checkRuleAgainstUsage(rule, {
      totalTokens: 0,
      costEstimate: 0,
      requestCount: 2,
    });
    expect(result).not.toBeNull();
    expect(result?.allowed).toBe(false);
    expect(result?.code).toBe('REQUEST_LIMIT');
    expect(result?.period).toBe('daily');
  });

  it('enforces weekly token limit', () => {
    const rule: BudgetRule = {
      scope: 'default',
      period: 'weekly',
      maxTokens: 50_000,
    };
    const result = checkRuleAgainstUsage(rule, {
      totalTokens: 50_000,
      costEstimate: 0,
      requestCount: 0,
    });
    expect(result).not.toBeNull();
    expect(result?.code).toBe('TOKEN_LIMIT');
    expect(result?.period).toBe('weekly');
  });

  it('allows request under daily limit', () => {
    const rule: BudgetRule = {
      scope: 'default',
      period: 'daily',
      maxRequests: 5,
    };
    const result = checkRuleAgainstUsage(rule, {
      totalTokens: 0,
      costEstimate: 0,
      requestCount: 4,
    });
    expect(result).toBeNull();
  });
});

describe('collectAllApplicableRules — apiKey scope', () => {
  const rules: BudgetRule[] = [
    { scope: 'default', period: 'monthly', maxRequests: 1000 },
    {
      scope: 'apiKey',
      apiKeyId: 'key-A',
      period: 'monthly',
      maxRequests: 2,
    },
    {
      scope: 'apiKey',
      apiKeyId: 'key-B',
      period: 'monthly',
      maxRequests: 50,
    },
  ];

  it('matches an apiKey rule only for the request that carries that key id', () => {
    const result = collectAllApplicableRules(
      rules,
      'user-1',
      [],
      'member',
      'key-A',
    );
    const keyRules = result.filter((r) => r.scope === 'apiKey');
    expect(keyRules).toHaveLength(1);
    expect(keyRules[0]?.apiKeyId).toBe('key-A');
  });

  it('does not match any apiKey rule when the request carries no key', () => {
    const result = collectAllApplicableRules(rules, 'user-1', [], 'member');
    expect(result.some((r) => r.scope === 'apiKey')).toBe(false);
  });

  it('does not match key-B rule for a key-A request (per-key isolation)', () => {
    const result = collectAllApplicableRules(
      rules,
      'user-1',
      [],
      'member',
      'key-A',
    );
    expect(
      result.some((r) => r.scope === 'apiKey' && r.apiKeyId === 'key-B'),
    ).toBe(false);
  });

  it('still returns the default rule alongside the matched apiKey rule', () => {
    const result = collectAllApplicableRules(
      rules,
      'user-1',
      [],
      'member',
      'key-A',
    );
    expect(result.some((r) => r.scope === 'default')).toBe(true);
  });
});

describe('resolveEffectiveLimits — apiKey scope (independent bucket)', () => {
  it('resolves apiKey caps into their own bucket, not the per-user tier', () => {
    const rules: BudgetRule[] = [
      {
        scope: 'user',
        scopeId: 'user-1',
        period: 'monthly',
        maxRequests: 1000,
      },
      {
        scope: 'apiKey',
        apiKeyId: 'key-A',
        period: 'monthly',
        maxRequests: 2,
      },
    ];
    const result = resolveEffectiveLimits(
      rules,
      'user-1',
      [],
      'member',
      'key-A',
    );
    // The user cap stays the effective per-user limit; the key cap is separate.
    expect(result.maxRequests).toBe(1000);
    expect(result.apiKeyMaxRequests).toBe(2);
  });

  it('a per-key cap binds even when the user cap is much higher', () => {
    const rules: BudgetRule[] = [
      {
        scope: 'user',
        scopeId: 'user-1',
        period: 'monthly',
        maxCostCents: 100_000,
      },
      {
        scope: 'apiKey',
        apiKeyId: 'key-A',
        period: 'monthly',
        maxCostCents: 5,
      },
    ];
    const result = resolveEffectiveLimits(
      rules,
      'user-1',
      [],
      'member',
      'key-A',
    );
    expect(result.maxCostCents).toBe(100_000);
    expect(result.apiKeyMaxCostCents).toBe(5);
  });

  it('leaves apiKey caps undefined when no key is supplied', () => {
    const rules: BudgetRule[] = [
      {
        scope: 'apiKey',
        apiKeyId: 'key-A',
        period: 'monthly',
        maxRequests: 2,
      },
    ];
    const result = resolveEffectiveLimits(rules, 'user-1', [], 'member');
    expect(result.apiKeyMaxRequests).toBeUndefined();
  });

  it('uses the tightest (min) cap across multiple rules for the same key', () => {
    const rules: BudgetRule[] = [
      {
        scope: 'apiKey',
        apiKeyId: 'key-A',
        period: 'monthly',
        maxRequests: 10,
      },
      {
        scope: 'apiKey',
        apiKeyId: 'key-A',
        period: 'monthly',
        maxRequests: 3,
      },
    ];
    const result = resolveEffectiveLimits(
      rules,
      'user-1',
      [],
      'member',
      'key-A',
    );
    expect(result.apiKeyMaxRequests).toBe(3);
  });
});

describe('collectAllApplicableRules — mixed periods', () => {
  it('collects rules across different periods for the same user', () => {
    const rules: BudgetRule[] = [
      { scope: 'default', period: 'daily', maxRequests: 10 },
      { scope: 'default', period: 'monthly', maxTokens: 500_000 },
      {
        scope: 'user',
        scopeId: 'user-1',
        period: 'weekly',
        maxCostCents: 1000,
      },
    ];
    const result = collectAllApplicableRules(rules, 'user-1', [], 'member');
    expect(result).toHaveLength(3);
    const periods = result.map((r) => r.period);
    expect(periods).toContain('daily');
    expect(periods).toContain('weekly');
    expect(periods).toContain('monthly');
  });
});
