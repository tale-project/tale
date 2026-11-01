// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { notifyUser } from '../collab/service.ts';
import { isApiKeyBlockedInOrg, listBlockingOrgSlugs } from './block-check.ts';
import { listMemberPersonalApiKeys, setPersonalApiKeyBlock } from './blocks.ts';
import {
  type PersonalKeysStanding,
  personalKeysStandingOf,
} from './personal-keys.ts';
import type { ApiKeyActor } from './service.ts';

/**
 * An organization's blocks on its members' own API keys (APIKEY-R11): who
 * may block or free a key, that a block holds in its organization only, the
 * audit row and the holder's notice of each change, and the list an Owner
 * or Admin reads. Driven against a scripted database that keeps the blocks
 * table, so a block, its repeat and its lift are read back as they stand.
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
vi.mock('./personal-keys.ts', () => ({
  personalKeysStandingOf: vi.fn(() =>
    Promise.resolve<PersonalKeysStanding>('admitted'),
  ),
}));

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const SLUGS: Record<string, string> = { [ORG]: 'acme', [OTHER_ORG]: 'beta' };

interface Statement {
  text: string;
  values: unknown[];
}

interface Key {
  name: string | null;
  start: string | null;
  suffix: string | null;
  /** Whose key it is. */
  holder: string;
  /** A key bound to an organization (`app.api_key_owners`). */
  bound?: boolean;
  /** `false` once the key was turned off; absent while it is on. */
  enabled?: boolean;
  /** When the key stops working; absent when it never does. */
  expiresAt?: Date;
}

interface Block {
  holder: string;
  by: string;
  at: number;
}

interface World {
  /** Member roles in ORG, by user id. */
  members?: Record<string, string>;
  keys?: Record<string, Key>;
  /** The blocks table, keyed `<org id>|<key id>`. */
  blocks?: Map<string, Block>;
  users?: Record<string, string>;
}

const CREATED = new Date('2026-10-01T09:00:00.000Z');
const LAST_USED = new Date('2026-10-30T17:45:00.000Z');

function fakeSql(state: World = {}): {
  sql: Sql;
  statements: Statement[];
  blocks: Map<string, Block>;
} {
  const statements: Statement[] = [];
  const blocks = state.blocks ?? new Map<string, Block>();
  const keys = state.keys ?? {};
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM "member"')) {
      const [organizationId, userId] = values;
      const role =
        organizationId === ORG ? state.members?.[String(userId)] : undefined;
      return Promise.resolve(
        role === undefined
          ? []
          : [{ id: `m-${String(userId)}`, organizationId, userId, role }],
      );
    }
    if (text.includes('k."referenceId" AS "holderUserId"')) {
      const id = String(values[0]);
      const key = keys[id];
      return Promise.resolve(
        key === undefined || key.bound === true
          ? []
          : [
              {
                id,
                name: key.name,
                start: key.start,
                suffix: key.suffix,
                holderUserId: key.holder,
              },
            ],
      );
    }
    if (text.includes('b.blocked_at_ms AS "blockedAtMs"')) {
      const [organizationId, holder] = values;
      // The query's own filters, as Postgres applies them: a key turned off
      // or expired is left out only when the query asks for that.
      const onlyLive =
        text.includes('k."enabled" IS NOT FALSE') &&
        text.includes('k."expiresAt" > now()');
      return Promise.resolve(
        Object.entries(keys)
          .filter(([, key]) => key.holder === holder && key.bound !== true)
          .filter(
            ([, key]) =>
              !onlyLive ||
              (key.enabled !== false &&
                (key.expiresAt === undefined ||
                  key.expiresAt.getTime() > Date.now())),
          )
          .map(([id, key]) => {
            const block = blocks.get(`${String(organizationId)}|${id}`);
            const row: Record<string, unknown> = {
              id,
              name: key.name,
              start: key.start,
              prefix: null,
              suffix: key.suffix,
              enabled: key.enabled ?? true,
              expiresAt: key.expiresAt ?? null,
              createdAt: CREATED,
              // postgres.js reads a bigint as a string.
              blockedAtMs: block === undefined ? null : String(block.at),
              blockedBy: block?.by ?? null,
              blockedByName:
                block === undefined ? null : (state.users?.[block.by] ?? null),
            };
            // Only what the query selects comes back.
            if (text.includes('k."lastRequest"')) row.lastRequest = LAST_USED;
            return row;
          }),
      );
    }
    if (text.startsWith('INSERT INTO app.api_key_org_blocks')) {
      const [organizationId, keyId, holder, by, at] = values;
      const id = `${String(organizationId)}|${String(keyId)}`;
      if (blocks.has(id)) return Promise.resolve([]);
      blocks.set(id, {
        holder: String(holder),
        by: String(by),
        at: Number(at),
      });
      return Promise.resolve([{ api_key_id: keyId }]);
    }
    if (text.startsWith('DELETE FROM app.api_key_org_blocks')) {
      const [organizationId, keyId] = values;
      return Promise.resolve(
        blocks.delete(`${String(organizationId)}|${String(keyId)}`)
          ? [{ api_key_id: keyId }]
          : [],
      );
    }
    if (text.startsWith('SELECT 1 AS one FROM app.api_key_org_blocks')) {
      const [organizationId, keyId] = values;
      return Promise.resolve(
        blocks.has(`${String(organizationId)}|${String(keyId)}`)
          ? [{ one: 1 }]
          : [],
      );
    }
    if (text.startsWith('SELECT o."slug" FROM app.api_key_org_blocks')) {
      const [keyId] = values;
      return Promise.resolve(
        [...blocks.keys()]
          .filter((id) => id.endsWith(`|${String(keyId)}`))
          .map((id) => ({ slug: SLUGS[id.split('|')[0] ?? ''] ?? null })),
      );
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    begin: (_options: string, callback: (tx: unknown) => Promise<unknown>) =>
      callback(tag),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: sql as unknown as Sql, statements, blocks };
}

