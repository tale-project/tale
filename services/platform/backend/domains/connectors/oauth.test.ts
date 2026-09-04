// @vitest-environment node

/**
 * Where a completed consent lands. The settings card advertises Reconnect for
 * an oauth2 credential, and an organization may connect several Slack
 * workspaces — neither may fail on the label the first credential already
 * holds. A workspace already routed here renews ITS credential; a new
 * workspace (or a first connection) is stored under a label no sibling has —
 * and its workspace claim commits in the same transaction, so a lost claim
 * keeps nothing.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createCredentialInTransaction, listCredentials, updateCredential } =
  vi.hoisted(() => ({
    createCredentialInTransaction: vi.fn(),
    listCredentials: vi.fn(),
    updateCredential: vi.fn(),
  }));

vi.mock('../connector_credentials/service.ts', () => ({
  CREDENTIAL_NAME_MAX: 100,
  createCredentialInTransaction,
  listCredentials,
  updateCredential,
}));

import { storeOauth2Grant, uniqueCredentialName } from './oauth.ts';

interface Route {
  organizationId: string;
  credentialId: string;
}

/**
 * A tagged-template `sql` that answers the team-route lookup and the route
 * claim, and runs `begin` callbacks against itself — the store-and-claim
 * transaction is what a NEW credential lands in. A claim on a workspace whose
 * route names another organization answers no row, exactly as the
 * `ON CONFLICT … WHERE org_id = $me` insert does.
 */
function sqlWithRoutes(routes: Record<string, Route>): Sql {
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
    if (text.includes('FROM app.connector_team_routes')) {
      const teamId = String(values[0]);
      const route = routes[teamId];
      return Promise.resolve(route === undefined ? [] : [route]);
    }
    return Promise.resolve([]);
  };
  const begin = (callback: (tx: unknown) => Promise<unknown>) => callback(tag);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call and `begin` are exercised
  return Object.assign(tag, { begin }) as unknown as Sql;
}

const credential = (
  id: string,
  name: string,
  extra: Partial<{
    authMethod: string;
    isDefault: boolean;
    createdAt: number;
  }> = {},
) => ({
  id,
  connectorSlug: 'slack',
  authMethod: 'oauth2',
  name,
  isDefault: false,
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const TOKENS = {
  accessToken: 'xoxb-fresh',
  refreshToken: 'xoxe-fresh',
  expiresAt: 4_102_444_800_000,
  scopes: ['chat:write'],
};

const grant = (
  sql: Sql,
  tokens: typeof TOKENS & { teamId?: string; teamName?: string },
) =>
  storeOauth2Grant(sql, {
    organizationId: 'org-1',
    connectorSlug: 'slack',
    userId: 'user-1',
    displayName: 'Slack',
    tokens,
  });

beforeEach(() => {
  vi.clearAllMocks();
  createCredentialInTransaction.mockResolvedValue({ credentialId: 'cred-new' });
  updateCredential.mockResolvedValue(undefined);
});

describe('uniqueCredentialName', () => {
  it('keeps the base when no sibling holds it', () => {
    expect(uniqueCredentialName(['Gmail'], 'Slack')).toBe('Slack');
  });

  it('counts past every taken label, case-insensitively', () => {
    expect(uniqueCredentialName(['slack', 'Slack (2)'], 'Slack')).toBe(
      'Slack (3)',
    );
  });
});

describe('storeOauth2Grant', () => {
  it('stores the first connection under the connector display name', async () => {
    listCredentials.mockResolvedValue([]);
    const outcome = await grant(sqlWithRoutes({}), {
      ...TOKENS,
      teamId: 'T-1',
      teamName: 'Acme',
    });
    expect(outcome).toEqual({ credentialId: 'cred-new', renewed: false });
    expect(updateCredential).not.toHaveBeenCalled();
    expect(createCredentialInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'Slack',
        authMethod: 'oauth2',
        secret: TOKENS,
      }),
    );
  });

  it('renews the credential a connected workspace already routes to', async () => {
    listCredentials.mockResolvedValue([credential('cred-1', 'Slack')]);
    const outcome = await grant(
      sqlWithRoutes({
        'T-1': { organizationId: 'org-1', credentialId: 'cred-1' },
      }),
      { ...TOKENS, teamId: 'T-1' },
    );
    expect(outcome).toEqual({ credentialId: 'cred-1', renewed: true });
    expect(createCredentialInTransaction).not.toHaveBeenCalled();
    expect(updateCredential).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      credentialId: 'cred-1',
      secret: TOKENS,
      status: 'active',
      statusDetail: null,
    });
  });

  it('names a second workspace after itself instead of colliding', async () => {
    listCredentials.mockResolvedValue([credential('cred-1', 'Slack')]);
    const outcome = await grant(
      sqlWithRoutes({
        'T-1': { organizationId: 'org-1', credentialId: 'cred-1' },
      }),
      { ...TOKENS, teamId: 'T-2', teamName: 'Second Workspace' },
    );
    expect(outcome.renewed).toBe(false);
    expect(createCredentialInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Slack (Second Workspace)' }),
    );
  });

  it('falls back to a counter when the workspace name is unknown or taken', async () => {
    listCredentials.mockResolvedValue([
      credential('cred-1', 'Slack'),
      credential('cred-2', 'Slack (2)'),
    ]);
    await grant(sqlWithRoutes({}), { ...TOKENS, teamId: 'T-3' });
    expect(createCredentialInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Slack (3)' }),
    );
  });

  it("never renews another organization's credential for the same workspace — the claim refuses and nothing is kept", async () => {
    listCredentials.mockResolvedValue([]);
    await expect(
      grant(
        sqlWithRoutes({
          'T-1': { organizationId: 'org-other', credentialId: 'cred-x' },
        }),
        { ...TOKENS, teamId: 'T-1' },
      ),
    ).rejects.toThrow('workspace already connected to another organization');
    expect(updateCredential).not.toHaveBeenCalled();
    // The credential row was written INSIDE the transaction the lost claim
    // rolls back — the database keeps nothing.
    expect(createCredentialInTransaction).toHaveBeenCalledTimes(1);
  });

  it('reconnects a connector without a workspace notion through its default grant', async () => {
    listCredentials.mockResolvedValue([
      credential('cred-old', 'Gmail (2)', { createdAt: 1 }),
      credential('cred-default', 'Gmail', { isDefault: true, createdAt: 2 }),
      credential('cred-key', 'Gmail key', { authMethod: 'api-key' }),
    ]);
    const outcome = await storeOauth2Grant(sqlWithRoutes({}), {
      organizationId: 'org-1',
      connectorSlug: 'gmail',
      userId: 'user-1',
      displayName: 'Gmail',
      tokens: TOKENS,
    });
    expect(outcome).toEqual({ credentialId: 'cred-default', renewed: true });
    expect(createCredentialInTransaction).not.toHaveBeenCalled();
  });
});
