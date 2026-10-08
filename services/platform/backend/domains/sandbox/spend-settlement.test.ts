/**
 * The PG side of the settlement: booking a spend stamps the op row and
 * increments the org usage ledger ONCE, under the run's billing subject —
 * the person the starter names by bare id and the agent's id (task runs),
 * the person or the automation sentinel plus the key (workflow ops); a
 * replay finds the fact closed and books nothing; the reconcile sweep
 * selects only finalized ops whose settlement is still open past the grace.
 * The gateway client is replaced; the SQL shapes are asserted on a scripted
 * `sql`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const gateway = vi.hoisted(() => ({
  readVirtualKeySpend: vi.fn(),
  revokeVirtualKey: vi.fn(),
}));
const ledger = vi.hoisted(() => ({ incrementUsageLedger: vi.fn() }));

vi.mock('../../core/node_only/sandbox/llm_gateway_admin.ts', () => gateway);
vi.mock('../governance/service.ts', () => ledger);
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

const {
  adjustSpendReading,
  reconcilePendingSessionOpKeys,
  reconcileSessionOpKey,
  settleCostFreeTurn,
  settleSessionOpSpend,
  ZERO_READING_GRACE_MS,
} = await import('./spend-settlement.ts');

interface Statement {
  text: string;
  values: unknown[];
}

/** A scripted `postgres` stand-in with `begin` running the callback on the
 * same fake; answers are keyed by a substring of the statement. */
function fakeSql(answers: Array<{ match: string; rows: unknown[] }>) {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    const hit = answers.find((answer) => text.includes(answer.match));
    return Promise.resolve(hit?.rows ?? []);
  };
  const sql = Object.assign(run, {
    begin: async (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
  });
  return { sql: sql as never, statements };
}

