/**
 * The turn allowance: the deployment default capped by what remains under
 * every cost rule that binds the subject — after the ledger AND the
 * reservations of every turn still in flight — with a reached token or
 * request cap refusing outright. The policy file and the ledger are
 * scripted; the rule collectors/evaluators are the real ones.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const policy = vi.hoisted(() => ({
  config: null as null | { enabled: boolean; rules: unknown[] },
}));

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(async () => policy.config),
}));

const { checkOrgBudget, readBudgetStanding, resolveTurnAllowance } =
  await import('./budget-gate.ts');

interface Usage {
  totalTokens: number;
  costEstimate: number;
  requestCount: number;
}

/** A tagged-template `sql` answering the ledger sums by scope: the
 * `user_id`/`team_id` bindings are the 3rd and 5th values of the query. */
function ledger(usage: {
  user?: Usage;
  org?: Usage;
  teams?: Record<string, Usage>;
}) {
  const zero: Usage = { totalTokens: 0, costEstimate: 0, requestCount: 0 };
  const sql = async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    const userId = values[2] as string | null;
    const teamId = values[4] as string | null;
    if (userId !== null && userId !== undefined) return [usage.user ?? zero];
    if (teamId !== null && teamId !== undefined) {
      return [usage.teams?.[teamId] ?? zero];
    }
    return [usage.org ?? zero];
  };
  return sql as never;
}

const SUBJECT = {
  organizationId: 'org-1',
  userId: 'user-1',
  userTeamIds: ['team-1'],
  userRole: 'member',
};

beforeEach(() => {
  policy.config = null;
});

describe('resolveTurnAllowance', () => {
  it('grants the deployment default when no budget policy binds', async () => {
    const allowance = await resolveTurnAllowance(ledger({}), {
      ...SUBJECT,
      defaultCents: 500,
      reserved: { orgCents: 0, userCents: 0 },
    });
    expect(allowance).toEqual({ allowed: true, budgetCents: 500 });
  });

  it('caps the allowance by what remains under the org cap after reservations', async () => {
    policy.config = {
      enabled: true,
      rules: [{ scope: 'org', period: 'monthly', maxCostCents: 10_000 }],
    };
    const allowance = await resolveTurnAllowance(
      ledger({ org: { totalTokens: 0, costEstimate: 9_000, requestCount: 3 } }),
      {
        ...SUBJECT,
        defaultCents: 500,
        // Two other turns in flight hold 700 cents between them.
        reserved: { orgCents: 700, userCents: 0 },
      },
    );
    // 10_000 − 9_000 − 700 = 300 < the 500 default.
    expect(allowance).toEqual({ allowed: true, budgetCents: 300 });
  });

  it('refuses when the org cap is reached, with the cap’s own wording', async () => {
    policy.config = {
      enabled: true,
      rules: [{ scope: 'org', period: 'daily', maxCostCents: 1_000 }],
    };
    const allowance = await resolveTurnAllowance(
      ledger({ org: { totalTokens: 0, costEstimate: 600, requestCount: 1 } }),
      {
        ...SUBJECT,
        defaultCents: 500,
        reserved: { orgCents: 400, userCents: 0 },
      },
    );
    expect(allowance.allowed).toBe(false);
    if (!allowance.allowed) {
      expect(allowance.reason).toMatch(
        /Cost limit reached for this daily period/,
      );
    }
  });

  it('binds the personal cap against the user’s own spend and reservations', async () => {
    policy.config = {
      enabled: true,
      rules: [
        {
          scope: 'user',
          scopeId: 'user-1',
          period: 'monthly',
          maxCostCents: 2_000,
        },
        { scope: 'org', period: 'monthly', maxCostCents: 100_000 },
      ],
    };
    const allowance = await resolveTurnAllowance(
      ledger({
        user: { totalTokens: 0, costEstimate: 1_500, requestCount: 2 },
        org: { totalTokens: 0, costEstimate: 40_000, requestCount: 90 },
      }),
      {
        ...SUBJECT,
        defaultCents: 500,
        reserved: { orgCents: 5_000, userCents: 200 },
      },
    );
    // 2_000 − 1_500 − 200 = 300 (the org has 55_000 left).
    expect(allowance).toEqual({ allowed: true, budgetCents: 300 });
  });

  it('refuses outright once a request cap is reached', async () => {
    policy.config = {
      enabled: true,
      rules: [{ scope: 'default', period: 'daily', maxRequests: 10 }],
    };
    const allowance = await resolveTurnAllowance(
      ledger({ user: { totalTokens: 0, costEstimate: 0, requestCount: 9 } }),
      {
        ...SUBJECT,
        defaultCents: 500,
        reserved: { orgCents: 0, userCents: 0 },
      },
    );
    expect(allowance.allowed).toBe(false);
    if (!allowance.allowed) {
      expect(allowance.reason).toMatch(/Request limit reached/);
    }
  });

  it('measures a team’s shared cap against the team’s aggregate', async () => {
    policy.config = {
      enabled: true,
      rules: [
        {
          scope: 'team',
          scopeId: 'team-1',
          period: 'weekly',
          maxCostCents: 800,
        },
      ],
    };
    const allowance = await resolveTurnAllowance(
      ledger({
        teams: {
          'team-1': { totalTokens: 0, costEstimate: 650, requestCount: 4 },
        },
      }),
      {
        ...SUBJECT,
        defaultCents: 500,
        reserved: { orgCents: 0, userCents: 0 },
      },
    );
    expect(allowance).toEqual({ allowed: true, budgetCents: 150 });
  });
});

