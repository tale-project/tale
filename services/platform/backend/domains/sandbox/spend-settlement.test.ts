/**
 * The PG side of the settlement: booking a spend stamps the op row and
 * increments the org usage ledger ONCE, under the run's starter and agent
 * (task runs) or the automation run's starter (workflow ops); a replay
 * finds the fact closed and books nothing; the reconcile sweep selects only
 * finalized ops whose settlement is still open past the grace. The gateway
 * client is replaced; the SQL shapes are asserted on a scripted `sql`.
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
  reconcilePendingSessionOpKeys,
  reconcileSessionOpKey,
  settleSessionOpSpend,
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('settleSessionOpSpend', () => {
  it('stamps the op and books the ledger under the task run’s starter and agent', async () => {
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
        rows: [{ startedBy: 'user-1', agentName: 'Alice' }],
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
      agentSlug: 'Alice',
      costEstimateCents: 25,
      inputTokens: 1_200,
      outputTokens: 300,
      provider: 'openai',
      model: 'gpt-5',
    });
  });

  it('attributes a workflow op to the automation run that owns its session', async () => {
    const { sql } = fakeSql([
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
        match: 'JOIN app.automation_runs ar',
        rows: [{ startedBy: 'user-2', name: 'invoices/monthly' }],
      },
    ]);

    await settleSessionOpSpend(sql, {
      sessionId: 'wf-run-1',
      execId: 'exec-2',
      spentCents: 4.5,
    });

    expect(ledger.incrementUsageLedger.mock.calls[0]?.[1]).toMatchObject({
      userId: 'user-2',
      agentSlug: 'invoices/monthly',
      costEstimateCents: 4.5,
      provider: 'deepseek',
      model: 'deepseek-v4',
    });
  });

  it('books nothing twice: a replay finds the fact closed', async () => {
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