/** A workflow session's owner: the automation run it executes. */
const WORKFLOW_SESSION = {
  match: 'FROM app.sandbox_sessions s',
  rows: [{ runId: 'run-1' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('settleSessionOpSpend', () => {
  it('stamps the op and books the ledger under the task run’s starter and agent [SBX-R14]', async () => {
    const { sql, statements } = fakeSql([
      {
        match: 'UPDATE app.sandbox_session_ops SET spent_cents',
        rows: [
          {
            organizationId: 'org-1',
            kind: 'task-agent',
            modelRef: 'openai/openai/gpt-5',
          },
        ],
      },
      {
        match: 'FROM app.project_agent_runs r',
        rows: [{ startedBy: 'user-1', agentId: 'agent-alice' }],
      },
    ]);

    const outcome = await settleSessionOpSpend(sql, {
      sessionId: 'pa-alice',
      execId: 'exec-1',
      spentCents: 25,
      usage: { inputTokens: 1_200, outputTokens: 300 },
    });

    expect(outcome).toBe('settled');
    const stamp = statements.find((s) =>
      s.text.includes('UPDATE app.sandbox_session_ops SET spent_cents'),
    );
    // The stamp is the idempotency gate.
    expect(stamp?.text).toContain('AND spend_settled_at_ms IS NULL');
    expect(ledger.incrementUsageLedger).toHaveBeenCalledTimes(1);
    expect(ledger.incrementUsageLedger.mock.calls[0]?.[1]).toMatchObject({
      organizationId: 'org-1',
      userId: 'user-1',
      agentSlug: 'agent-alice',
      costEstimateCents: 25,
      inputTokens: 1_200,
      outputTokens: 300,
      provider: 'openai',
      model: 'gpt-5',
    });
  });

  it('books an agent’s turn to the project its run is in [GOV-R14]', async () => {
    const { sql } = fakeSql([
      {
        match: 'UPDATE app.sandbox_session_ops SET spent_cents',
        rows: [
          {
            organizationId: 'org-1',
            kind: 'task-agent',
            modelRef: 'openai/openai/gpt-5',
          },
        ],
      },
      {
        match: 'FROM app.project_agent_runs r',
        rows: [
          {
            startedBy: 'trigger:schedule-1',
            agentId: 'agent-alice',
            projectId: 'project-1',
          },
        ],
      },
    ]);
    await settleSessionOpSpend(sql, {
      sessionId: 'pa-alice',
      execId: 'exec-2',
      spentCents: 25,
      usage: { inputTokens: 1_200, outputTokens: 300 },
    });
    expect(ledger.incrementUsageLedger.mock.calls[0]?.[1]).toMatchObject({
      userId: '__automation__',
      projectIds: ['project-1'],
      costEstimateCents: 25,
    });
  });

  it('attributes a workflow op to the automation run that owns its session [SBX-R14]', async () => {
    const { sql } = fakeSql([
      WORKFLOW_SESSION,
      {
        match: 'UPDATE app.sandbox_session_ops SET spent_cents',
        rows: [
          {
            organizationId: 'org-1',
            kind: 'workflow-agent',
            modelRef: 'deepseek/org-1__deepseek__deepseek-v4/deepseek-v4',
          },
        ],
      },
      {
        match: 'FROM app.automation_runs ar WHERE',
        rows: [
          {
            startedBy: 'user:user-2',
            name: 'invoices/monthly',
            apiKeyId: null,
          },
        ],
      },
    ]);

    await settleSessionOpSpend(sql, {
      sessionId: 'wf-run-1',
      execId: 'exec-2',
      spentCents: 4.5,
    });

    // The door prefix never reaches the ledger — the person does.
    expect(ledger.incrementUsageLedger.mock.calls[0]?.[1]).toMatchObject({
      userId: 'user-2',
      agentSlug: 'invoices/monthly',
      costEstimateCents: 4.5,
      provider: 'deepseek',
      model: 'deepseek-v4',
    });
    expect(ledger.incrementUsageLedger.mock.calls[0]?.[1]).not.toHaveProperty(
      'apiKeyId',
    );
  });

  it('books a keyed start to the person and the key [SBX-R14]', async () => {
    const { sql } = fakeSql([
      WORKFLOW_SESSION,
      {
        match: 'UPDATE app.sandbox_session_ops SET spent_cents',
        rows: [
          { organizationId: 'org-1', kind: 'workflow-agent', modelRef: null },
        ],
      },
      {
        match: 'FROM app.automation_runs ar WHERE',
        rows: [
          {
            startedBy: 'api-key:user-3',
            name: 'invoices/monthly',
            apiKeyId: 'key-1',
          },
        ],
      },
    ]);

    await settleSessionOpSpend(sql, {
      sessionId: 'wf-run-2',
      execId: 'exec-3',
      spentCents: 2,
    });

    expect(ledger.incrementUsageLedger.mock.calls[0]?.[1]).toMatchObject({
      userId: 'user-3',
      apiKeyId: 'key-1',
      agentSlug: 'invoices/monthly',
      costEstimateCents: 2,
    });
  });

  it('books a trigger-started run under the automation sentinel [SBX-R14]', async () => {
    const { sql } = fakeSql([
      WORKFLOW_SESSION,
      {
        match: 'UPDATE app.sandbox_session_ops SET spent_cents',
        rows: [
          { organizationId: 'org-1', kind: 'workflow-agent', modelRef: null },
        ],
      },
      {
        match: 'FROM app.automation_runs ar WHERE',
        rows: [
          {
            startedBy: 'trigger:t-1',
            name: 'invoices/monthly',
            apiKeyId: null,
          },
        ],
      },
    ]);

    await settleSessionOpSpend(sql, {
      sessionId: 'wf-run-3',
      execId: 'exec-4',
      spentCents: 3,
    });

    expect(ledger.incrementUsageLedger.mock.calls[0]?.[1]).toMatchObject({
      userId: '__automation__',
      agentSlug: 'invoices/monthly',
      costEstimateCents: 3,
    });
  });

  it('books nothing twice: a replay finds the fact closed [SBX-R15]', async () => {
    const { sql } = fakeSql([
      // The guarded UPDATE matches no row; the existence probe finds the op.
      { match: 'SELECT id FROM app.sandbox_session_ops', rows: [{ id: 'op' }] },
    ]);

    const outcome = await settleSessionOpSpend(sql, {
      sessionId: 'pa-alice',
      execId: 'exec-1',
      spentCents: 25,
    });

    expect(outcome).toBe('already_settled');
    expect(ledger.incrementUsageLedger).not.toHaveBeenCalled();
  });

  it('closes the fact without a ledger row when the key was gone (no figure)', async () => {
    const { sql } = fakeSql([
      {
        match: 'UPDATE app.sandbox_session_ops SET spent_cents',
        rows: [{ organizationId: 'org-1', kind: 'task-agent', modelRef: null }],
      },
    ]);

    const outcome = await settleSessionOpSpend(sql, {
      sessionId: 'pa-alice',
      execId: 'exec-1',
      spentCents: null,
    });

    expect(outcome).toBe('settled');
    expect(ledger.incrementUsageLedger).not.toHaveBeenCalled();
  });
});

describe('reconcileSessionOpKey', () => {
  it('runs the settlement over the op’s open facts', async () => {
    gateway.readVirtualKeySpend.mockResolvedValue({ status: 'ok', cents: 12 });
    gateway.revokeVirtualKey.mockResolvedValue(undefined);
    const { sql, statements } = fakeSql([
      {
        match: 'SELECT org_id AS "organizationId", kind, minted_key_id',
        rows: [
          {
            organizationId: 'org-1',
            kind: 'task-agent',
            mintedKeyId: 'vk-1',
            finalizedAt: 1,
            spendSettledAt: null,
            keyRevokedAt: null,
          },
        ],
      },
      {
        match: 'UPDATE app.sandbox_session_ops SET spent_cents',
        rows: [{ organizationId: 'org-1', kind: 'task-agent', modelRef: null }],
      },
      {
        match: 'FROM app.project_agent_runs r',
        rows: [{ startedBy: 'user-1', agentName: 'Alice' }],
      },
    ]);

    const outcome = await reconcileSessionOpKey(sql, {
      organizationId: 'org-1',
      sessionId: 'pa-alice',
      execId: 'exec-1',
    });

    expect(outcome).toEqual({
      spendSettled: true,
      keyRevoked: true,
      spentCents: 12,
    });
    expect(gateway.revokeVirtualKey).toHaveBeenCalledWith('vk-1');
    // Both facts stamped: the token row and the op row.
    expect(
      statements.some((s) =>
        s.text.includes('UPDATE app.sandbox_session_tokens SET revoked_at_ms'),
      ),
    ).toBe(true);
    expect(
      statements.some((s) =>
        s.text.includes('UPDATE app.sandbox_session_ops SET key_revoked_at_ms'),
      ),
    ).toBe(true);
  });

  it('closes the facts of a keyless op without touching the gateway', async () => {
    const { sql, statements } = fakeSql([
      {
        match: 'SELECT org_id AS "organizationId", kind, minted_key_id',
        rows: [
          {
            organizationId: 'org-1',
            kind: 'task-agent',
            mintedKeyId: null,
            budgetCents: 500,
            finalizedAt: 1,
            spendSettledAt: null,
            keyRevokedAt: null,
          },
        ],
      },
    ]);

    const outcome = await reconcileSessionOpKey(sql, {
      organizationId: 'org-1',
      sessionId: 'pa-alice',
      execId: 'exec-1',
    });

    expect(outcome).toEqual({ spendSettled: true, keyRevoked: true });
    expect(gateway.readVirtualKeySpend).not.toHaveBeenCalled();
    expect(
      statements.some((s) =>
        s.text.includes(
          'UPDATE app.sandbox_session_ops SET spend_settled_at_ms',
        ),
      ),
    ).toBe(true);
    // A gateway start that died before its mint spent nothing.
    expect(ledger.incrementUsageLedger).not.toHaveBeenCalled();
  });

  it('books a subscription turn that ended without its release as one request at no cost [GOV-R16]', async () => {
    const { sql } = fakeSql([
      {
        match: 'SELECT org_id AS "organizationId", kind, minted_key_id',
        rows: [
          {
            organizationId: 'org-1',
            kind: 'task-agent',
            mintedKeyId: null,
            budgetCents: 0,
            finalizedAt: 1,
            spendSettledAt: null,
            keyRevokedAt: null,
          },
        ],
      },
      {
        match: 'SELECT budget_cents::float8 AS "budgetCents"',
        rows: [{ budgetCents: 0, mintedKeyId: null, spendSettledAt: null }],
      },
      {
        match: 'UPDATE app.sandbox_session_ops SET spent_cents',
        rows: [
          {
            organizationId: 'org-1',
            kind: 'task-agent',
            modelRef: 'anthropic/claude-sonnet-4-5',
            inputTokens: null,
            outputTokens: null,
          },
        ],
      },
      {
        match: 'FROM app.project_agent_runs r',
        rows: [{ startedBy: 'user-1', agentId: 'agent-alice' }],
      },
    ]);

    await expect(
      reconcileSessionOpKey(sql, {
        organizationId: 'org-1',
        sessionId: 'pa-alice',
        execId: 'exec-1',
      }),
    ).resolves.toEqual({ spendSettled: true, keyRevoked: true });

    expect(ledger.incrementUsageLedger).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        userId: 'user-1',
        agentSlug: 'agent-alice',
        costEstimateCents: 0,
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
      }),
    );
  });

  it('refuses an op that belongs to another organization', async () => {
    const { sql } = fakeSql([
      {
        match: 'SELECT org_id AS "organizationId", kind, minted_key_id',
        rows: [
          {
            organizationId: 'org-2',
            kind: 'task-agent',
            mintedKeyId: 'vk-1',
            finalizedAt: 1,
            spendSettledAt: null,
            keyRevokedAt: null,
          },
        ],
      },
    ]);

    await expect(
      reconcileSessionOpKey(sql, {
        organizationId: 'org-1',
        sessionId: 'pa-alice',
        execId: 'exec-1',
      }),
    ).resolves.toBeNull();
    expect(gateway.readVirtualKeySpend).not.toHaveBeenCalled();
  });
});

