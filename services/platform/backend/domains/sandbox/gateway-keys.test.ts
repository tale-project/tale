/**
 * The election itself is the SQL `WHERE revoked_at_ms IS NULL` flip, so it is
 * the integration harness that proves it against a real Postgres. What these
 * cover is the glue around it, where the consequences are just as sharp:
 *
 *  - a key that minted for a turn has that turn's spend READ AND BOOKED
 *    before the delete — a deleted key answers 404 and its figure is gone;
 *  - a gateway failure must NOT throw. An unreachable gateway wedging a
 *    teardown is worse than a leaked key, so the failure is counted, logged
 *    loudly, and the claim handed back so the next pass retries it;
 *  - an exec-scoped teardown must NOT clear the session row's parked key —
 *    that key belongs to the standing session, and a sibling turn is still
 *    spending against it;
 *  - the same key id arriving from both the token table and the session row
 *    must be revoked once.
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

const { revokeSessionGatewayKeys } = await import('./gateway-keys.ts');

interface Statement {
  text: string;
  values: unknown[];
}

/**
 * A tagged-template stand-in for `postgres`: answers by a substring of the
 * statement (the first matching answer wins; a `once` answer is consumed)
 * and records every statement, so a test can assert what ran and in which
 * order.
 */
function fakeSql(
  answers: Array<{ match: string; rows: unknown[]; once?: boolean }>,
) {
  const statements: Statement[] = [];
  const pending = [...answers];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    const index = pending.findIndex((answer) => text.includes(answer.match));
    if (index === -1) return Promise.resolve([]);
    const hit = pending[index];
    if (hit?.once === true) pending.splice(index, 1);
    return Promise.resolve(hit?.rows ?? []);
  };
  const sql = Object.assign(run, {
    begin: async (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
  });
  return { sql: sql as never, statements };
}

const ARGS = { organizationId: 'org-1', sessionId: 'sess-1' };
const CLAIM = 'UPDATE app.sandbox_session_tokens SET revoked_at_ms = ?';
const PARKED = 'UPDATE app.sandbox_sessions SET llm_gateway_key_id = NULL';
const OP_FOR_KEY = 'WHERE session_id = ? AND minted_key_id = ?';
const SPEND_STAMP = 'UPDATE app.sandbox_session_ops SET spent_cents';

