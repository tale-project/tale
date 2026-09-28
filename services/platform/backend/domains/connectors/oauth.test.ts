// @vitest-environment node

/**
 * Where a completed consent lands, and who may complete it. The decision
 * itself is `planOauth2Grant` (its own test); these pin the wiring around
 * it: one transaction under the pair lock, the Reconnect target row-locked
 * and renewed in place, an Add stored as a new credential, a lost workspace
 * claim rolled back — and a callback that re-checks the initiator's access
 * and the Reconnect target before the code is ever redeemed.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createCredentialInTransaction,
  findOauth2Grant,
  listCredentials,
  lockCredentialPair,
  updateCredentialInTransaction,
} = vi.hoisted(() => ({
  createCredentialInTransaction: vi.fn(),
  findOauth2Grant: vi.fn(),
  listCredentials: vi.fn(),
  lockCredentialPair: vi.fn(),
  updateCredentialInTransaction: vi.fn(),
}));

vi.mock('../connector_credentials/service.ts', () => ({
  CREDENTIAL_NAME_MAX: 100,
  createCredentialInTransaction,
  findOauth2Grant,
  listCredentials,
  lockCredentialPair,
  updateCredentialInTransaction,
}));

import {
  hashStateToken,
  mintStateToken,
} from '../../core/http_connectors/oauth_state.ts';
import { completeOauth2, storeOauth2Grant } from './oauth.ts';

interface Route {
  organizationId: string;
  credentialId: string;
}

/**
 * A tagged-template `sql` that answers the team-route reads and the route
 * claim, and runs `begin` callbacks against itself. A claim on a workspace
 * whose route names another organization answers no row, exactly as the
 * `ON CONFLICT … WHERE org_id = $me` insert does. `rolledBack` records a
 * transaction whose callback threw.
 */