describe('reconcilePendingSessionOpKeys', () => {
  it('walks only finalized ops with an open settlement past the grace, oldest first', async () => {
    gateway.readVirtualKeySpend.mockResolvedValue({ status: 'unavailable' });
    const { sql, statements } = fakeSql([
      {
        match: 'WHERE finalized_at_ms IS NOT NULL AND finalized_at_ms <',
        rows: [
          { organizationId: 'org-1', sessionId: 'pa-alice', execId: 'exec-1' },
        ],
      },
      {
        match: 'SELECT org_id AS "organizationId", kind, minted_key_id',
        rows: [
          {
            organizationId: 'org-1',
            kind: 'task-agent',
            mintedKeyId: 'vk-1',
            finalizedAt: 1,
            spendSettledAt: null,
            keyRevokedAt: null,
          },
        ],
      },
    ]);

    const result = await reconcilePendingSessionOpKeys(sql, {
      batch: 25,
      now: 1_000_000,
    });

    expect(result).toEqual({ scanned: 1, settled: 0, pending: 1 });
    const select = statements.find((s) =>
      s.text.includes(
        'WHERE finalized_at_ms IS NOT NULL AND finalized_at_ms <',
      ),
    );
    expect(select?.text).toContain(
      '(spend_settled_at_ms IS NULL OR (minted_key_id IS NOT NULL AND key_revoked_at_ms IS NULL))',
    );
    expect(select?.text).toContain('ORDER BY finalized_at_ms ASC');
    // The grace: now − 2 min.
    expect(select?.values).toContain(1_000_000 - 120_000);
    expect(select?.values).toContain(25);
    // An unavailable gateway deletes nothing.
    expect(gateway.revokeVirtualKey).not.toHaveBeenCalled();
  });
});

