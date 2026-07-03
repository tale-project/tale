import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BudgetConfig } from '../../lib/shared/schemas/governance';

// `checkBudget` reads the budgets config through `readPolicyConfig` (mocked) and
// aggregates usage from `usageLedger` via several indexes (mocked db). This test
// exercises the full DB code path for the per-API-key budget scope — the
// decisive isolation the customer reported missing: key A blocked past its cap,
// key B (same user) still allowed, and org/user budgets unaffected.

const mockReadPolicyConfig = vi.fn<() => Promise<BudgetConfig | null>>();

vi.mock('./helpers', async () => {
  const actual = await vi.importActual<typeof import('./helpers')>('./helpers');
  return {
    ...actual,
    readPolicyConfig: () => mockReadPolicyConfig(),
  };
});

interface LedgerRow {
  totalTokens: number;
  costEstimate: number;
  requestCount: number;
}

// Per-index usage fixtures. `checkBudget` opens a distinct index per scope:
//   by_org_apiKey_period → the key's own usage
//   by_org_user_period   → the user's own usage
//   by_org_period        → org-wide usage
// The mock routes each `withIndex` call to the matching bucket, keyed (for the
// apiKey index) by the requested apiKeyId so two keys read independent usage.
const usage: {
  apiKey: Record<string, LedgerRow[]>;
  user: LedgerRow[];
  team: Record<string, LedgerRow[]>;
  org: LedgerRow[];
} = { apiKey: {}, user: [], team: {}, org: [] };

function asyncRows(rows: LedgerRow[]) {
  return {
    [Symbol.asyncIterator]: () => {
      let i = 0;
      return {
        next: () =>
          i < rows.length
            ? Promise.resolve({ done: false, value: rows[i++] })
            : Promise.resolve({ done: true, value: undefined }),
      };
    },
  };
}

/**
 * Capture the equality constraints the enforcer sets so the apiKey index can
 * return the RIGHT key's rows. The enforcer calls
 * `q.eq('organizationId', …).eq('apiKeyId', id).eq('periodKey', …)` — every eq
 * value on these scope indexes is a string, so the record is typed as such.
 */
function captureEq(): {
  record: Record<string, string | undefined>;
  q: unknown;
} {
  const record: Record<string, string | undefined> = {};
  const q: Record<string, unknown> = {};
  q.eq = (field: string, value: unknown) => {
    record[field] = typeof value === 'string' ? value : undefined;
    return q;
  };
  return { record, q };
}

const mockCtx = {
  db: {
    query: (_table: string) => ({
      withIndex: (indexName: string, fn: (q: unknown) => unknown) => {
        const { record, q } = captureEq();
        fn(q);
        if (indexName === 'by_org_apiKey_period') {
          const id = record.apiKeyId ?? '';
          return asyncRows(usage.apiKey[id] ?? []);
        }
        if (indexName === 'by_org_user_period') {
          return asyncRows(usage.user);
        }
        if (indexName === 'by_org_team_period') {
          const id = record.teamId ?? '';
          return asyncRows(usage.team[id] ?? []);
        }
        if (indexName === 'by_org_period') {
          return asyncRows(usage.org);
        }
        return asyncRows([]);
      },
    }),
  },
};

import { checkBudget } from './budget_enforcement';

function reset() {
  usage.apiKey = {};
  usage.user = [];
  usage.team = {};
  usage.org = [];
}

describe('checkBudget — per-API-key scope (DB path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset();
  });

  it('blocks the capped key past its request limit but allows a different key of the same user', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        {
          scope: 'apiKey',
          apiKeyId: 'key-A',
          period: 'monthly',
          maxRequests: 2,
        },
      ],
    });
    // key-A has already made 2 requests this period → at the cap.
    usage.apiKey['key-A'] = [
      { totalTokens: 0, costEstimate: 0, requestCount: 2 },
    ];

    const blocked = await checkBudget(
      // @ts-expect-error -- mock ctx
      mockCtx,
      'org-1',
      'user-1',
      [],
      'member',
      0,
      0,
      'key-A',
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.code).toBe('REQUEST_LIMIT');
    expect(blocked.reason).toContain('API key');

    // Same user, DIFFERENT key with no matching rule → allowed.
    const allowed = await checkBudget(
      // @ts-expect-error -- mock ctx
      mockCtx,
      'org-1',
      'user-1',
      [],
      'member',
      0,
      0,
      'key-B',
    );
    expect(allowed.allowed).toBe(true);
  });

  it('binds the per-key cap independently of a much higher user cap', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
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
      ],
    });
    // User is far under their $1000 cap, but key-A is at its 5¢ cap.
    usage.user = [{ totalTokens: 0, costEstimate: 10, requestCount: 1 }];
    usage.apiKey['key-A'] = [
      { totalTokens: 0, costEstimate: 5, requestCount: 1 },
    ];

    const result = await checkBudget(
      // @ts-expect-error -- mock ctx
      mockCtx,
      'org-1',
      'user-1',
      [],
      'member',
      0,
      0,
      'key-A',
    );
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('COST_LIMIT');
    expect(result.reason).toContain('API key');
  });

  it('does not apply an apiKey rule to a request that carries no key', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        {
          scope: 'apiKey',
          apiKeyId: 'key-A',
          period: 'monthly',
          maxRequests: 1,
        },
      ],
    });
    usage.apiKey['key-A'] = [
      { totalTokens: 0, costEstimate: 0, requestCount: 99 },
    ];

    // In-app caller (no apiKeyId) → the key rule is irrelevant, request allowed.
    const result = await checkBudget(
      // @ts-expect-error -- mock ctx
      mockCtx,
      'org-1',
      'user-1',
      [],
      'member',
    );
    expect(result.allowed).toBe(true);
  });

  it('still enforces an org-scoped budget (no regression) even with a key present', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [{ scope: 'org', period: 'monthly', maxRequests: 3 }],
    });
    usage.org = [{ totalTokens: 0, costEstimate: 0, requestCount: 3 }];

    const result = await checkBudget(
      // @ts-expect-error -- mock ctx
      mockCtx,
      'org-1',
      'user-1',
      [],
      'member',
      0,
      0,
      'key-A',
    );
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('REQUEST_LIMIT');
    expect(result.reason).toContain('Organization-wide');
  });
});
