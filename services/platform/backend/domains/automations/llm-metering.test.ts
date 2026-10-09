import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveAutomationRunAttribution: vi.fn(),
  reserveTurnBudget: vi.fn(),
  reconcileSessionOpKey: vi.fn(),
}));
vi.mock('../sandbox/op-attribution.ts', () => ({
  resolveAutomationRunAttribution: mocks.resolveAutomationRunAttribution,
}));
vi.mock('../sandbox/turn-budget.ts', () => ({
  reserveTurnBudget: mocks.reserveTurnBudget,
}));
vi.mock('../sandbox/spend-settlement.ts', () => ({
  reconcileSessionOpKey: mocks.reconcileSessionOpKey,
}));
const { llmStepOp, reserveLlmStepBudget, recordLlmStepUsage } =
  await import('./llm-metering.ts');

const attempt = {
  nodeId: 'loop[2:3]/model',
  itemIndex: 2,
  pass: 3,
  attempt: 1,
};
const request = {
  organizationId: 'org',
  runId: 'run',
  attempt,
  provider: 'provider',
  model: 'vendor/model',
  reserveCents: 2.5,
  reserveTokens: 8040,
};
const subject = {
  userId: 'user',
  agentSlug: 'automation',
  projectIds: ['a', 'b'],
};
function fakeSql(live = true, duplicate = false) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const query = vi.fn(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ');
      statements.push({ text, values });
      if (text.includes('FROM app.automation_node_attempts'))
        return live ? [{ id: 'attempt' }] : [];
      if (text.includes('SELECT id FROM app.sandbox_session_ops'))
        return duplicate ? [{ id: 'old' }] : [];
      return [];
    },
  );
  return { sql: query as unknown as Sql, query, statements };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveAutomationRunAttribution.mockResolvedValue(subject);
  mocks.reserveTurnBudget.mockImplementation(async (sql, args) => {
    await args.prepareSubject(sql);
    return { allowed: true, budgetCents: 3 };
  });
});

describe('direct LLM attempt reservation', () => {
  it('separates organization, run, nested node, item, pass and retry identities', () => {
    const base = llmStepOp(request);
    const variants = [
      { ...request, organizationId: 'other' },
      { ...request, runId: 'other' },
      ...(['nodeId', 'itemIndex', 'pass', 'attempt'] as const).map((field) =>
        Object.assign({}, request, {
          attempt: Object.assign({}, attempt, {
            [field]: field === 'nodeId' ? 'other' : 9,
          }),
        }),
      ),
    ];
    expect(
      new Set([
        base.execId,
        ...variants.map((value) => llmStepOp(value).execId),
      ]).size,
    ).toBe(7);
    expect(llmStepOp({ ...request })).toEqual(base);
  });
  it('holds the full request through the canonical admission and derives its subject under the lock [GOV-R14]', async () => {
    const { sql, statements } = fakeSql();
    await expect(reserveLlmStepBudget(sql, request)).resolves.toMatchObject({
      allowed: true,
      ...llmStepOp(request),
    });
    expect(mocks.reserveTurnBudget).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        kind: 'automation-llm',
        defaultBudgetCents: 3,
        whole: { prospectiveTokens: 8040 },
        modelRef: 'provider/provider/vendor/model',
        prepareSubject: expect.any(Function),
      }),
    );
    expect(statements[0]?.text).toContain('a.claim_epoch = r.claim_epoch');
    expect(statements[0]?.text).toContain('r.lease_expires_at_ms >');
    expect(mocks.resolveAutomationRunAttribution).toHaveBeenCalledWith(
      sql,
      request,
    );
  });
  it.each([
    [false, false, 'no longer current'],
    [true, true, 'already admitted'],
  ] as const)(
    'refuses stale=%s duplicate=%s before acquiring a hold',
    async (live, duplicate, reason) => {
      const { sql } = fakeSql(live, duplicate);
      await expect(reserveLlmStepBudget(sql, request)).rejects.toThrow(reason);
      expect(mocks.resolveAutomationRunAttribution).not.toHaveBeenCalled();
    },
  );
  it('refuses an unattributable run instead of creating unowned spend', async () => {
    mocks.resolveAutomationRunAttribution.mockResolvedValue(null);
    await expect(reserveLlmStepBudget(fakeSql().sql, request)).rejects.toThrow(
      'no billing subject',
    );
  });
  it('returns a canonical cap refusal unchanged [GOV-R4]', async () => {
    const refusal = { allowed: false, reason: 'project cap' };
    mocks.reserveTurnBudget.mockResolvedValue(refusal);
    await expect(reserveLlmStepBudget(fakeSql().sql, request)).resolves.toEqual(
      refusal,
    );
  });
  it.each([NaN, -1, Infinity])(
    'rejects invalid reservation cost %s',
    async (reserveCents) => {
      await expect(
        reserveLlmStepBudget(fakeSql().sql, { ...request, reserveCents }),
      ).rejects.toThrow('Invalid');
      expect(mocks.reserveTurnBudget).not.toHaveBeenCalled();
    },
  );
});

describe('durable direct LLM terminal facts', () => {
  const op = { organizationId: 'org', ...llmStepOp(request) };
  it('persists reported facts before settlement and keeps the exact op identity', async () => {
    const { sql, statements } = fakeSql();
    await recordLlmStepUsage(sql, {
      ...op,
      usage: { inputTokens: 40, outputTokens: 10, cents: 0.5 },
    });
    expect(statements[0]?.values).toContain(0.5);
    expect(statements[0]?.text).toContain(
      'AND finalized_at_ms IS NULL AND spend_settled_at_ms IS NULL',
    );
    expect(mocks.reconcileSessionOpKey).toHaveBeenCalledWith(
      sql,
      expect.objectContaining(op),
    );
  });
  it('persists unknown as NULL and holds it until the original request deadline', async () => {
    const { sql, statements } = fakeSql();
    await recordLlmStepUsage(sql, { ...op, usage: null });
    expect(statements[0]?.text).toContain('THEN started_at_ms +');
    expect(statements[0]?.values).toContain(null);
    expect(statements[0]?.values).toContain(180000);
  });
  it('does not settle when saving the only terminal facts fails', async () => {
    const { sql, query } = fakeSql();
    query.mockRejectedValueOnce(new Error('offline'));
    await expect(
      recordLlmStepUsage(sql, { ...op, usage: null }),
    ).rejects.toThrow('offline');
    expect(mocks.reconcileSessionOpKey).not.toHaveBeenCalled();
  });
  it('retains persisted facts when the ledger attempt fails', async () => {
    const { sql, statements } = fakeSql();
    mocks.reconcileSessionOpKey.mockRejectedValueOnce(
      new Error('ledger offline'),
    );
    await expect(
      recordLlmStepUsage(sql, {
        ...op,
        usage: { inputTokens: 1, outputTokens: 2, cents: 0.3 },
      }),
    ).rejects.toThrow('ledger offline');
    expect(statements).toHaveLength(1);
  });
});