describe('adjustSpendReading — the op’s own facts beside the gateway’s figure', () => {
  const NONE = {
    settleAfterMs: null,
    floorCents: null,
    expectedCents: null,
    finalizedAtMs: null,
  };
  const NOW = 1_700_000_000_000;

  it('passes a reading through when the op carries no facts', () => {
    expect(adjustSpendReading({ status: 'ok', cents: 4 }, NONE, NOW)).toEqual({
      status: 'ok',
      cents: 4,
    });
    expect(adjustSpendReading({ status: 'gone' }, NONE, NOW)).toEqual({
      status: 'gone',
    });
  });

  it('reads nothing before a whole answer’s lifetime has passed', () => {
    expect(
      adjustSpendReading(
        { status: 'ok', cents: 0 },
        { ...NONE, settleAfterMs: NOW + 1 },
        NOW,
      ),
    ).toEqual({ status: 'unavailable' });
  });

  it('raises a reading to the floor a stream that ended early counted', () => {
    const facts = { ...NONE, floorCents: 7.5 };
    expect(adjustSpendReading({ status: 'ok', cents: 0 }, facts, NOW)).toEqual({
      status: 'ok',
      cents: 7.5,
    });
    expect(adjustSpendReading({ status: 'ok', cents: 9 }, facts, NOW)).toEqual({
      status: 'ok',
      cents: 9,
    });
  });

  it('takes a zero for "not booked yet" while a priced answer is inside the grace, then books the relay’s figure', () => {
    const facts = { ...NONE, expectedCents: 2, finalizedAtMs: NOW - 1_000 };
    expect(adjustSpendReading({ status: 'ok', cents: 0 }, facts, NOW)).toEqual({
      status: 'unavailable',
    });
    expect(
      adjustSpendReading(
        { status: 'ok', cents: 0 },
        facts,
        NOW + ZERO_READING_GRACE_MS,
      ),
    ).toEqual({ status: 'ok', cents: 2 });
    // A figure the gateway did book is the figure.
    expect(
      adjustSpendReading({ status: 'ok', cents: 1.5 }, facts, NOW),
    ).toEqual({ status: 'ok', cents: 1.5 });
  });

  it('books what the relay saw for a key the gateway lost', () => {
    expect(
      adjustSpendReading({ status: 'gone' }, { ...NONE, floorCents: 3 }, NOW),
    ).toEqual({ status: 'ok', cents: 3 });
  });
});