function sqlWithRoutes(routes: Record<string, Route>) {
  const state = { rolledBack: 0 };
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?');
    if (text.includes('INSERT INTO app.connector_team_routes')) {
      const teamId = String(values[0]);
      const organizationId = String(values[1]);
      const route = routes[teamId];
      return Promise.resolve(
        route !== undefined && route.organizationId !== organizationId
          ? []
          : [{ teamId }],
      );
    }
    if (text.includes('credential_id = ')) {
      const credentialId = String(values[1]);
      return Promise.resolve(
        Object.entries(routes)
          .filter(([, route]) => route.credentialId === credentialId)
          .map(([teamId]) => ({ teamId })),
      );
    }
    if (text.includes('FROM app.connector_team_routes')) {
      const route = routes[String(values[0])];
      return Promise.resolve(route === undefined ? [] : [route]);
    }
    return Promise.resolve([]);
  };
  const begin = async (callback: (tx: unknown) => Promise<unknown>) => {
    try {
      return await callback(tag);
    } catch (error) {
      state.rolledBack += 1;
      throw error;
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call and `begin` are exercised
  return { sql: Object.assign(tag, { begin }) as unknown as Sql, state };
}

const credential = (
  id: string,
  name: string,
  extra: Partial<{
    connectorSlug: string;
    authMethod: string;
    isDefault: boolean;
    status: string;
  }> = {},
) => ({
  id,
  connectorSlug: 'gmail',
  authMethod: 'oauth2',
  name,
  isDefault: false,
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const TOKENS = {
  accessToken: 'ya29.fresh',
  refreshToken: '1//fresh',
  expiresAt: 4_102_444_800_000,
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
};

const gmailGrant = (
  sql: Sql,
  intent: { kind: 'add' } | { kind: 'reconnect'; credentialId: string },
) =>
  storeOauth2Grant(sql, {
    organizationId: 'org-1',
    connectorSlug: 'gmail',
    userId: 'user-1',
    displayName: 'Gmail',
    intent,
    tokens: TOKENS,
  });

beforeEach(() => {
  vi.clearAllMocks();
  createCredentialInTransaction.mockResolvedValue({ credentialId: 'cred-new' });
  updateCredentialInTransaction.mockResolvedValue(undefined);
  lockCredentialPair.mockResolvedValue(undefined);
  findOauth2Grant.mockResolvedValue(null);
  listCredentials.mockResolvedValue([]);
});

describe('storeOauth2Grant', () => {
  it('adds a second account as a new credential and never touches the default (#3711)', async () => {
    listCredentials.mockResolvedValue([
      credential('cred-default', 'Gmail', { isDefault: true }),
    ]);
    const { sql } = sqlWithRoutes({});
    await expect(gmailGrant(sql, { kind: 'add' })).resolves.toEqual({
      ok: true,
      credentialId: 'cred-new',
      renewed: false,
    });
    expect(updateCredentialInTransaction).not.toHaveBeenCalled();
    expect(createCredentialInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        connectorSlug: 'gmail',
        authMethod: 'oauth2',
        name: 'Gmail 2',
        secret: TOKENS,
        createdBy: 'user-1',
      }),
    );
    // Serialized per pair before the siblings are read, so two adds number
    // past each other instead of colliding.
    expect(lockCredentialPair.mock.invocationCallOrder[0]).toBeLessThan(
      listCredentials.mock.invocationCallOrder[0] ?? 0,
    );
    expect(lockCredentialPair).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'gmail',
    );
  });

  it('renews exactly the credential a Reconnect named, locked, keeping its name (#3711)', async () => {
    const sales = credential('cred-sales', 'Gmail sales', {
      status: 'needs-reauth',
    });
    listCredentials.mockResolvedValue([
      credential('cred-default', 'Gmail', { isDefault: true }),
      sales,
    ]);
    findOauth2Grant.mockResolvedValue(sales);
    const { sql } = sqlWithRoutes({});
    await expect(
      gmailGrant(sql, { kind: 'reconnect', credentialId: 'cred-sales' }),
    ).resolves.toEqual({ ok: true, credentialId: 'cred-sales', renewed: true });
    expect(findOauth2Grant).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      connectorSlug: 'gmail',
      credentialId: 'cred-sales',
      forUpdate: true,
    });
    // Locked before the siblings are read: a delete that won is missing
    // from both reads.
    expect(findOauth2Grant.mock.invocationCallOrder[0]).toBeLessThan(
      listCredentials.mock.invocationCallOrder[0] ?? 0,
    );
    expect(updateCredentialInTransaction).toHaveBeenCalledTimes(1);
    expect(updateCredentialInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'org-1',
        credentialId: 'cred-sales',
        secret: TOKENS,
        status: 'active',
        statusDetail: null,
        // The renewal is audited under the person who completed the grant.
        actor: { userId: 'user-1' },
      },
    );
    expect(createCredentialInTransaction).not.toHaveBeenCalled();
  });

  it('renews a disabled credential without re-enabling it', async () => {
    const paused = credential('cred-paused', 'Gmail paused', {
      status: 'disabled',
    });
    listCredentials.mockResolvedValue([paused]);
    findOauth2Grant.mockResolvedValue(paused);
    const { sql } = sqlWithRoutes({});
    await gmailGrant(sql, { kind: 'reconnect', credentialId: 'cred-paused' });
    expect(updateCredentialInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'org-1',
        credentialId: 'cred-paused',
        secret: TOKENS,
        actor: { userId: 'user-1' },
      },
    );
  });

  it('writes nothing when the Reconnect target is gone', async () => {
    listCredentials.mockResolvedValue([
      credential('cred-default', 'Gmail', { isDefault: true }),
    ]);
    const { sql } = sqlWithRoutes({});
    await expect(
      gmailGrant(sql, { kind: 'reconnect', credentialId: 'cred-gone' }),
    ).resolves.toEqual({ ok: false, reason: 'credential_missing' });
    expect(updateCredentialInTransaction).not.toHaveBeenCalled();
    expect(createCredentialInTransaction).not.toHaveBeenCalled();
  });

  it('renews the credential an already connected Slack workspace routes to', async () => {
    const routedGrant = credential('cred-1', 'Slack', {
      connectorSlug: 'slack',
    });
    listCredentials.mockResolvedValue([routedGrant]);
    findOauth2Grant.mockResolvedValue(routedGrant);
    const { sql } = sqlWithRoutes({
      'T-1': { organizationId: 'org-1', credentialId: 'cred-1' },
    });
    const outcome = await storeOauth2Grant(sql, {
      organizationId: 'org-1',
      connectorSlug: 'slack',
      userId: 'user-1',
      displayName: 'Slack',
      intent: { kind: 'add' },
      tokens: { ...TOKENS, teamId: 'T-1' },
    });
    expect(outcome).toEqual({
      ok: true,
      credentialId: 'cred-1',
      renewed: true,
    });
    // The routed row is locked before it is renewed.
    expect(findOauth2Grant).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ credentialId: 'cred-1', forUpdate: true }),
    );
    expect(createCredentialInTransaction).not.toHaveBeenCalled();
  });

  it('never keeps a credential for a workspace another organization claims — the transaction rolls back', async () => {
    const { sql, state } = sqlWithRoutes({
      'T-1': { organizationId: 'org-other', credentialId: 'cred-x' },
    });
    // The in-transaction read sees the foreign route and refuses outright.
    await expect(
      storeOauth2Grant(sql, {
        organizationId: 'org-1',
        connectorSlug: 'slack',
        userId: 'user-1',
        displayName: 'Slack',
        intent: { kind: 'add' },
        tokens: { ...TOKENS, teamId: 'T-1' },
      }),
    ).resolves.toEqual({ ok: false, reason: 'workspace_claimed' });
    expect(createCredentialInTransaction).not.toHaveBeenCalled();
    expect(state.rolledBack).toBe(0);
  });

  it('rolls back the new credential when the claim loses a race it could not see', async () => {
    // The route read finds nothing (the other claim is uncommitted); the
    // claim insert then loses on the key.
    const routes: Record<string, Route> = {};
    const { sql, state } = sqlWithRoutes(routes);
    createCredentialInTransaction.mockImplementation(async () => {
      routes['T-RACE'] = {
        organizationId: 'org-other',
        credentialId: 'cred-x',
      };
      return { credentialId: 'cred-new' };
    });
    await expect(
      storeOauth2Grant(sql, {
        organizationId: 'org-1',
        connectorSlug: 'slack',
        userId: 'user-1',
        displayName: 'Slack',
        intent: { kind: 'add' },
        tokens: { ...TOKENS, teamId: 'T-RACE' },
      }),
    ).resolves.toEqual({ ok: false, reason: 'workspace_claimed' });
    expect(createCredentialInTransaction).toHaveBeenCalledTimes(1);
    expect(state.rolledBack).toBe(1);
  });

  it('refuses a Slack Reconnect consented in a workspace another credential holds', async () => {
    const target = credential('cred-2', 'Slack (B)', {
      connectorSlug: 'slack',
    });
    listCredentials.mockResolvedValue([
      credential('cred-1', 'Slack', { connectorSlug: 'slack' }),
      target,
    ]);
    findOauth2Grant.mockResolvedValue(target);
    const { sql } = sqlWithRoutes({
      'T-A': { organizationId: 'org-1', credentialId: 'cred-1' },
      'T-B': { organizationId: 'org-1', credentialId: 'cred-2' },
    });
    await expect(
      storeOauth2Grant(sql, {
        organizationId: 'org-1',
        connectorSlug: 'slack',
        userId: 'user-1',
        displayName: 'Slack',
        intent: { kind: 'reconnect', credentialId: 'cred-2' },
        tokens: { ...TOKENS, teamId: 'T-A' },
      }),
    ).resolves.toEqual({ ok: false, reason: 'account_mismatch' });
    expect(updateCredentialInTransaction).not.toHaveBeenCalled();
  });
});

