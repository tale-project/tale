// @vitest-environment node

/**
 * What the consent page of a coding agent is told before it shows its
 * choices [AGCONN-R21]: who the app is, what it asked for, where the person
 * may connect it and with how much access, and what they allowed before.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mayConnectAgentIn } from '../../auth/api-key-create-gate.ts';
import {
  evaluateTwoFactorEnforcement,
  type TwoFactorEnforcement,
} from '../two_factor/service.ts';
import {
  ConsentContextError,
  readAgentConsentContext,
} from './consent-context.ts';
import { recordingSql } from './test-helpers.ts';

vi.mock('../../auth/api-key-create-gate.ts', () => ({
  mayConnectAgentIn: vi.fn(),
}));
vi.mock('../two_factor/service.ts', () => ({
  evaluateTwoFactorEnforcement: vi.fn(),
}));

const DOCUMENT = 'https://claude.ai/oauth/claude-code-client-metadata';
/** What the sign-in policy decided about a person. */
const enforcement = (decision: TwoFactorEnforcement['decision']) =>
  ({
    decision,
    graceUntilToSet: null,
    graceDeadline: null,
    policy: { enforced: false, exemptSsoUsers: false },
  }) satisfies TwoFactorEnforcement;

const ASKED =
  'tale:mcp tale:automations.write tale:settings.read offline_access';

interface World {
  client?: { name: string | null; discovery: string | null } | null;
  memberships?: { id: string; slug: string; name: string; role: string }[];
  connections?: { organizationId: string; scopes: string[] }[];
  emailVerified?: boolean;
}

function world(given: World = {}) {
  return recordingSql((statement) => {
    if (statement.text.includes('FROM "oauthClient"')) {
      const client =
        given.client === undefined
          ? { name: 'Claude Code', discovery: 'cimd' }
          : given.client;
      return client === null ? [] : [client];
    }
    if (statement.text.includes('FROM "member" m')) {
      return given.memberships ?? [];
    }
    if (statement.text.includes('FROM app.agent_connections')) {
      return given.connections ?? [];
    }
    if (statement.text.includes('SELECT "emailVerified"')) {
      return [{ emailVerified: given.emailVerified ?? true }];
    }
    return undefined;
  });
}

/** `null` asks for no scope at all. */
const read = (
  sql: Parameters<typeof readAgentConsentContext>[0],
  scope: string | null = ASKED,
) =>
  readAgentConsentContext(sql, {
    userId: 'user-ada',
    activeOrganizationId: 'org-4',
    clientId: DOCUMENT,
    scope: scope ?? undefined,
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(mayConnectAgentIn).mockResolvedValue(true);
  vi.mocked(evaluateTwoFactorEnforcement).mockResolvedValue(enforcement('ok'));
});

describe('the app and what it asked for', () => {
  it('names the app, says whether anyone vouched for it, and keeps only the scopes a connection is given, in the order asked — none that no tool takes [AGCONN-R25]', async () => {
    const { sql } = world();
    const context = await read(
      sql,
      'openid tale:settings.read tale:mcp bogus tale:subscriptions.connect offline_access tale:mcp',
    );
    expect(context.client).toEqual({
      id: DOCUMENT,
      name: 'Claude Code',
      provenance: 'metadata_document',
      host: 'claude.ai',
    });
    expect(context.requestedScopes).toEqual([
      'tale:settings.read',
      'tale:mcp',
      'offline_access',
      'tale:mcp',
    ]);
  });

  it('refuses an app the sign-in server does not know', async () => {
    const { sql } = world({ client: null });
    await expect(read(sql)).rejects.toMatchObject({
      name: 'ConsentContextError',
      code: 'CLIENT_NOT_FOUND',
      status: 404,
    });
  });

  it('refuses a request that asks for nothing a connection holds — single sign-on above all — before reading anything', async () => {
    for (const scope of [null, '', 'openid profile email', 'offline_access']) {
      const { sql, statements } = world();
      await expect(read(sql, scope), String(scope)).rejects.toBeInstanceOf(
        ConsentContextError,
      );
      await expect(read(sql, scope)).rejects.toMatchObject({
        code: 'NOT_AN_AGENT_REQUEST',
        status: 400,
      });
      expect(statements).toEqual([]);
    }
  });
});

