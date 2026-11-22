// @vitest-environment node

/**
 * A retired sandbox LLM gateway, end to end through what still asks it
 * something (tale-project/tale#4942): its container is gone and its name no
 * longer resolves. The real gateway client runs here — only the network
 * (fetch, the resolver) and Postgres are replaced — so these hold that
 * nothing waits forever on a gateway that is gone: a turn's settlement, its
 * sweep, a session's teardown and a deleted organization's. A gateway away
 * for a while still keeps its keys for a later attempt.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
const ledger = vi.hoisted(() => ({ incrementUsageLedger: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup }));
vi.mock('../governance/service.ts', () => ledger);
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

const { removeOrganizationFromGateway, revokeVirtualKey } =
  await import('../../core/node_only/sandbox/llm_gateway_admin.ts');
const { isRelayKeyId } =
  await import('../../core/node_only/sandbox/relay_keys.ts');
const { revokeSessionGatewayKeys } = await import('./gateway-keys.ts');
const { reconcilePendingSessionOpKeys, reconcileSessionOpKey } =
  await import('./spend-settlement.ts');
const { retireOrganizationSandboxes } = await import('./workspace-cleanup.ts');

interface Statement {
  text: string;
  values: unknown[];
}

/** A scripted `postgres` stand-in: answers by a substring of the statement
 * and records every one, `begin` running the callback on the same fake. */
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

/** What Node's fetch throws for a name the resolver could not look up. */
function lookupFailure(code: string) {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error(`getaddrinfo ${code} sandbox-llm-gateway`), {
      code,
      syscall: 'getaddrinfo',
      hostname: 'sandbox-llm-gateway',
    }),
  });
}

/** Every call to the gateway fails before an answer, the way `failure`
 * says. */