describe('completeOauth2 — the completer must be the initiator, and still allowed', () => {
  /** A `sql` whose state consume answers the pending row for `stateHash`
   * (once — a second consume finds nothing, like `DELETE … RETURNING`), and
   * whose membership read answers `roles`. */
  function sqlWithPending(
    stateHash: string,
    userId: string,
    options: {
      roles?: Record<string, string>;
      reconnectCredentialId?: string | null;
    } = {},
  ): Sql {
    let consumed = false;
    const roles = options.roles ?? { 'user-1': 'developer' };
    const tag = (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<unknown[]> => {
      const text = strings.join('?');
      if (text.includes('DELETE FROM app.connector_oauth_states')) {
        if (consumed || values[0] !== stateHash) return Promise.resolve([]);
        consumed = true;
        return Promise.resolve([
          {
            organizationId: 'org-1',
            userId,
            connectorSlug: 'gmail',
            codeVerifier: 'verifier',
            redirectUri: 'https://tale.example/api/connectors/oauth2/callback',
            reconnectCredentialId: options.reconnectCredentialId ?? null,
            expiresAt: Date.now() + 60_000,
          },
        ]);
      }
      if (text.includes('FROM "member"')) {
        const role = roles[String(values[1])];
        return Promise.resolve(
          role === undefined
            ? []
            : [
                {
                  id: 'm-1',
                  organizationId: 'org-1',
                  userId: values[1],
                  role,
                },
              ],
        );
      }
      if (text.includes('FROM "organization"')) {
        return Promise.resolve([{ id: 'org-1' }]);
      }
      return Promise.resolve([]);
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call is exercised
    return Object.assign(tag, { unsafe: (t: string) => t }) as unknown as Sql;
  }

  it('refuses a valid state completed by another user, burning it, before any exchange', async () => {
    const state = mintStateToken();
    const sql = sqlWithPending(await hashStateToken(state), 'user-1');
    const fetchImpl = vi.fn();

    const outcome = await completeOauth2(
      sql,
      { state, code: 'code-1', vendorError: null, requesterUserId: 'user-2' },
      { fetchImpl },
    );

    expect(outcome).toEqual({ kind: 'error', error: 'invalid_state' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(createCredentialInTransaction).not.toHaveBeenCalled();
    expect(updateCredentialInTransaction).not.toHaveBeenCalled();
    // The state is gone: the rightful user cannot finish it either.
    await expect(
      completeOauth2(
        sql,
        { state, code: 'code-1', vendorError: null, requesterUserId: 'user-1' },
        { fetchImpl },
      ),
    ).resolves.toEqual({ kind: 'error', error: 'invalid_state' });
  });

  it('refuses a completion with no session at all', async () => {
    const state = mintStateToken();
    const sql = sqlWithPending(await hashStateToken(state), 'user-1');
    await expect(
      completeOauth2(sql, {
        state,
        code: 'code-1',
        vendorError: null,
        requesterUserId: null,
      }),
    ).resolves.toEqual({ kind: 'error', error: 'invalid_state' });
  });

  it.each([
    ['lost the role that writes credentials', { 'user-1': 'member' }],
    ['was disabled', { 'user-1': 'disabled' }],
    ['left the organization', {}],
  ])(
    'refuses an initiator who %s while the vendor asked for consent',
    async (_what, roles) => {
      const state = mintStateToken();
      const sql = sqlWithPending(await hashStateToken(state), 'user-1', {
        roles,
      });
      const fetchImpl = vi.fn();
      await expect(
        completeOauth2(
          sql,
          {
            state,
            code: 'code-1',
            vendorError: null,
            requesterUserId: 'user-1',
          },
          { fetchImpl },
        ),
      ).resolves.toEqual({ kind: 'error', error: 'forbidden' });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(createCredentialInTransaction).not.toHaveBeenCalled();
      expect(updateCredentialInTransaction).not.toHaveBeenCalled();
    },
  );

  it('refuses a Reconnect whose credential is gone before redeeming the code', async () => {
    const state = mintStateToken();
    const sql = sqlWithPending(await hashStateToken(state), 'user-1', {
      reconnectCredentialId: 'cred-gone',
    });
    const fetchImpl = vi.fn();
    await expect(
      completeOauth2(
        sql,
        { state, code: 'code-1', vendorError: null, requesterUserId: 'user-1' },
        { fetchImpl },
      ),
    ).resolves.toEqual({
      kind: 'error',
      error: 'credential_missing',
      organizationId: 'org-1',
    });
    expect(findOauth2Grant).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      connectorSlug: 'gmail',
      credentialId: 'cred-gone',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lets the initiator through to the exchange step', async () => {
    const state = mintStateToken();
    const sql = sqlWithPending(await hashStateToken(state), 'user-1');
    // Past the binding and access checks the flow looks for the vendor app;
    // none is configured here, which is the NEXT refusal — proof they passed.
    await expect(
      completeOauth2(sql, {
        state,
        code: 'code-1',
        vendorError: null,
        requesterUserId: 'user-1',
      }),
    ).resolves.toEqual({
      kind: 'error',
      error: 'not_configured',
      organizationId: 'org-1',
    });
  });
});