const MEMBERS: Record<string, string> = {
  ada: 'admin',
  ines: 'admin',
  olav: 'owner',
  oona: 'owner',
  mia: 'member',
  dev: 'developer',
  gone: 'disabled',
};

const KEYS: Record<string, Key> = {
  'key-mia': {
    name: 'CI deploy',
    start: 'tale_ab',
    suffix: 'wxyz',
    holder: 'mia',
  },
  'key-mia-2': { name: null, start: 'tale_cd', suffix: null, holder: 'mia' },
  'key-olav': {
    name: 'Olav laptop',
    start: 'tale_ol',
    suffix: 'av12',
    holder: 'olav',
  },
  'key-ines': {
    name: 'Ines sync',
    start: 'tale_in',
    suffix: 'es34',
    holder: 'ines',
  },
  'key-oona': { name: 'Oona', start: 'tale_oo', suffix: null, holder: 'oona' },
  'key-ada': { name: 'Ada', start: 'tale_ad', suffix: null, holder: 'ada' },
  'key-gone': { name: 'Old', start: 'tale_go', suffix: null, holder: 'gone' },
  'key-bound': {
    name: 'Acme bot',
    start: 'tale_bo',
    suffix: null,
    holder: 'svc-1',
    bound: true,
  },
  'key-stranger': {
    name: 'Elsewhere',
    start: 'tale_st',
    suffix: null,
    holder: 'stranger',
  },
};

const actor = (userId: string): ApiKeyActor => ({
  userId,
  email: `${userId}@example.test`,
  name: userId.charAt(0).toUpperCase() + userId.slice(1),
  role: MEMBERS[userId] ?? 'member',
});

function world(blocks?: Map<string, Block>): World {
  return {
    members: MEMBERS,
    keys: KEYS,
    users: { ada: 'Ada', olav: 'Olav', oona: 'Oona' },
    ...(blocks !== undefined ? { blocks } : {}),
  };
}