function gatewayFailsWith(failure: unknown) {
  const fetch = vi.fn(() => Promise.reject(failure));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const OP = { organizationId: 'org-1', sessionId: 'sess-1', execId: 'exec-1' };
const KEY = 'vk-legacy-1';
const SPEND_STAMP = 'UPDATE app.sandbox_session_ops SET spent_cents';
const KEY_STAMP = 'UPDATE app.sandbox_session_ops SET key_revoked_at_ms';

/** A turn that ended a while ago on a key the gateway minted, its two
 * settlement facts still open. */
const OPEN_OP = {
  match: 'AS "finalizedAt"',
  rows: [
    {
      organizationId: 'org-1',
      kind: 'workflow-agent',
      mintedKeyId: KEY,
      finalizedAt: Date.now() - 600_000,
      spendSettledAt: null,
      keyRevokedAt: null,
      settleAfter: null,
      floorCents: null,
      expectedCents: null,
      startedAtMs: Date.now() - 900_000,
      budgetCents: 100,
      reservedTokens: null,
    },
  ],
};
/** The spend stamp's row: what the settlement books under. */
const STAMPED = {
  match: SPEND_STAMP,
  rows: [{ organizationId: 'org-1', kind: 'workflow-agent', modelRef: null }],
};

/** The spawner verbs the organization's teardown uses besides the gateway's,
 * every one answering that it is done; the gateway's two are the real
 * client's, as the deployment wires them. */
function spawnerAgainstTheGateway() {
  return {
    destroy: vi.fn(async () => ({
      destroyed: true,
      busy: false,
      deletion: 'done' as const,
    })),
    inventory: vi.fn(async () => null),
    usage: vi.fn(async () => null),
    teardownOrganization: vi.fn(async () => ({})),
    disconnectDevice: vi.fn(async () => ({})),
    revokeKey: (keyId: string) =>
      isRelayKeyId(keyId) ? Promise.resolve() : revokeVirtualKey(keyId),
    removeOrganizationFromGateway,
    unpin: vi.fn(async () => ({})),
  };
}

const GONE_ORGANIZATION = {
  organizationId: 'org-gone',
  sessionIds: ['sess-gone'],
  gatewayKeyIds: [KEY, 'tr_relay-1'],
  deviceIds: [],
  teardown: true,
};

beforeEach(() => {
  vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', 'pw-test');
  vi.stubEnv('LLM_GATEWAY_ADMIN_PASSWORD', undefined);
  vi.stubEnv('SANDBOX_LLM_GATEWAY_URL', undefined);
  vi.stubEnv('LLM_GATEWAY_URL', undefined);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  lookup.mockReset();
  ledger.incrementUsageLedger.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a retired gateway: its name no longer resolves', () => {
  it("closes a turn's settlement without a figure: the spend is closed, the key counts as revoked [SBX-R15]", async () => {
    gatewayFailsWith(lookupFailure('ENOTFOUND'));
    const { sql, statements } = fakeSql([OPEN_OP, STAMPED]);

    const outcome = await reconcileSessionOpKey(sql, OP);

    expect(outcome).toEqual({ spendSettled: true, keyRevoked: true });
    const stamp = statements.find((s) => s.text.includes(SPEND_STAMP));
    // No figure: the stamp books nothing over what the row holds.
    expect(stamp?.values[0]).toBeNull();
    expect(statements.some((s) => s.text.includes(KEY_STAMP))).toBe(true);
    expect(ledger.incrementUsageLedger).not.toHaveBeenCalled();
  });

  it('lets the sweep close it, so it visits the turn no more', async () => {
    gatewayFailsWith(lookupFailure('ENOTFOUND'));
    const { sql } = fakeSql([
      {
        match: 'ORDER BY finalized_at_ms ASC',
        rows: [OP],
      },
      OPEN_OP,
      STAMPED,
    ]);

    await expect(
      reconcilePendingSessionOpKeys(sql, { batch: 25, now: Date.now() }),
    ).resolves.toEqual({ scanned: 1, settled: 1, pending: 0 });
  });

  it("lets a session's teardown revoke the key, handing no claim back", async () => {
    gatewayFailsWith(lookupFailure('ENOTFOUND'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sql, statements } = fakeSql([
      {
        match: 'UPDATE app.sandbox_session_tokens SET revoked_at_ms = ?',
        rows: [{ keyId: KEY }],
      },
      {
        match: 'WHERE session_id = ? AND minted_key_id = ?',
        rows: [{ execId: 'exec-1', spendSettled: true, keyRevoked: false }],
      },
    ]);

    const out = await revokeSessionGatewayKeys(sql, {
      organizationId: 'org-1',
      sessionId: 'sess-1',
    });

    expect(out).toEqual({ revoked: 1, failed: 0 });
    expect(
      statements.some((s) => s.text.includes('SET revoked_at_ms = NULL')),
    ).toBe(false);
    expect(statements.some((s) => s.text.includes(KEY_STAMP))).toBe(true);
    expect(error).not.toHaveBeenCalled();
  });

  it("lets a deleted organization's teardown finish: its keys and its provider keys have nothing left there [SBX-R13]", async () => {
    const fetch = gatewayFailsWith(lookupFailure('ENOTFOUND'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spawner = spawnerAgainstTheGateway();

    await retireOrganizationSandboxes(GONE_ORGANIZATION, {
      spawner,
      otherSlicesPending: async () => 0,
    });

    // The key revoke and the provider listing tried the gateway once each.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(spawner.destroy).toHaveBeenCalledWith('sess-gone', 'force');
    expect(spawner.teardownOrganization).toHaveBeenCalledWith('org-gone');
    expect(error).not.toHaveBeenCalled();
  });
});

describe('a gateway away for a while keeps what it holds', () => {
  it('leaves both facts of the turn open for a later attempt', async () => {
    gatewayFailsWith(lookupFailure('EAI_AGAIN'));
    const { sql, statements } = fakeSql([OPEN_OP, STAMPED]);

    const outcome = await reconcileSessionOpKey(sql, OP);

    expect(outcome).toEqual({ spendSettled: false, keyRevoked: false });
    expect(statements.some((s) => s.text.includes(SPEND_STAMP))).toBe(false);
    expect(statements.some((s) => s.text.includes(KEY_STAMP))).toBe(false);
  });

  it("fails the organization's teardown, which the queue retries", async () => {
    gatewayFailsWith(lookupFailure('EAI_AGAIN'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const spawner = spawnerAgainstTheGateway();

    await expect(
      retireOrganizationSandboxes(GONE_ORGANIZATION, {
        spawner,
        otherSlicesPending: async () => 0,
      }),
    ).rejects.toThrow('gateway provider keys');
    expect(spawner.teardownOrganization).not.toHaveBeenCalled();
  });
});

describe('a deployment that never ran the gateway: no admin password', () => {
  beforeEach(() => {
    vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', undefined);
  });

  it("finishes a deleted organization's teardown without a word about a gateway [SBX-R13]", async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spawner = spawnerAgainstTheGateway();

    await retireOrganizationSandboxes(
      { ...GONE_ORGANIZATION, gatewayKeyIds: ['tr_relay-1'] },
      { spawner, otherSlicesPending: async () => 0 },
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(spawner.teardownOrganization).toHaveBeenCalledWith('org-gone');
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('closes a key of a restored snapshot once no gateway answers to its name [SBX-R15]', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    lookup.mockRejectedValue(
      Object.assign(new Error('getaddrinfo ENOTFOUND sandbox-llm-gateway'), {
        code: 'ENOTFOUND',
      }),
    );
    const { sql } = fakeSql([OPEN_OP, STAMPED]);

    await expect(reconcileSessionOpKey(sql, OP)).resolves.toEqual({
      spendSettled: true,
      keyRevoked: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