describe('reconcileSessionOpKey — a model-endpoint request', () => {
  it('leaves a whole answer’s key alone until its spend may be read', async () => {
    const { sql } = fakeSql([
      {
        match: 'FROM app.sandbox_session_ops WHERE session_id',
        rows: [
          {
            organizationId: 'org-1',
            kind: 'model-api',
            mintedKeyId: 'vk-1',
            finalizedAt: Date.now(),
            spendSettledAt: null,
            keyRevokedAt: null,
            settleAfter: Date.now() + 60_000,
            floorCents: null,
            expectedCents: null,
          },
        ],
      },
    ]);
    await expect(
      reconcileSessionOpKey(sql, {
        organizationId: 'org-1',
        sessionId: 'model-api:key-1',
        execId: 'req-1',
      }),
    ).resolves.toEqual({ spendSettled: false, keyRevoked: false });
    expect(gateway.readVirtualKeySpend).not.toHaveBeenCalled();
    expect(gateway.revokeVirtualKey).not.toHaveBeenCalled();
  });

  it('books the token counts the op row carries when the caller has none', async () => {
    const { sql } = fakeSql([
      {
        match: 'UPDATE app.sandbox_session_ops SET spent_cents',
        rows: [
          {
            organizationId: 'org-1',
            kind: 'model-api',
            modelRef: 'deepseek/org-1__deepseek__x/x',
            inputTokens: 1_200,
            outputTokens: 80,
          },
        ],
      },
      {
        match: 'SELECT user_id AS "userId", agent_slug AS "agentSlug"',
        rows: [
          { userId: 'user-1', agentSlug: '__direct_api__', apiKeyId: 'key-1' },
        ],
      },
    ]);
    await settleSessionOpSpend(sql, {
      sessionId: 'model-api:key-1',
      execId: 'req-1',
      spentCents: 2,
    });
    expect(ledger.incrementUsageLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'user-1',
        apiKeyId: 'key-1',
        agentSlug: '__direct_api__',
        inputTokens: 1_200,
        outputTokens: 80,
        costEstimateCents: 2,
      }),
    );
  });
});

describe('reconcilePendingSessionOpKeys — deferred settlements', () => {
  it('skips an op whose spend may not be read yet', async () => {
    const { sql, statements } = fakeSql([]);
    await reconcilePendingSessionOpKeys(sql, { batch: 10, now: 5_000_000 });
    expect(statements[0]?.text).toContain(
      'AND (settle_after_ms IS NULL OR settle_after_ms <= ?)',
    );
    expect(statements[0]?.values).toContain(5_000_000);
  });
});

describe('settleCostFreeTurn', () => {
  it.each([
    [
      'a gateway turn, which books what its key spent',
      { budgetCents: 500, mintedKeyId: 'vk-1', spendSettledAt: null },
    ],
    [
      'a turn already booked',
      { budgetCents: 0, mintedKeyId: null, spendSettledAt: 1 },
    ],
    [
      'an op that reserved nothing',
      { budgetCents: null, mintedKeyId: null, spendSettledAt: null },
    ],
  ])('books nothing for %s', async (_label, op) => {
    const { sql, statements } = fakeSql([
      { match: 'SELECT budget_cents::float8 AS "budgetCents"', rows: [op] },
    ]);

    await settleCostFreeTurn(sql, { sessionId: 'pa-alice', execId: 'exec-1' });

    expect(statements).toHaveLength(1);
    expect(ledger.incrementUsageLedger).not.toHaveBeenCalled();
  });
});