describe('the organizations of the person', () => {
  // Ids that do not follow the names, so a list in name order is not one in
  // id order, and a lower-case name that sorts first when case is ignored.
  const MEMBERSHIPS = [
    { id: 'org-1', slug: 'beta', name: 'Beta', role: 'MEMBER' },
    { id: 'org-4', slug: 'acme', name: 'Acme', role: 'Developer' },
    { id: 'org-2', slug: 'zed', name: 'zed labs', role: 'disabled' },
    { id: 'org-3', slug: 'cal', name: 'Cal', role: 'admin' },
  ];

  it('lists those they may connect an agent to first, then by name, with the most their role lets them allow', async () => {
    vi.mocked(mayConnectAgentIn).mockImplementation((_sql, args) =>
      Promise.resolve(args.role !== 'member'),
    );
    const { sql } = world({ memberships: MEMBERSHIPS });
    const { organizations } = await read(sql);
    expect(organizations.map((org) => [org.id, org.allowed, org.role])).toEqual(
      [
        ['org-4', true, 'developer'],
        ['org-3', true, 'admin'],
        ['org-1', false, 'member'],
        ['org-2', false, 'disabled'],
      ],
    );
    const acme = organizations.find((org) => org.id === 'org-4');
    expect(acme?.ceiling).toEqual([
      'tale:mcp',
      'tale:automations.write',
      'tale:automations.deploy',
      'tale:settings.read',
      'tale:settings.write',
      'tale:subscriptions.connect',
    ]);
    expect(acme).not.toHaveProperty('reason');
  });

  it('says why one may not: a switched-off seat, or a role that holds no key and no competence grants it', async () => {
    vi.mocked(mayConnectAgentIn).mockResolvedValue(false);
    const { sql } = world({ memberships: MEMBERSHIPS });
    const { organizations } = await read(sql);
    const reasons = Object.fromEntries(
      organizations.map((org) => [org.id, org.reason]),
    );
    expect(reasons).toEqual({
      'org-4': 'AGENT_CONNECT_FORBIDDEN',
      'org-1': 'AGENT_CONNECT_FORBIDDEN',
      'org-3': 'AGENT_CONNECT_FORBIDDEN',
      'org-2': 'ORG_FORBIDDEN',
    });
    for (const org of organizations) {
      expect(org.allowed).toBe(false);
      expect(org.ceiling).toEqual([]);
    }
  });

  it('asks the gate that connects whether a switched-off seat may, never: that one is refused without asking', async () => {
    const { sql } = world({ memberships: MEMBERSHIPS });
    await read(sql);
    const asked = vi.mocked(mayConnectAgentIn).mock.calls.map((call) => ({
      organizationId: call[1].organizationId,
      userId: call[1].userId,
      role: call[1].role,
    }));
    expect(asked.map((args) => args.organizationId).sort()).toEqual([
      'org-1',
      'org-3',
      'org-4',
    ]);
    expect(asked.every((args) => args.userId === 'user-ada')).toBe(true);
    // The role the gate sees is the lower-cased one, as it sees it at the gate.
    expect(asked.find((args) => args.organizationId === 'org-1')?.role).toBe(
      'member',
    );
  });

  it('limits a member who may connect by a competence to what their role lets them allow', async () => {
    const { sql } = world({
      memberships: [
        { id: 'org-1', slug: 'beta', name: 'Beta', role: 'member' },
      ],
    });
    const { organizations } = await read(sql);
    expect(organizations[0]?.allowed).toBe(true);
    expect(organizations[0]?.ceiling).toEqual([
      'tale:mcp',
      'tale:settings.read',
    ]);
  });

  it('reads what they allowed this app in each organization before, only while that connection lives', async () => {
    const { sql, statements } = world({
      memberships: MEMBERSHIPS,
      connections: [
        {
          organizationId: 'org-4',
          scopes: ['tale:mcp', 'tale:automations.write', 'unknown:scope'],
        },
      ],
    });
    const { organizations } = await read(sql);
    expect(
      Object.fromEntries(organizations.map((org) => [org.id, org.previous])),
    ).toEqual({
      'org-4': ['tale:mcp', 'tale:automations.write'],
      'org-1': null,
      'org-3': null,
      'org-2': null,
    });
    const asked = statements.find((s) =>
      s.text.includes('FROM app.agent_connections'),
    );
    expect(asked?.text).toContain('revoked_at_ms IS NULL');
    expect(asked?.values).toEqual(['user-ada', DOCUMENT]);
  });

  it('asks for the memberships of this person alone', async () => {
    const { sql, statements } = world({ memberships: MEMBERSHIPS });
    await read(sql);
    const asked = statements.find((s) => s.text.includes('FROM "member" m'));
    expect(asked?.text).toContain('WHERE m."userId" = ?');
    expect(asked?.values).toEqual(['user-ada']);
  });

  it('orders by name without regard to case, and by id between organizations that share one', async () => {
    const { sql } = world({
      memberships: [
        { id: 'org-9', slug: 'beta-1', name: 'Beta', role: 'developer' },
        { id: 'org-5', slug: 'alpha', name: 'alpha', role: 'developer' },
        { id: 'org-2', slug: 'beta-2', name: 'Beta', role: 'developer' },
      ],
    });
    const { organizations } = await read(sql);
    expect(organizations.map((org) => org.id)).toEqual([
      'org-5',
      'org-2',
      'org-9',
    ]);
  });

  it('is an empty list for a person who belongs nowhere', async () => {
    const { sql } = world();
    const context = await read(sql);
    expect(context.organizations).toEqual([]);
    expect(context.activeOrganizationId).toBe('org-4');
  });
});

describe('whether the account may sign in to an organization at all', () => {
  it('is eligible with a verified address and no two-factor enrollment due', async () => {
    const { sql } = world();
    expect((await read(sql)).eligible).toBe(true);
  });

  it('is not for an account that cannot be found', async () => {
    const { sql } = recordingSql((statement) => {
      if (statement.text.includes('FROM "oauthClient"')) {
        return [{ name: 'Claude Code', discovery: 'cimd' }];
      }
      return [];
    });
    expect((await read(sql)).eligible).toBe(false);
  });

  it('is while the grace for enrolling in two-factor authentication has not run out', async () => {
    vi.mocked(evaluateTwoFactorEnforcement).mockResolvedValue(
      enforcement('grace'),
    );
    const { sql } = world();
    expect((await read(sql)).eligible).toBe(true);
  });

  it('judges this person’s enrollment', async () => {
    const { sql } = world();
    await read(sql);
    expect(evaluateTwoFactorEnforcement).toHaveBeenCalledExactlyOnceWith(
      sql,
      'user-ada',
    );
  });

  it('is not with an unverified address', async () => {
    const { sql } = world({ emailVerified: false });
    expect((await read(sql)).eligible).toBe(false);
  });

  it('is not when two-factor enrollment is due and the grace has run out', async () => {
    vi.mocked(evaluateTwoFactorEnforcement).mockResolvedValue(
      enforcement('blocked'),
    );
    const { sql } = world();
    expect((await read(sql)).eligible).toBe(false);
  });
});
