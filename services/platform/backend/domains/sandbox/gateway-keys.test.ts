/**
 * The election itself is the SQL `WHERE revoked_at_ms IS NULL` flip, so it is
 * the integration harness that proves it against a real Postgres. What these
 * cover is the glue around it, where the consequences are just as sharp:
 *
 *  - a gateway failure must NOT throw. An unreachable gateway wedging a
 *    teardown is worse than a leaked key, so the failure is counted and
 *    logged loudly instead.
 *  - an exec-scoped teardown must NOT clear the session row's parked key —
 *    that key belongs to the standing session, and a sibling turn is still
 *    spending against it.
 *  - the same key id arriving from both the token table and the session row
 *    must be revoked once.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { revokeVirtualKey } = vi.hoisted(() => ({ revokeVirtualKey: vi.fn() }));

vi.mock('../../core/node_only/sandbox/llm_gateway_admin.ts', () => ({
  revokeVirtualKey,
}));

const { revokeSessionGatewayKeys } = await import('./gateway-keys.ts');

/**
 * A tagged-template stand-in for `postgres`: answers each query with the
 * next queued result and records how many ran, so a test can assert that
 * the session-row statement did not.
 */
function fakeSql(results: unknown[][]) {
  const queries: string[] = [];
  const sql = (strings: TemplateStringsArray) => {
    queries.push(strings.join('?'));
    return Promise.resolve(results[queries.length - 1] ?? []);
  };
  return { sql: sql as never, queries };
}

const ARGS = { organizationId: 'org-1', sessionId: 'sess-1' };

describe('revokeSessionGatewayKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    revokeVirtualKey.mockResolvedValue(undefined);
  });

  it('revokes a claimed token key and the key parked on the session row', async () => {
    const { sql } = fakeSql([[{ keyId: 'k1' }], [{ keyId: 'k2' }]]);

    const out = await revokeSessionGatewayKeys(sql, ARGS);

    expect(out).toEqual({ revoked: 2, failed: 0 });
    expect(
      revokeVirtualKey.mock.calls
        .map(([id]) => id as string)
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(['k1', 'k2']);
  });

  it('revokes a key claimed from both places only once', async () => {
    const { sql } = fakeSql([[{ keyId: 'k1' }], [{ keyId: 'k1' }]]);

    const out = await revokeSessionGatewayKeys(sql, ARGS);

    expect(out).toEqual({ revoked: 1, failed: 0 });
    expect(revokeVirtualKey).toHaveBeenCalledTimes(1);
  });

  it('leaves the session row alone for an exec-scoped teardown', async () => {
    const { sql, queries } = fakeSql([[{ keyId: 'k1' }]]);

    const out = await revokeSessionGatewayKeys(sql, {
      ...ARGS,
      execId: 'exec-9',
    });

    expect(out).toEqual({ revoked: 1, failed: 0 });
    // One statement only: the token claim. The `sandbox_sessions` clear must
    // not run — a sibling turn on the standing session still holds that key.
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('sandbox_session_tokens');
    expect(queries.join('\n')).not.toContain('UPDATE app.sandbox_sessions');
  });

  it('skips the gateway entirely when nothing was claimed', async () => {
    const { sql } = fakeSql([[], []]);

    const out = await revokeSessionGatewayKeys(sql, ARGS);

    expect(out).toEqual({ revoked: 0, failed: 0 });
    expect(revokeVirtualKey).not.toHaveBeenCalled();
  });

  it('never throws when the gateway fails, and says the key leaked', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    revokeVirtualKey.mockRejectedValueOnce(new Error('gateway down'));
    const { sql } = fakeSql([[{ keyId: 'k1' }, { keyId: 'k2' }], []]);

    const out = await revokeSessionGatewayKeys(sql, ARGS);

    // Counted, not thrown: an unreachable gateway must not wedge teardown.
    expect(out).toEqual({ revoked: 1, failed: 1 });
    // console.error, not warn — the key stays spendable until an operator
    // deletes it by hand, so this has to be loud.
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('LEAKED gateway key');
    error.mockRestore();
  });

  it('keeps revoking the remaining keys after one fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    revokeVirtualKey.mockRejectedValueOnce(new Error('gateway down'));
    const { sql } = fakeSql([
      [{ keyId: 'k1' }, { keyId: 'k2' }, { keyId: 'k3' }],
      [],
    ]);

    const out = await revokeSessionGatewayKeys(sql, ARGS);

    expect(out).toEqual({ revoked: 2, failed: 1 });
    expect(revokeVirtualKey).toHaveBeenCalledTimes(3);
    error.mockRestore();
  });

  it('ignores token rows that minted no gateway key', async () => {
    const { sql } = fakeSql([[{ keyId: null }, { keyId: 'k1' }], []]);

    const out = await revokeSessionGatewayKeys(sql, ARGS);

    expect(out).toEqual({ revoked: 1, failed: 0 });
    expect(revokeVirtualKey).toHaveBeenCalledExactlyOnceWith('k1');
  });
});