const audited = () => vi.mocked(createAuditLog).mock.calls.map((c) => c[1]);
const writes = (statements: Statement[]) =>
  statements.filter(
    (s) =>
      s.text.startsWith('INSERT INTO app.api_key_org_blocks') ||
      s.text.startsWith('DELETE FROM app.api_key_org_blocks'),
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('setPersonalApiKeyBlock — blocking a member’s own key here', () => {
  it('blocks it in this organization only: one audit row by its masked ends, a hint, and the holder is told [APIKEY-R11]', async () => {
    const { sql, blocks } = fakeSql(world());

    await expect(
      setPersonalApiKeyBlock(
        { sql },
        {
          organizationId: ORG,
          actor: actor('ada'),
          keyId: 'key-mia',
          blocked: true,
        },
      ),
    ).resolves.toEqual({ changed: true });

    expect(blocks.get(`${ORG}|key-mia`)).toMatchObject({
      holder: 'mia',
      by: 'ada',
    });
    await expect(isApiKeyBlockedInOrg(sql, ORG, 'key-mia')).resolves.toBe(true);
    // The holder's other organization still lets the key in.
    await expect(isApiKeyBlockedInOrg(sql, OTHER_ORG, 'key-mia')).resolves.toBe(
      false,
    );
    await expect(listBlockingOrgSlugs(sql, 'key-mia')).resolves.toEqual(
      new Set(['acme']),
    );

    expect(audited()).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        actorId: 'ada',
        actorRole: 'admin',
        actorType: 'user',
        action: 'api_key.blocked',
        category: 'security',
        resourceType: 'api_key',
        resourceId: 'key-mia',
        resourceName: 'CI deploy',
        newState: {
          name: 'CI deploy',
          start: 'tale_ab',
          suffix: 'wxyz',
          holderUserId: 'mia',
          blocked: true,
        },
        status: 'success',
      }),
    ]);
    expect(emitHintInTx).toHaveBeenCalledWith(expect.anything(), {
      orgId: ORG,
      entity: 'api_key',
      entityId: 'key-mia',
    });
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        organizationId: ORG,
        userId: 'mia',
        type: 'api_key_blocked',
        titleKey: 'apiKeyBlockedForYou',
        bodyKey: 'apiKeyBlockedForYouBody',
        params: { name: 'Ada', keyName: 'CI deploy', apiKeys: true },
        resourceType: 'api_key',
        resourceId: 'key-mia',
        actorId: 'ada',
      }),
    );
  });

  it('names a key without a name by its start in the holder’s notice [APIKEY-R11]', async () => {
    const { sql } = fakeSql(world());
    await setPersonalApiKeyBlock(
      { sql },
      {
        organizationId: ORG,
        actor: actor('ada'),
        keyId: 'key-mia-2',
        blocked: true,
      },
    );
    expect(notifyUser).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        params: { name: 'Ada', keyName: 'tale_cd', apiKeys: true },
      }),
    );
  });

  it.each([
    ['an Owner', 'olav', 'an Admin’s', 'key-ines'],
    ['an Owner', 'olav', 'another Owner’s', 'key-oona'],
    ['an Owner', 'olav', 'a disabled member’s', 'key-gone'],
    ['an Admin', 'ada', 'another Admin’s', 'key-ines'],
  ])(
    '%s (%s) may block %s key [APIKEY-R11]',
    async (_who, userId, _whose, keyId) => {
      const { sql, blocks } = fakeSql(world());
      await expect(
        setPersonalApiKeyBlock(
          { sql },
          { organizationId: ORG, actor: actor(userId), keyId, blocked: true },
        ),
      ).resolves.toEqual({ changed: true });
      expect(blocks.has(`${ORG}|${keyId}`)).toBe(true);
    },
  );

  it('refuses an Admin on an Owner’s key, and writes nothing [APIKEY-R11]', async () => {
    const { sql, statements, blocks } = fakeSql(world());
    await expect(
      setPersonalApiKeyBlock(
        { sql },
        {
          organizationId: ORG,
          actor: actor('ada'),
          keyId: 'key-olav',
          blocked: true,
        },
      ),
    ).rejects.toMatchObject({ code: 'API_KEY_BLOCK_FORBIDDEN', status: 403 });
    expect(writes(statements)).toEqual([]);
    expect(blocks.size).toBe(0);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it.each(['mia', 'dev', 'gone'])(
    'refuses a %s who is no Owner or Admin before reading the key [APIKEY-R11]',
    async (userId) => {
      const { sql, statements } = fakeSql(world());
      await expect(
        setPersonalApiKeyBlock(
          { sql },
          {
            organizationId: ORG,
            actor: actor(userId),
            keyId: 'key-ines',
            blocked: true,
          },
        ),
      ).rejects.toMatchObject({ code: 'API_KEY_BLOCK_FORBIDDEN', status: 403 });
      expect(statements.some((s) => s.text.includes('"apikey"'))).toBe(false);
      expect(createAuditLog).not.toHaveBeenCalled();
    },
  );

  it('refuses an Admin’s own key: it is ended in their own key settings [APIKEY-R11]', async () => {
    const { sql, statements } = fakeSql(world());
    await expect(
      setPersonalApiKeyBlock(
        { sql },
        {
          organizationId: ORG,
          actor: actor('ada'),
          keyId: 'key-ada',
          blocked: true,
        },
      ),
    ).rejects.toMatchObject({ code: 'API_KEY_BLOCK_FORBIDDEN', status: 403 });
    expect(writes(statements)).toEqual([]);
  });

  it.each([
    ['a key bound to an organization', 'key-bound'],
    ['the key of someone who is no member here', 'key-stranger'],
    ['a key that does not exist', 'key-none'],
  ])('answers %s as not found [APIKEY-R11]', async (_what, keyId) => {
    const { sql, statements } = fakeSql(world());
    await expect(
      setPersonalApiKeyBlock(
        { sql },
        { organizationId: ORG, actor: actor('olav'), keyId, blocked: true },
      ),
    ).rejects.toMatchObject({ code: 'API_KEY_NOT_FOUND', status: 404 });
    expect(writes(statements)).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('lifts a block: one audit row, a hint, and the holder is told the key works here again [APIKEY-R11]', async () => {
    const { sql, blocks } = fakeSql(
      world(
        new Map([[`${ORG}|key-mia`, { holder: 'mia', by: 'olav', at: 1 }]]),
      ),
    );
    await expect(
      setPersonalApiKeyBlock(
        { sql },
        {
          organizationId: ORG,
          actor: actor('ada'),
          keyId: 'key-mia',
          blocked: false,
        },
      ),
    ).resolves.toEqual({ changed: true });

    expect(blocks.size).toBe(0);
    await expect(isApiKeyBlockedInOrg(sql, ORG, 'key-mia')).resolves.toBe(
      false,
    );
    expect(audited()).toEqual([
      expect.objectContaining({
        actorId: 'ada',
        action: 'api_key.unblocked',
        category: 'security',
        resourceType: 'api_key',
        resourceId: 'key-mia',
        previousState: {
          name: 'CI deploy',
          start: 'tale_ab',
          suffix: 'wxyz',
          holderUserId: 'mia',
          blocked: true,
        },
      }),
    ]);
    expect(emitHintInTx).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        userId: 'mia',
        type: 'api_key_unblocked',
        titleKey: 'apiKeyUnblockedForYou',
        bodyKey: 'apiKeyUnblockedForYouBody',
        params: { name: 'Ada', keyName: 'CI deploy', apiKeys: true },
      }),
    );
  });

  it('refuses an Admin who lifts the block on an Owner’s key [APIKEY-R11]', async () => {
    const { sql, blocks } = fakeSql(
      world(
        new Map([[`${ORG}|key-olav`, { holder: 'olav', by: 'oona', at: 1 }]]),
      ),
    );
    await expect(
      setPersonalApiKeyBlock(
        { sql },
        {
          organizationId: ORG,
          actor: actor('ada'),
          keyId: 'key-olav',
          blocked: false,
        },
      ),
    ).rejects.toMatchObject({ code: 'API_KEY_BLOCK_FORBIDDEN', status: 403 });
    expect(blocks.has(`${ORG}|key-olav`)).toBe(true);
  });

  it('changes and writes nothing on a repeated block or lift [APIKEY-R11]', async () => {
    const { sql } = fakeSql(world());
    const set = (blocked: boolean) =>
      setPersonalApiKeyBlock(
        { sql },
        { organizationId: ORG, actor: actor('ada'), keyId: 'key-mia', blocked },
      );

    await expect(set(true)).resolves.toEqual({ changed: true });
    await expect(set(true)).resolves.toEqual({ changed: false });
    await expect(set(false)).resolves.toEqual({ changed: true });
    await expect(set(false)).resolves.toEqual({ changed: false });

    expect(audited().map((row) => row.action)).toEqual([
      'api_key.blocked',
      'api_key.unblocked',
    ]);
    expect(emitHintInTx).toHaveBeenCalledTimes(2);
    expect(notifyUser).toHaveBeenCalledTimes(2);
  });

  it('keeps the block when the holder’s notice cannot be written, and logs it [APIKEY-R11]', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(notifyUser).mockRejectedValueOnce(new Error('bell down'));
    const { sql, blocks } = fakeSql(world());

    await expect(
      setPersonalApiKeyBlock(
        { sql },
        {
          organizationId: ORG,
          actor: actor('ada'),
          keyId: 'key-mia',
          blocked: true,
        },
      ),
    ).resolves.toEqual({ changed: true });
    expect(blocks.has(`${ORG}|key-mia`)).toBe(true);
    expect(errors).toHaveBeenCalledWith(
      '[api-keys] failed to notify the holder of a block change',
      'bell down',
    );
    errors.mockRestore();
  });
});

