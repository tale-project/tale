// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { notifyUser } from '../collab/service.ts';
import {
  API_KEY_CREATED_NOTIFICATION_TYPE,
  type ApiKeyActor,
  createOwnedApiKey,
  listApiKeysForViewer,
  revokeBoundApiKey,
  servicePrincipalEmail,
} from './service.ts';

/**
 * The organization's own door for API keys: a key an Owner or Admin makes
 * for another member, a team, a project or the organization, the keys a
 * person sees in one organization, and ending a key bound to it. Driven
 * against a scripted database and a stand-in for the api-key plugin, whose
 * mint is the one thing this module does not own.
 */

vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(() => Promise.resolve('audit-1')),
}));
vi.mock('../collab/service.ts', () => ({
  notifyUser: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(() => Promise.resolve()),
}));

const ORG = 'org-1';

interface Statement {
  text: string;
  values: unknown[];
}

interface World {
  /** Member roles in ORG, by user id. */
  members?: Record<string, string>;
  users?: Record<string, { name: string | null; email: string | null }>;
  /** Teams of ORG. */
  teams?: string[];
  /** Projects of ORG, with their archive stamp. */
  projects?: Record<string, { archivedAt: string | null }>;
  /** `app.api_key_owners` rows, by key id. */
  bindings?: Record<string, Record<string, unknown>>;
  /** Rows the key list answers. */
  listed?: Record<string, unknown>[];
  /** Statements that fail, by a fragment of their text. */
  failing?: string[];
}

function fakeSql(world: World = {}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (world.failing?.some((fragment) => text.includes(fragment))) {
      return Promise.reject(new Error(`refused: ${text}`));
    }
    if (text.includes('FROM "member"')) {
      const [organizationId, userId] = values;
      const role =
        organizationId === ORG ? world.members?.[String(userId)] : undefined;
      return Promise.resolve(
        role === undefined
          ? []
          : [{ id: `m-${String(userId)}`, organizationId, userId, role }],
      );
    }
    if (text.startsWith('SELECT "name", "email" FROM "user"')) {
      const user = world.users?.[String(values[0])];
      return Promise.resolve(user === undefined ? [] : [user]);
    }
    if (text.startsWith('SELECT "id" FROM "team"')) {
      const [teamId, organizationId] = values;
      return Promise.resolve(
        organizationId === ORG && world.teams?.includes(String(teamId))
          ? [{ id: teamId }]
          : [],
      );
    }
    if (text.includes('FROM app.projects')) {
      const [projectId, organizationId] = values;
      const project =
        organizationId === ORG
          ? world.projects?.[String(projectId)]
          : undefined;
      return Promise.resolve(project === undefined ? [] : [project]);
    }
    if (text.includes('FROM app.api_key_owners WHERE api_key_id')) {
      const binding = world.bindings?.[String(values[0])];
      return Promise.resolve(binding === undefined ? [] : [binding]);
    }
    if (text.startsWith('UPDATE app.api_key_owners')) {
      const [, , organizationId, keyIds] = values;
      const rows = (Array.isArray(keyIds) ? keyIds : []).flatMap((id) => {
        const binding = world.bindings?.[String(id)];
        return binding !== undefined &&
          binding.organizationId === organizationId &&
          binding.revokedAt === null
          ? [{ apiKeyId: id, kind: binding.kind, name: binding.name }]
          : [];
      });
      return Promise.resolve(rows);
    }
    if (text.includes('FROM "apikey" k')) {
      return Promise.resolve(world.listed ?? []);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    begin: (_options: string, callback: (tx: unknown) => Promise<unknown>) =>
      callback(tag),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: sql as unknown as Sql, statements };
}

