// @vitest-environment node

/**
 * The 0.5 usage ledger prices every chat and title turn at booking: the read
 * side (usage metrics, cost budgets, the composer's budget gate) sums the
 * stored column, so a turn booked at 0 is model spend that never existed.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveOrgSlug, resolveProvidersForOrg, getProviderCatalog } =
  vi.hoisted(() => ({
    resolveOrgSlug: vi.fn(),
    resolveProvidersForOrg: vi.fn(),
    getProviderCatalog: vi.fn(),
  }));

vi.mock('../../lib/org-config.ts', () => ({ resolveOrgSlug }));
vi.mock('../../core/lib/providers/org_providers.ts', () => ({
  resolveProvidersForOrg,
}));
vi.mock('../../core/lib/providers/catalog_fetch.ts', () => ({
  getProviderCatalog,
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

import { createPgUsageLedger, estimateTurnCostCents } from './store.ts';

const OPENROUTER = {
  name: 'openrouter',
  catalog: { source: 'openrouter-api' },
};
const PRICED_CATALOG = [
  {
    id: 'z-ai/glm-5.1',
    pricing: { inputCentsPerMillion: 100, outputCentsPerMillion: 200 },
  },
  { id: 'free/model' },
];

/** A tagged-template `sql` that records every statement's bound values. */
function capturingSql(): { sql: Sql; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const tag = (_strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push(values);
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call is exercised by the ledger
  return { sql: tag as unknown as Sql, calls };
}

const ENTRY = {
  organizationId: 'org_ledger',
  userId: 'user_1',
  model: 'z-ai/glm-5.1',
  provider: 'openrouter',
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  totalTokens: 1_500_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveOrgSlug.mockResolvedValue('acme');
  resolveProvidersForOrg.mockReturnValue([OPENROUTER]);
  getProviderCatalog.mockResolvedValue(PRICED_CATALOG);
});

describe('estimateTurnCostCents', () => {
  it("prices the turn from the serving connector's catalog pricing", async () => {
    const { sql } = capturingSql();
    // 1M input at 100 c/M + 0.5M output at 200 c/M.
    await expect(estimateTurnCostCents(sql, ENTRY)).resolves.toBe(200);
    expect(resolveProvidersForOrg).toHaveBeenCalledWith('acme');
    expect(getProviderCatalog).toHaveBeenCalledWith(OPENROUTER);
  });

  it('books 0 for a model the catalog does not price, and for an unknown one', async () => {
    const { sql } = capturingSql();
    await expect(
      estimateTurnCostCents(sql, { ...ENTRY, model: 'free/model' }),
    ).resolves.toBe(0);
    await expect(
      estimateTurnCostCents(sql, { ...ENTRY, model: 'nobody/knows' }),
    ).resolves.toBe(0);
  });

  it('books 0 (never throws) when the catalog cannot be resolved', async () => {
    const { sql } = capturingSql();
    getProviderCatalog.mockRejectedValue(new Error('listing offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(estimateTurnCostCents(sql, ENTRY)).resolves.toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('createPgUsageLedger', () => {
  it('writes the priced cost into the period buckets, not 0', async () => {
    const { sql, calls } = capturingSql();
    await createPgUsageLedger(sql).record(ENTRY);
    // One usage_events insert + three period-bucket upserts, every bucket
    // carrying the priced cost among its bound values.
    expect(calls.length).toBe(4);
    const buckets = calls.slice(1);
    for (const values of buckets) {
      expect(values).toContain(200);
    }
  });
});