describe('listMemberPersonalApiKeys — a member’s own keys, as this organization sees them', () => {
  it('lists each key with this organization’s block on it, for an Admin who may block them [APIKEY-R11]', async () => {
    const { sql } = fakeSql(
      world(
        new Map([
          [`${ORG}|key-mia`, { holder: 'mia', by: 'ada', at: 1_790_000_000 }],
          // Blocked elsewhere: here the key works.
          [`${OTHER_ORG}|key-mia-2`, { holder: 'mia', by: 'olav', at: 2 }],
        ]),
      ),
    );

    await expect(
      listMemberPersonalApiKeys(sql, {
        organizationId: ORG,
        actor: actor('ada'),
        memberUserId: 'mia',
      }),
    ).resolves.toEqual({
      keys: [
        {
          id: 'key-mia',
          name: 'CI deploy',
          start: 'tale_ab',
          prefix: null,
          suffix: 'wxyz',
          enabled: true,
          expiresAt: null,
          createdAt: CREATED.getTime(),
          blocked: { at: 1_790_000_000, by: { userId: 'ada', name: 'Ada' } },
        },
        expect.objectContaining({ id: 'key-mia-2', blocked: null }),
      ],
      canBlock: true,
      personalKeys: 'admitted',
    });
  });

  it.each<PersonalKeysStanding>(['refused', 'unavailable'])(
    'answers this organization’s standing on members’ own keys, %s, so no unblocked key passes for working here [APIKEY-R11]',
    async (standing) => {
      vi.mocked(personalKeysStandingOf).mockResolvedValueOnce(standing);
      const { sql } = fakeSql(world());

      const listed = await listMemberPersonalApiKeys(sql, {
        organizationId: ORG,
        actor: actor('ada'),
        memberUserId: 'mia',
      });
      expect(listed.personalKeys).toBe(standing);
      expect(personalKeysStandingOf).toHaveBeenCalledWith(sql, ORG);
      // Blocking stays possible: a block holds when the keys come back.
      expect(listed.canBlock).toBe(true);
      expect(listed.keys).not.toHaveLength(0);
    },
  );

  it('leaves out a key turned off or expired, which works nowhere [APIKEY-R11]', async () => {
    const { sql } = fakeSql({
      ...world(),
      keys: {
        ...KEYS,
        'key-mia-off': {
          name: 'Turned off',
          start: 'tale_cd',
          suffix: 'off1',
          holder: 'mia',
          enabled: false,
        },
        'key-mia-old': {
          name: 'Expired',
          start: 'tale_ef',
          suffix: 'old1',
          holder: 'mia',
          expiresAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        'key-mia-later': {
          name: 'Expires later',
          start: 'tale_gh',
          suffix: 'new1',
          holder: 'mia',
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        },
      },
    });

    const listed = await listMemberPersonalApiKeys(sql, {
      organizationId: ORG,
      actor: actor('ada'),
      memberUserId: 'mia',
    });
    expect(listed.keys.map((key) => key.id)).toEqual([
      'key-mia',
      'key-mia-2',
      'key-mia-later',
    ]);
  });

  it('sends no last use: the key’s last use is global and would tell of the holder’s other organizations [APIKEY-R11]', async () => {
    const { sql, statements } = fakeSql(world());

    const listed = await listMemberPersonalApiKeys(sql, {
      organizationId: ORG,
      actor: actor('ada'),
      memberUserId: 'mia',
    });
    expect(listed.keys).not.toHaveLength(0);
    for (const key of listed.keys) {
      expect(key).not.toHaveProperty('lastRequest');
    }
    expect(statements.some((s) => s.text.includes('lastRequest'))).toBe(false);
  });

  it.each([
    ['an Owner’s keys, to an Admin', 'ada', 'olav'],
    ['an Admin’s own keys', 'ada', 'ada'],
  ])(
    'shows %s, but offers no block [APIKEY-R11]',
    async (_what, viewer, holder) => {
      const { sql } = fakeSql(world());
      const listed = await listMemberPersonalApiKeys(sql, {
        organizationId: ORG,
        actor: actor(viewer),
        memberUserId: holder,
      });
      expect(listed.keys.map((key) => key.id)).toEqual([`key-${holder}`]);
      expect(listed.canBlock).toBe(false);
    },
  );

  it('lets an Owner block an Admin’s keys [APIKEY-R11]', async () => {
    const { sql } = fakeSql(world());
    await expect(
      listMemberPersonalApiKeys(sql, {
        organizationId: ORG,
        actor: actor('olav'),
        memberUserId: 'ines',
      }),
    ).resolves.toMatchObject({ canBlock: true });
  });

  it('refuses a Member, and answers a non-member as not found [APIKEY-R11]', async () => {
    const { sql } = fakeSql(world());
    await expect(
      listMemberPersonalApiKeys(sql, {
        organizationId: ORG,
        actor: actor('mia'),
        memberUserId: 'ines',
      }),
    ).rejects.toMatchObject({ code: 'API_KEY_BLOCK_FORBIDDEN', status: 403 });
    await expect(
      listMemberPersonalApiKeys(sql, {
        organizationId: ORG,
        actor: actor('ada'),
        memberUserId: 'stranger',
      }),
    ).rejects.toMatchObject({ code: 'API_KEY_MEMBER_NOT_FOUND', status: 404 });
  });
});