function fakeAuth(mint?: () => Promise<unknown>) {
  const createApiKey = vi.fn(
    mint ??
      (() =>
        Promise.resolve({
          id: 'key-new',
          key: 'tale_secretABCD',
          start: 'tale_s',
          expiresAt: new Date('2026-11-06T00:00:00.000Z'),
        })),
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one plugin call this module makes
  return { auth: { api: { createApiKey } } as unknown as Auth, createApiKey };
}

const ADMIN: ApiKeyActor = {
  userId: 'ada',
  email: 'ada@example.test',
  name: 'Ada',
  role: 'admin',
};

const MEMBERS = {
  ada: 'admin',
  olav: 'owner',
  ines: 'admin',
  mia: 'member',
  dev: 'developer',
  gone: 'disabled',
};

const audited = () => vi.mocked(createAuditLog).mock.calls.map((c) => c[1]);
const statementsMatching = (statements: Statement[], fragment: string) =>
  statements.filter(({ text }) => text.includes(fragment));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createOwnedApiKey — who may make a key for someone else', () => {
  it('refuses anyone below an admin, before anything is read or minted [APIKEY-R1]', async () => {
    for (const role of ['member', 'editor', 'developer']) {
      const { sql, statements } = fakeSql({ members: MEMBERS });
      const { auth, createApiKey } = fakeAuth();
      await expect(
        createOwnedApiKey(
          { sql, auth },
          {
            organizationId: ORG,
            actor: { userId: 'dev', role },
            name: 'Sync',
            owner: { kind: 'organization', role: 'member' },
          },
        ),
      ).rejects.toMatchObject({ code: 'API_KEY_OWNER_FORBIDDEN', status: 403 });
      expect(statements).toEqual([]);
      expect(createApiKey).not.toHaveBeenCalled();
    }
  });

  it('refuses a key for oneself, for no active member, and for a member at or above the maker [APIKEY-R3]', async () => {
    const cases: [ApiKeyActor, string, string][] = [
      [ADMIN, 'ada', 'API_KEY_MEMBER_SELF'],
      [ADMIN, 'stranger', 'API_KEY_MEMBER_NOT_FOUND'],
      [ADMIN, 'gone', 'API_KEY_MEMBER_NOT_FOUND'],
      [ADMIN, 'ines', 'API_KEY_MEMBER_FORBIDDEN'],
      [ADMIN, 'olav', 'API_KEY_MEMBER_FORBIDDEN'],
    ];
    for (const [actor, userId, code] of cases) {
      const { sql } = fakeSql({ members: MEMBERS });
      const { auth, createApiKey } = fakeAuth();
      await expect(
        createOwnedApiKey(
          { sql, auth },
          {
            organizationId: ORG,
            actor,
            name: 'Sync',
            owner: { kind: 'member', userId },
          },
        ),
      ).rejects.toMatchObject({ code });
      expect(createApiKey).not.toHaveBeenCalled();
    }
    // The owner outranks an admin, so may make one for them.
    const { sql } = fakeSql({ members: MEMBERS });
    const { auth } = fakeAuth();
    await expect(
      createOwnedApiKey(
        { sql, auth },
        {
          organizationId: ORG,
          actor: { userId: 'olav', role: 'owner' },
          name: 'Sync',
          owner: { kind: 'member', userId: 'ines' },
        },
      ),
    ).resolves.toMatchObject({ id: 'key-new' });
  });

  it('refuses a name it cannot keep and an expiry outside one day to a year [APIKEY-R10]', async () => {
    const { sql } = fakeSql({ members: MEMBERS });
    const { auth, createApiKey } = fakeAuth();
    const make = (name: string, expiresIn?: number) =>
      createOwnedApiKey(
        { sql, auth },
        {
          organizationId: ORG,
          actor: ADMIN,
          name,
          ...(expiresIn !== undefined ? { expiresIn } : {}),
          owner: { kind: 'organization', role: 'member' },
        },
      );
    await expect(make('   ')).rejects.toMatchObject({
      code: 'API_KEY_NAME_INVALID',
    });
    await expect(make('x'.repeat(33))).rejects.toMatchObject({
      code: 'API_KEY_NAME_INVALID',
    });
    for (const expiresIn of [43_200, 366 * 86_400, 86_400.5]) {
      await expect(make('Sync', expiresIn)).rejects.toMatchObject({
        code: 'API_KEY_EXPIRY_INVALID',
      });
    }
    expect(createApiKey).not.toHaveBeenCalled();
  });
});