/** The op behind a key, with its settlement facts. */
const turn = (execId: string, spendSettled = false) => ({
  execId,
  spendSettled,
  keyRevoked: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  gateway.readVirtualKeySpend.mockResolvedValue({ status: 'ok', cents: 40 });
  gateway.revokeVirtualKey.mockResolvedValue(undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('revokeSessionGatewayKeys', () => {
  it('reads and books a turn key’s spend BEFORE deleting it', async () => {
    const { sql, statements } = fakeSql([
      { match: CLAIM, rows: [{ keyId: 'k1' }] },
      { match: OP_FOR_KEY, rows: [turn('exec-1')] },
      {
        match: SPEND_STAMP,
        rows: [{ organizationId: 'org-1', kind: 'task-agent', modelRef: null }],
      },
      {
        match: 'FROM app.project_agent_runs r',
        rows: [{ startedBy: 'user-1', agentName: 'Alice' }],
      },
    ]);

    const out = await revokeSessionGatewayKeys(sql, ARGS);

    expect(out).toEqual({ revoked: 1, failed: 0 });
    expect(gateway.readVirtualKeySpend).toHaveBeenCalledWith('k1');
    expect(gateway.revokeVirtualKey).toHaveBeenCalledWith('k1');
    // Spend booked (op stamp + ledger) before the delete's revoke stamp.
    const stamp = statements.findIndex((s) => s.text.includes(SPEND_STAMP));
    const revokeMark = statements.findIndex((s) =>
      s.text.includes('SET key_revoked_at_ms'),
    );
    expect(stamp).toBeGreaterThan(-1);
    expect(revokeMark).toBeGreaterThan(stamp);
    expect(ledger.incrementUsageLedger).toHaveBeenCalledTimes(1);
    expect(ledger.incrementUsageLedger.mock.calls[0]?.[1]).toMatchObject({
      costEstimateCents: 40,
      userId: 'user-1',
    });
  });

  it('deletes a parked session key with no op behind it without a spend read', async () => {
    const { sql } = fakeSql([{ match: PARKED, rows: [{ keyId: 'k2' }] }]);

    const out = await revokeSessionGatewayKeys(sql, ARGS);

    expect(out).toEqual({ revoked: 1, failed: 0 });
    expect(gateway.readVirtualKeySpend).not.toHaveBeenCalled();
    expect(gateway.revokeVirtualKey).toHaveBeenCalledWith('k2');
  });

  it('revokes a key claimed from both places only once', async () => {
    const { sql } = fakeSql([
      { match: CLAIM, rows: [{ keyId: 'k1' }] },
      { match: PARKED, rows: [{ keyId: 'k1' }] },
    ]);

    const out = await revokeSessionGatewayKeys(sql, ARGS);

    expect(out).toEqual({ revoked: 1, failed: 0 });
    expect(gateway.revokeVirtualKey).toHaveBeenCalledTimes(1);
  });

  it('leaves the session row alone for an exec-scoped teardown', async () => {
    const { sql, statements } = fakeSql([
      { match: CLAIM, rows: [{ keyId: 'k1' }] },
    ]);

    const out = await revokeSessionGatewayKeys(sql, {
      ...ARGS,
      execId: 'exec-9',
    });

    expect(out).toEqual({ revoked: 1, failed: 0 });
    // The `sandbox_sessions` clear must not run — a sibling turn on the
    // standing session still holds that key.
    expect(statements.some((s) => s.text.includes(PARKED))).toBe(false);
  });

  it('skips the gateway entirely when nothing was claimed', async () => {
    const { sql } = fakeSql([]);

    const out = await revokeSessionGatewayKeys(sql, ARGS);

    expect(out).toEqual({ revoked: 0, failed: 0 });
    expect(gateway.readVirtualKeySpend).not.toHaveBeenCalled();
    expect(gateway.revokeVirtualKey).not.toHaveBeenCalled();
  });

  it('never throws when the delete fails — counts it, says the key is live, and hands the claim back', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    gateway.revokeVirtualKey.mockRejectedValueOnce(new Error('gateway down'));
    const { sql, statements } = fakeSql([
      { match: CLAIM, rows: [{ keyId: 'k1' }] },
      { match: OP_FOR_KEY, rows: [turn('exec-1', true)] },
    ]);

    const out = await revokeSessionGatewayKeys(sql, ARGS);

    // Counted, not thrown: an unreachable gateway must not wedge teardown.
    expect(out).toEqual({ revoked: 0, failed: 1 });
    // console.error, not warn — the key stays spendable until a later pass
    // settles it, so this has to be loud.
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('is still live');
    // The claim is handed back — only this pass's own flip.
    const handback = statements.find((s) =>
      s.text.includes('SET revoked_at_ms = NULL'),
    );
    expect(handback?.text).toContain('AND revoked_at_ms = ?');
    expect(handback?.values).toContain('k1');
    error.mockRestore();
  });

  it('keeps the key when its spend cannot be read, and retries later', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    gateway.readVirtualKeySpend.mockResolvedValueOnce({
      status: 'unavailable',
    });
    const { sql, statements } = fakeSql([
      { match: CLAIM, rows: [{ keyId: 'k1' }] },
      { match: OP_FOR_KEY, rows: [turn('exec-1')] },
    ]);

    const out = await revokeSessionGatewayKeys(sql, ARGS);

    expect(out).toEqual({ revoked: 0, failed: 1 });
    // No delete before the spend is known — the figure would be lost.
    expect(gateway.revokeVirtualKey).not.toHaveBeenCalled();
    expect(
      statements.some((s) => s.text.includes('SET revoked_at_ms = NULL')),
    ).toBe(true);
    error.mockRestore();
  });

  it('keeps revoking the remaining keys after one fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    gateway.revokeVirtualKey.mockRejectedValueOnce(new Error('gateway down'));
    const { sql } = fakeSql([
      {
        match: CLAIM,
        rows: [{ keyId: 'k1' }, { keyId: 'k2' }, { keyId: 'k3' }],
      },
    ]);

    const out = await revokeSessionGatewayKeys(sql, ARGS);

    expect(out).toEqual({ revoked: 2, failed: 1 });
    expect(gateway.revokeVirtualKey).toHaveBeenCalledTimes(3);
    error.mockRestore();
  });
});