describe('readBudgetStanding', () => {
  // Tuesday 2026-09-15 13:00 UTC.
  const NOW = Date.UTC(2026, 8, 15, 13);

  it('answers no caps when no budget policy binds the subject', async () => {
    await expect(readBudgetStanding(ledger({}), SUBJECT, NOW)).resolves.toEqual(
      [],
    );
    policy.config = {
      enabled: false,
      rules: [{ scope: 'default', period: 'monthly', maxCostCents: 100 }],
    };
    await expect(readBudgetStanding(ledger({}), SUBJECT, NOW)).resolves.toEqual(
      [],
    );
    // Rules that name someone else never reach this subject.
    policy.config = {
      enabled: true,
      rules: [
        { scope: 'user', scopeId: 'user-2', period: 'daily', maxRequests: 5 },
        { scope: 'team', scopeId: 'team-9', period: 'daily', maxRequests: 5 },
        { scope: 'role', scopeId: 'admin', period: 'daily', maxRequests: 5 },
        { scope: 'apiKey', apiKeyId: 'key-1', period: 'daily', maxRequests: 5 },
      ],
    };
    await expect(readBudgetStanding(ledger({}), SUBJECT, NOW)).resolves.toEqual(
      [],
    );
  });

  it('reads the personal and organization buckets the gate checks', async () => {
    policy.config = {
      enabled: true,
      rules: [
        {
          scope: 'default',
          period: 'monthly',
          maxCostCents: 5_000,
          maxTokens: 1_000_000,
          warningThresholdPercent: 80,
        },
        {
          scope: 'org',
          period: 'monthly',
          maxCostCents: 50_000,
          warningThresholdPercent: 90,
        },
      ],
    };
    const user = {
      totalTokens: 412_300,
      costEstimate: 1_240,
      requestCount: 38,
    };
    const org = { totalTokens: 9e6, costEstimate: 31_000, requestCount: 900 };
    await expect(
      readBudgetStanding(ledger({ user, org }), SUBJECT, NOW),
    ).resolves.toEqual([
      {
        scope: 'user',
        period: 'monthly',
        periodKey: '2026-09',
        resetsAt: Date.UTC(2026, 9, 1),
        warningThresholdPercent: 80,
        maxTokens: 1_000_000,
        maxCostCents: 5_000,
        usage: user,
      },
      {
        scope: 'org',
        period: 'monthly',
        periodKey: '2026-09',
        resetsAt: Date.UTC(2026, 9, 1),
        warningThresholdPercent: 90,
        maxCostCents: 50_000,
        usage: org,
      },
    ]);
  });

  it('resolves each personal cap from the most specific rule that sets it', async () => {
    policy.config = {
      enabled: true,
      rules: [
        {
          scope: 'default',
          period: 'daily',
          maxCostCents: 100,
          maxRequests: 50,
        },
        {
          scope: 'role',
          scopeId: 'member',
          period: 'daily',
          maxCostCents: 300,
        },
        {
          scope: 'user',
          scopeId: 'user-1',
          period: 'daily',
          maxCostCents: 700,
        },
      ],
    };
    const [personal, ...rest] = await readBudgetStanding(
      ledger({ user: { totalTokens: 0, costEstimate: 20, requestCount: 3 } }),
      SUBJECT,
      NOW,
    );
    expect(rest).toEqual([]);
    expect(personal).toMatchObject({
      scope: 'user',
      period: 'daily',
      periodKey: '2026-09-15',
      resetsAt: Date.UTC(2026, 8, 16),
      maxCostCents: 700,
      maxRequests: 50,
    });
    expect(personal?.maxTokens).toBeUndefined();
  });

  it('shows a team rule as a personal cap and as the team’s shared cap', async () => {
    policy.config = {
      enabled: true,
      rules: [
        {
          scope: 'team',
          scopeId: 'team-1',
          period: 'weekly',
          maxRequests: 400,
          warningThresholdPercent: 75,
        },
      ],
    };
    const standing = await readBudgetStanding(
      ledger({
        user: { totalTokens: 0, costEstimate: 0, requestCount: 12 },
        teams: {
          'team-1': { totalTokens: 0, costEstimate: 0, requestCount: 260 },
        },
      }),
      SUBJECT,
      NOW,
    );
    expect(standing).toEqual([
      expect.objectContaining({
        scope: 'user',
        maxRequests: 400,
        warningThresholdPercent: 75,
        usage: { totalTokens: 0, costEstimate: 0, requestCount: 12 },
      }),
      {
        scope: 'team',
        teamId: 'team-1',
        period: 'weekly',
        periodKey: '2026-W38',
        resetsAt: Date.UTC(2026, 8, 21),
        maxRequests: 400,
        usage: { totalTokens: 0, costEstimate: 0, requestCount: 260 },
      },
    ]);
  });

  it('lists periods from the shortest to the longest', async () => {
    policy.config = {
      enabled: true,
      rules: [
        { scope: 'default', period: 'monthly', maxRequests: 1_000 },
        { scope: 'default', period: 'daily', maxRequests: 60 },
        { scope: 'default', period: 'weekly', maxRequests: 300 },
      ],
    };
    const standing = await readBudgetStanding(ledger({}), SUBJECT, NOW);
    expect(standing.map((s) => s.period)).toEqual([
      'daily',
      'weekly',
      'monthly',
    ]);
  });
});

describe('checkOrgBudget', () => {
  it('keeps the prospective-cost semantics the TTS lane relies on', async () => {
    policy.config = {
      enabled: true,
      rules: [{ scope: 'default', period: 'daily', maxCostCents: 100 }],
    };
    const sql = ledger({
      user: { totalTokens: 0, costEstimate: 95, requestCount: 1 },
    });
    await expect(
      checkOrgBudget(sql, {
        ...SUBJECT,
        prospectiveCostCents: 3,
        prospectiveRequests: 1,
      }),
    ).resolves.toEqual({ allowed: true });
    const refused = await checkOrgBudget(sql, {
      ...SUBJECT,
      prospectiveCostCents: 5,
      prospectiveRequests: 1,
    });
    expect(refused.allowed).toBe(false);
    expect(refused.code).toBe('COST_LIMIT');
  });
});