describe('createOwnedApiKey — a key for a member', () => {
  it('mints it as the member, binds it here, and tells them [APIKEY-R2]', async () => {
    const { sql, statements } = fakeSql({
      members: MEMBERS,
      users: { mia: { name: 'Mia Keller', email: 'mia@example.test' } },
    });
    const { auth, createApiKey } = fakeAuth();
    const created = await createOwnedApiKey(
      { sql, auth },
      {
        organizationId: ORG,
        actor: ADMIN,
        name: ' Billing sync ',
        expiresIn: 30 * 86_400,
        owner: { kind: 'member', userId: 'mia' },
      },
    );

    expect(created).toEqual({
      id: 'key-new',
      key: 'tale_secretABCD',
      name: 'Billing sync',
      expiresAt: Date.parse('2026-11-06T00:00:00.000Z'),
      owner: {
        kind: 'member',
        memberUserId: 'mia',
        memberName: 'Mia Keller',
        role: null,
      },
    });
    // A server call naming the member: the key is theirs, no identity made.
    expect(createApiKey).toHaveBeenCalledWith({
      body: { name: 'Billing sync', userId: 'mia', expiresIn: 30 * 86_400 },
    });
    expect(statementsMatching(statements, 'INSERT INTO "user"')).toEqual([]);
    const [binding] = statementsMatching(
      statements,
      'INSERT INTO app.api_key_owners',
    );
    expect(binding?.values).toEqual([
      'key-new',
      ORG,
      'member',
      'mia',
      null,
      null,
      null,
      'Billing sync',
      'ada',
      expect.any(Number),
    ]);
    expect(audited()).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        actorId: 'ada',
        action: 'api_key.created',
        resourceId: 'key-new',
        newState: {
          name: 'Billing sync',
          start: 'tale_s',
          suffix: 'ABCD',
          expiresAt: Date.parse('2026-11-06T00:00:00.000Z'),
          owner: 'member',
          userId: 'mia',
        },
      }),
    ]);
    expect(notifyUser).toHaveBeenCalledWith(sql, {
      organizationId: ORG,
      userId: 'mia',
      type: API_KEY_CREATED_NOTIFICATION_TYPE,
      titleKey: 'apiKeyCreatedForYou',
      bodyKey: 'apiKeyCreatedForYouBody',
      params: { name: 'Ada', keyName: 'Billing sync', apiKeys: true },
      resourceType: 'api_key',
      resourceId: 'key-new',
      actorType: 'user',
      actorId: 'ada',
    });
  });

  it('keeps the key when the member’s notice cannot be written', async () => {
    vi.mocked(notifyUser).mockRejectedValueOnce(new Error('bell down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sql } = fakeSql({ members: MEMBERS });
    const { auth } = fakeAuth();
    await expect(
      createOwnedApiKey(
        { sql, auth },
        {
          organizationId: ORG,
          actor: ADMIN,
          name: 'Sync',
          owner: { kind: 'member', userId: 'mia' },
        },
      ),
    ).resolves.toMatchObject({ id: 'key-new' });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe('createOwnedApiKey — a key that is not a person', () => {
  it('mints a team’s key as an identity of its own, acting with the role chosen [APIKEY-R4]', async () => {
    const { sql, statements } = fakeSql({
      members: MEMBERS,
      teams: ['finance'],
    });
    const { auth, createApiKey } = fakeAuth();
    const created = await createOwnedApiKey(
      { sql, auth },
      {
        organizationId: ORG,
        actor: ADMIN,
        name: 'Finance export',
        owner: { kind: 'team', teamId: 'finance', role: 'editor' },
      },
    );
    expect(created.owner).toEqual({
      kind: 'team',
      teamId: 'finance',
      role: 'editor',
    });

    const [identity] = statementsMatching(statements, 'INSERT INTO "user"');
    const principal = identity?.values[0];
    expect(typeof principal).toBe('string');
    // An address that names nothing: no mail can reach the identity.
    expect(identity?.values).toEqual([
      principal,
      'Finance export',
      servicePrincipalEmail(String(principal)),
    ]);
    expect(servicePrincipalEmail('AbC')).toBe('abc@api-keys.invalid');
    // No expiry asked: none passed, so the key never expires.
    expect(createApiKey).toHaveBeenCalledWith({
      body: { name: 'Finance export', userId: principal },
    });
    const [binding] = statementsMatching(
      statements,
      'INSERT INTO app.api_key_owners',
    );
    expect(binding?.values.slice(0, 7)).toEqual([
      'key-new',
      ORG,
      'team',
      principal,
      'finance',
      null,
      'editor',
    ]);
    expect(audited()[0]?.newState).toMatchObject({
      owner: 'team',
      teamId: 'finance',
      role: 'editor',
    });
    // Nobody to tell: a key that is not a person has no bell.
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('makes the organization’s key an admin when asked, but never a team’s or a project’s [APIKEY-R4]', async () => {
    const { sql } = fakeSql({
      members: MEMBERS,
      teams: ['finance'],
      projects: { launch: { archivedAt: null } },
    });
    const { auth } = fakeAuth();
    await expect(
      createOwnedApiKey(
        { sql, auth },
        {
          organizationId: ORG,
          actor: ADMIN,
          name: 'Ops',
          owner: { kind: 'organization', role: 'admin' },
        },
      ),
    ).resolves.toMatchObject({
      owner: { kind: 'organization', role: 'admin' },
    });
    for (const owner of [
      { kind: 'team', teamId: 'finance', role: 'admin' },
      { kind: 'project', projectId: 'launch', role: 'admin' },
    ] as const) {
      await expect(
        createOwnedApiKey(
          { sql, auth },
          { organizationId: ORG, actor: ADMIN, name: 'Ops', owner },
        ),
      ).rejects.toMatchObject({ code: 'API_KEY_ROLE_FORBIDDEN' });
    }
  });

  it('refuses a team or a project of another organization, and an archived project', async () => {
    const { sql } = fakeSql({
      members: MEMBERS,
      teams: ['finance'],
      projects: { launch: { archivedAt: null }, old: { archivedAt: '5' } },
    });
    const { auth, createApiKey } = fakeAuth();
    const make = (
      owner:
        | { kind: 'team'; teamId: string; role: 'member' }
        | { kind: 'project'; projectId: string; role: 'member' },
    ) =>
      createOwnedApiKey(
        { sql, auth },
        { organizationId: ORG, actor: ADMIN, name: 'Sync', owner },
      );
    await expect(
      make({ kind: 'team', teamId: 'elsewhere', role: 'member' }),
    ).rejects.toMatchObject({ code: 'API_KEY_TEAM_NOT_FOUND', status: 404 });
    await expect(
      make({ kind: 'project', projectId: 'elsewhere', role: 'member' }),
    ).rejects.toMatchObject({ code: 'API_KEY_PROJECT_NOT_FOUND', status: 404 });
    await expect(
      make({ kind: 'project', projectId: 'old', role: 'member' }),
    ).rejects.toMatchObject({ code: 'API_KEY_PROJECT_ARCHIVED', status: 409 });
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it('removes the identity again when the mint fails', async () => {
    const { sql, statements } = fakeSql({ members: MEMBERS });
    const { auth } = fakeAuth(() => Promise.reject(new Error('mint failed')));
    await expect(
      createOwnedApiKey(
        { sql, auth },
        {
          organizationId: ORG,
          actor: ADMIN,
          name: 'Sync',
          owner: { kind: 'organization', role: 'member' },
        },
      ),
    ).rejects.toThrow('mint failed');
    const [identity] = statementsMatching(statements, 'INSERT INTO "user"');
    const [dropped] = statementsMatching(statements, 'DELETE FROM "user"');
    expect(dropped?.values).toEqual([identity?.values[0]]);
  });

  it('removes the key and its identity when the binding cannot be written', async () => {
    const { sql, statements } = fakeSql({
      members: MEMBERS,
      failing: ['INSERT INTO app.api_key_owners'],
    });
    const { auth } = fakeAuth();
    await expect(
      createOwnedApiKey(
        { sql, auth },
        {
          organizationId: ORG,
          actor: ADMIN,
          name: 'Sync',
          owner: { kind: 'organization', role: 'member' },
        },
      ),
    ).rejects.toThrow('refused');
    expect(
      statementsMatching(statements, 'DELETE FROM "apikey"').map(
        (statement) => statement.values,
      ),
    ).toEqual([['key-new']]);
    expect(statementsMatching(statements, 'DELETE FROM "user"')).toHaveLength(
      1,
    );
    expect(audited()).toEqual([]);
  });
});

describe('listApiKeysForViewer', () => {
  const row = (extra: Record<string, unknown>) => ({
    id: 'key-1',
    name: 'Sync',
    start: 'tale_s',
    prefix: 'tale',
    suffix: 'ABCD',
    enabled: true,
    expiresAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    lastRequest: null,
    ownerKind: null,
    principalUserId: null,
    teamId: null,
    projectId: null,
    role: null,
    createdBy: null,
    memberName: null,
    memberEmail: null,
    teamName: null,
    projectName: null,
    createdByName: null,
    ...extra,
  });

  it('asks for every bound key only for an Owner or Admin [APIKEY-R8]', async () => {
    for (const [role, admin] of [
      ['admin', true],
      ['owner', true],
      ['developer', false],
      ['member', false],
    ] as const) {
      const { sql, statements } = fakeSql();
      await listApiKeysForViewer(sql, {
        organizationId: ORG,
        userId: 'mia',
        role,
      });
      expect(statements[0]?.values.slice(0, 3)).toEqual(['mia', ORG, admin]);
      // A member's keys are the ones made for them here.
      expect(statements[0]?.values[3]).toBe('mia');
    }
  });

  it('names whose each key is, and what it acts as [APIKEY-R8]', async () => {
    const { sql } = fakeSql({
      listed: [
        row({ id: 'own' }),
        row({
          id: 'for-mia',
          ownerKind: 'member',
          principalUserId: 'mia',
          memberName: 'Mia Keller',
          memberEmail: 'mia@example.test',
          createdBy: 'ada',
          createdByName: 'Ada',
        }),
        row({
          id: 'team',
          ownerKind: 'team',
          teamId: 'finance',
          teamName: 'Finance',
          role: 'editor',
          createdBy: 'ada',
          createdByName: 'Ada',
          expiresAt: new Date('2026-11-01T00:00:00.000Z'),
        }),
        row({ id: 'project', ownerKind: 'project', projectId: 'launch' }),
        row({ id: 'org', ownerKind: 'organization', role: 'admin' }),
      ],
    });
    const keys = await listApiKeysForViewer(sql, {
      organizationId: ORG,
      userId: 'ada',
      role: 'admin',
    });
    expect(keys.map((key) => [key.id, key.owner, key.role])).toEqual([
      ['own', { kind: 'user' }, null],
      [
        'for-mia',
        {
          kind: 'member',
          userId: 'mia',
          name: 'Mia Keller',
          email: 'mia@example.test',
        },
        null,
      ],
      [
        'team',
        { kind: 'team', teamId: 'finance', teamName: 'Finance' },
        'editor',
      ],
      [
        'project',
        { kind: 'project', projectId: 'launch', projectName: null },
        null,
      ],
      ['org', { kind: 'organization' }, 'admin'],
    ]);
    expect(keys[2]).toMatchObject({
      expiresAt: Date.parse('2026-11-01T00:00:00.000Z'),
      createdAt: Date.parse('2026-10-01T00:00:00.000Z'),
      createdBy: { userId: 'ada', name: 'Ada' },
      canRevoke: true,
    });
    expect(keys[0]?.createdBy).toBeNull();
  });
});

describe('revokeBoundApiKey', () => {
  const binding = (kind: string, extra: Record<string, unknown> = {}) => ({
    apiKeyId: 'key-1',
    organizationId: ORG,
    kind,
    principalUserId: kind === 'member' ? 'mia' : 'identity-1',
    teamId: kind === 'team' ? 'finance' : null,
    projectId: null,
    role: kind === 'member' ? null : 'member',
    name: 'Sync',
    createdBy: 'ada',
    createdAt: '1',
    revokedAt: null,
    revokedBy: null,
    ...extra,
  });

  it('lets an admin end any key bound here, and a member the key made for them [APIKEY-R8]', async () => {
    for (const [actor, kind] of [
      [ADMIN, 'team'],
      [ADMIN, 'member'],
      [{ userId: 'mia', role: 'member' }, 'member'],
    ] as const) {
      vi.clearAllMocks();
      const { sql, statements } = fakeSql({
        bindings: { 'key-1': binding(kind) },
      });
      await revokeBoundApiKey(
        { sql },
        { organizationId: ORG, actor, keyId: 'key-1' },
      );
      expect(
        statementsMatching(statements, 'DELETE FROM "apikey"').map(
          (statement) => statement.values,
        ),
      ).toEqual([[['key-1']]]);
      expect(audited()).toEqual([
        expect.objectContaining({
          actorId: actor.userId,
          action: 'api_key.revoked',
          resourceId: 'key-1',
          previousState: { owner: kind },
        }),
      ]);
    }
  });

  it('answers not found for a key the viewer may not end [APIKEY-R8]', async () => {
    const mia = { userId: 'mia', role: 'member' };
    const cases: [ApiKeyActor, Record<string, unknown> | undefined][] = [
      // A person's own key ends at the api-key plugin's door.
      [ADMIN, undefined],
      [ADMIN, binding('team', { organizationId: 'org-2' })],
      [ADMIN, binding('team', { revokedAt: '5' })],
      [mia, binding('team')],
      [mia, binding('member', { principalUserId: 'someone-else' })],
    ];
    for (const [actor, bound] of cases) {
      const { sql, statements } = fakeSql({
        bindings: bound === undefined ? {} : { 'key-1': bound },
      });
      await expect(
        revokeBoundApiKey(
          { sql },
          { organizationId: ORG, actor, keyId: 'key-1' },
        ),
      ).rejects.toMatchObject({ code: 'API_KEY_NOT_FOUND', status: 404 });
      expect(statementsMatching(statements, 'DELETE FROM "apikey"')).toEqual(
        [],
      );
    }
  });
});
