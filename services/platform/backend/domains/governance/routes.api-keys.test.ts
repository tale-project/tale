// @vitest-environment node

/**
 * The budget editor's per-key listing. An admin capping spend must be able to
 * pick any member's API key, not only their own (the auth store's own key
 * listing answers the caller's keys alone), and must be able to read every
 * rule that already exists: a rule stores the key's bare id and outlives the
 * key, so the listing also describes the keys the saved rules name that are
 * no longer live. It is admin-only like the budget rules, scoped to this
 * organization, and never carries a secret.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const caller = vi.hoisted(() => ({ role: 'admin' }));
const { readGovernancePolicyForOrg } = vi.hoisted(() => ({
  readGovernancePolicyForOrg: vi.fn(),
}));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u-admin', email: 'admin@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'org-1');
        c.set('orgMember', { role: caller.role } as never);
        await next();
      },
  };
});

vi.mock('../../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/org-config.ts')>()),
  readGovernancePolicyForOrg,
}));

import { describeRuleApiKeys } from './api-keys.ts';
import { createGovernanceRoutes } from './routes.ts';

/** A key row in the auth store — every organization's, as the database
 * holds them. */
interface AuthKey {
  id: string;
  name: string | null;
  start: string | null;
  enabled: boolean;
  expiresAt: Date | null;
  referenceId: string;
}

/** One row of this organization's API-key audit trail. */
interface KeyAuditRow {
  resourceId: string;
  action: 'api_key.created' | 'api_key.revoked';
  actorId: string;
  actorEmail: string | null;
  name: string | null;
  start: string | null;
}

interface Tables {
  /** `listOrgApiKeys`: the live keys of the organization's members. */
  live?: unknown[];
  /** The auth store's key rows, whoever holds them. */
  apikeys?: AuthKey[];
  /** Who is a member of `org-1` now. */
  members?: string[];
  /** `org-1`'s API-key audit trail. */
  audit?: KeyAuditRow[];
  /** The deployment's accounts. */
  users?: Array<{ id: string; name: string | null; email: string | null }>;
}

/**
 * A `sql` double over a small model of the tables, recording each query's
 * text and bound values. It answers each read as the database would answer
 * its SQL — a key-row read through an inner join on `member` sees current
 * members' keys only, through a left join every key — so what a description
 * may depend on is decided by the query, not by the fixture.
 */
function fakeSql(tables: Tables) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const members = new Set(tables.members ?? []);
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    queries.push({ text, values });
    const ids = new Set(
      (values.find((value) => Array.isArray(value)) as string[] | undefined) ??
        [],
    );
    if (text.includes('FROM app.audit_logs')) {
      const trail = (tables.audit ?? []).filter((row) =>
        ids.has(row.resourceId),
      );
      const created = new Map<string, KeyAuditRow>();
      for (const row of trail) {
        if (row.action === 'api_key.created') created.set(row.resourceId, row);
      }
      return Promise.resolve(
        [...created.values()].map((row) => ({
          id: row.resourceId,
          actorId: row.actorId,
          actorEmail: row.actorEmail,
          name: row.name,
          start: row.start,
          revoked: trail.some(
            (other) =>
              other.resourceId === row.resourceId &&
              other.action === 'api_key.revoked',
          ),
        })),
      );
    }
    if (text.includes('FROM "user"')) {
      return Promise.resolve(
        (tables.users ?? []).filter(
          (user) => ids.has(user.id) && members.has(user.id),
        ),
      );
    }
    if (text.includes('k."id" = ANY(')) {
      const innerJoin = !text.includes('LEFT JOIN "member"');
      return Promise.resolve(
        (tables.apikeys ?? [])
          .filter((key) => ids.has(key.id))
          .filter((key) => !innerJoin || members.has(key.referenceId))
          .map((key) => ({
            id: key.id,
            name: key.name,
            start: key.start,
            enabled: key.enabled,
            expired:
              key.expiresAt !== null && key.expiresAt.getTime() <= Date.now(),
            expiresAt: key.expiresAt,
            holderId: key.referenceId,
            holderIsMember: members.has(key.referenceId),
          })),
      );
    }
    return Promise.resolve(tables.live ?? []);
  };
  return { sql: sql as never, queries };
}

const KEY_ROW = {
  id: 'key-1',
  name: 'opencode – Anna',
  start: 'tale_Ab',
  userId: 'u-anna',
  ownerName: 'Anna',
  ownerEmail: 'anna@example.test',
  createdAt: new Date('2026-09-01T00:00:00Z'),
  expiresAt: null,
};

const EXPIRING_ROW = {
  id: 'key-2',
  name: null,
  start: 'tale_Cd',
  userId: 'u-ben',
  ownerName: null,
  ownerEmail: 'ben@example.test',
  createdAt: new Date('2026-09-02T00:00:00Z'),
  expiresAt: new Date('2027-01-01T00:00:00Z'),
};

function budgets(...apiKeyIds: string[]) {
  return {
    enabled: true,
    rules: [
      { scope: 'default', period: 'monthly', maxCostCents: 5000 },
      ...apiKeyIds.map((apiKeyId) => ({
        scope: 'apiKey',
        apiKeyId,
        period: 'monthly',
        maxCostCents: 1000,
      })),
    ],
  };
}

beforeEach(() => {
  caller.role = 'admin';
  readGovernancePolicyForOrg.mockReset();
  readGovernancePolicyForOrg.mockResolvedValue(null);
});

describe('GET /api-keys', () => {
  it.each(['admin', 'owner'])(
    'lists the keys of this organization’s members, masked, for an %s',
    async (role) => {
      caller.role = role;
      const { sql, queries } = fakeSql({ live: [KEY_ROW, EXPIRING_ROW] });
      const res = await createGovernanceRoutes({
        sql,
        auth: {} as never,
      } as never).request('/api-keys');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        keys: [
          {
            id: 'key-1',
            name: 'opencode – Anna',
            start: 'tale_Ab',
            userId: 'u-anna',
            ownerName: 'Anna',
            ownerEmail: 'anna@example.test',
            createdAt: Date.parse('2026-09-01T00:00:00Z'),
            expiresAt: null,
          },
          {
            id: 'key-2',
            name: null,
            start: 'tale_Cd',
            userId: 'u-ben',
            ownerName: null,
            ownerEmail: 'ben@example.test',
            createdAt: Date.parse('2026-09-02T00:00:00Z'),
            expiresAt: Date.parse('2027-01-01T00:00:00Z'),
          },
        ],
        // No saved rule names a key outside the listing.
        ruleKeys: [],
      });
      expect(JSON.stringify(body)).not.toMatch(/"key":/);
      // Scoped to this organization's members; the secret column is never read.
      const read = queries[0];
      expect(read?.text).toContain('FROM "apikey" k');
      expect(read?.text).toContain('JOIN "member" m');
      expect(read?.values).toContain('org-1');
      expect(read?.text).not.toMatch(/k\."key"/);
      // Only keys that can still spend: neither disabled nor expired.
      expect(read?.text).toContain('k."enabled" IS NOT FALSE');
      expect(read?.text).toContain('k."expiresAt" > now()');
      // Nothing to describe, so nothing more is read.
      expect(queries).toHaveLength(1);
    },
  );

  it('describes the keys the saved rules name that are no longer live', async () => {
    // A rule on a live key (listed above) and on three that are not: one
    // expired, one its owner deleted, one the organization never saw.
    readGovernancePolicyForOrg.mockResolvedValue(
      budgets('key-1', 'key-expired', 'key-revoked', 'key-foreign'),
    );
    const { sql, queries } = fakeSql({
      live: [KEY_ROW],
      apikeys: [
        {
          id: 'key-expired',
          name: 'Nightly export',
          start: 'tale_Ex',
          enabled: true,
          expiresAt: new Date('2026-09-20T00:00:00Z'),
          referenceId: 'u-anna',
        },
        // Another organization's key: it exists, and none of it may show.
        {
          id: 'key-foreign',
          name: 'Someone else’s key',
          start: 'tale_Fo',
          enabled: true,
          expiresAt: null,
          referenceId: 'u-stranger',
        },
      ],
      members: ['u-anna', 'u-ben'],
      audit: [
        {
          resourceId: 'key-revoked',
          action: 'api_key.created',
          actorId: 'u-ben',
          actorEmail: 'ben@example.test',
          name: 'opencode laptop',
          start: 'tale_Rv',
        },
        {
          resourceId: 'key-revoked',
          action: 'api_key.revoked',
          actorId: 'u-ben',
          actorEmail: 'ben@example.test',
          name: null,
          start: null,
        },
      ],
      users: [
        { id: 'u-anna', name: 'Anna', email: 'anna@example.test' },
        { id: 'u-ben', name: 'Ben', email: 'ben@example.test' },
        { id: 'u-stranger', name: 'Stranger', email: 'stranger@example.test' },
      ],
    });
    const res = await createGovernanceRoutes({
      sql,
      auth: {} as never,
    } as never).request('/api-keys');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ruleKeys).toEqual([
      {
        id: 'key-expired',
        name: 'Nightly export',
        start: 'tale_Ex',
        userId: 'u-anna',
        ownerName: 'Anna',
        ownerEmail: 'anna@example.test',
        status: 'expired',
        expiresAt: Date.parse('2026-09-20T00:00:00Z'),
      },
      {
        id: 'key-revoked',
        name: 'opencode laptop',
        start: 'tale_Rv',
        userId: 'u-ben',
        ownerName: 'Ben',
        ownerEmail: 'ben@example.test',
        status: 'revoked',
        expiresAt: null,
      },
      {
        id: 'key-foreign',
        name: null,
        start: null,
        userId: null,
        ownerName: null,
        ownerEmail: null,
        status: 'unknown',
        expiresAt: null,
      },
    ]);
    expect(readGovernancePolicyForOrg).toHaveBeenCalledWith(
      sql,
      'org-1',
      'budgets',
    );
    // The live key is already listed: only the other three are looked up,
    // and only inside this organization. The secret column is never read.
    const lookups = queries.slice(1);
    expect(lookups[0]?.values).toEqual([
      'org-1',
      ['key-expired', 'key-revoked', 'key-foreign'],
    ]);
    expect(lookups[1]?.text).toContain("action = 'api_key.created'");
    expect(lookups[1]?.values).toContain('org-1');
    for (const lookup of lookups) {
      expect(lookup.text).not.toMatch(/k\."key"/);
    }
    expect(JSON.stringify(body)).not.toMatch(/"key":/);
  });

  it.each(['member', 'editor', 'developer'])('refuses a %s', async (role) => {
    caller.role = role;
    const { sql, queries } = fakeSql({ live: [KEY_ROW] });
    const res = await createGovernanceRoutes({
      sql,
      auth: {} as never,
    } as never).request('/api-keys');
    expect(res.status).toBe(403);
    expect(queries).toHaveLength(0);
    expect(readGovernancePolicyForOrg).not.toHaveBeenCalled();
  });
});

describe('describeRuleApiKeys', () => {
  /** A key Cara created while a member: the trail's `api_key.created`. */
  const CREATED: KeyAuditRow = {
    resourceId: 'key-a',
    action: 'api_key.created',
    actorId: 'u-cara',
    actorEmail: 'cara@example.test',
    name: 'Desk script',
    start: 'tale_Ds',
  };
  const KEY: AuthKey = {
    id: 'key-a',
    name: 'Desk script',
    start: 'tale_Ds',
    enabled: true,
    expiresAt: null,
    referenceId: 'u-cara',
  };
  const CARA = { id: 'u-cara', name: 'Cara', email: 'cara@example.test' };

  it('reads nothing when no rule names a key outside the listing', async () => {
    const { sql, queries } = fakeSql({});
    await expect(describeRuleApiKeys(sql, 'org-1', [])).resolves.toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it.each([
    ['disabled', { enabled: false }],
    ['expired', { expiresAt: new Date('2026-09-20T00:00:00Z') }],
    // A disabled key that also expired is first of all switched off.
    [
      'disabled',
      { enabled: false, expiresAt: new Date('2026-09-20T00:00:00Z') },
    ],
    // A live key the listing's bound cut off still reads as live.
    ['active', {}],
  ])('reads a member’s key as %s', async (status, state) => {
    const { sql } = fakeSql({
      apikeys: [{ ...KEY, ...state }],
      members: ['u-cara'],
      users: [CARA],
    });
    const [key] = await describeRuleApiKeys(sql, 'org-1', ['key-a']);
    expect(key).toMatchObject({
      id: 'key-a',
      name: 'Desk script',
      userId: 'u-cara',
      ownerName: 'Cara',
      status,
    });
  });

  it('asks the auth store about current members’ keys only', async () => {
    const { sql, queries } = fakeSql({});
    await describeRuleApiKeys(sql, 'org-1', ['key-a']);
    const read = queries.find((query) => query.text.includes('FROM "apikey"'));
    expect(read?.text).toContain('JOIN "member" m');
    expect(read?.text).not.toContain('LEFT JOIN');
    expect(read?.values).toEqual(['org-1', ['key-a']]);
  });

  it('names the holder who left from the audit trail, and no one else', async () => {
    // Both keys exist and neither holder is a member. The organization's
    // audit trail recorded the first being created here — and that record is
    // all it says: not what the key was renamed to or when it expires now,
    // not the person's current profile (the member query answers no one).
    // Of the second it knows nothing, so a rule naming it must not reveal
    // that it exists, what it is called or whose it is.
    const { sql, queries } = fakeSql({
      apikeys: [
        {
          ...KEY,
          id: 'key-left',
          name: 'Renamed after leaving',
          expiresAt: new Date('2027-06-01T00:00:00Z'),
        },
        {
          ...KEY,
          id: 'key-elsewhere',
          name: 'Someone else’s key',
          referenceId: 'u-stranger',
        },
      ],
      members: [],
      audit: [{ ...CREATED, resourceId: 'key-left' }],
      users: [CARA, { id: 'u-stranger', name: 'Stranger', email: null }],
    });
    const keys = await describeRuleApiKeys(sql, 'org-1', [
      'key-left',
      'key-elsewhere',
    ]);
    expect(keys).toEqual([
      {
        id: 'key-left',
        name: 'Desk script',
        start: 'tale_Ds',
        userId: 'u-cara',
        ownerName: null,
        ownerEmail: 'cara@example.test',
        status: 'holder_left',
        expiresAt: null,
      },
      {
        id: 'key-elsewhere',
        name: null,
        start: null,
        userId: null,
        ownerName: null,
        ownerEmail: null,
        status: 'unknown',
        expiresAt: null,
      },
    ]);
    // Only the holder this organization may name is looked up, and only
    // among its current members.
    expect(queries.at(-1)?.text).toContain('JOIN "member" m');
    expect(queries.at(-1)?.values).toEqual(['org-1', ['u-cara']]);
  });

  it('answers the same for a holder who left whether or not they deleted the key since', async () => {
    // Identical history here: Cara created the key as a member, then left.
    // Deleting it afterwards happened elsewhere — its revoke row landed in
    // the organizations she belongs to now, not this one — so nothing this
    // organization may see changed, and neither may its answer.
    const history = {
      members: [],
      audit: [CREATED],
      users: [CARA],
    };
    const kept = fakeSql({ ...history, apikeys: [KEY] });
    const deleted = fakeSql({ ...history, apikeys: [] });
    const whileKept = await describeRuleApiKeys(kept.sql, 'org-1', ['key-a']);
    const afterDeletion = await describeRuleApiKeys(deleted.sql, 'org-1', [
      'key-a',
    ]);
    expect(afterDeletion).toEqual(whileKept);
    expect(whileKept).toEqual([
      {
        id: 'key-a',
        name: 'Desk script',
        start: 'tale_Ds',
        userId: 'u-cara',
        ownerName: null,
        ownerEmail: 'cara@example.test',
        status: 'holder_left',
        expiresAt: null,
      },
    ]);
  });

  it('reads a key its holder revoked while a member as revoked, before and after they leave', async () => {
    const revokedHere: KeyAuditRow = {
      ...CREATED,
      action: 'api_key.revoked',
      name: null,
      start: null,
    };
    const stillMember = fakeSql({
      members: ['u-cara'],
      audit: [CREATED, revokedHere],
      users: [CARA],
    });
    const left = fakeSql({ members: [], audit: [CREATED, revokedHere] });
    const [asMember] = await describeRuleApiKeys(stillMember.sql, 'org-1', [
      'key-a',
    ]);
    const [afterLeaving] = await describeRuleApiKeys(left.sql, 'org-1', [
      'key-a',
    ]);
    expect(asMember).toMatchObject({
      status: 'revoked',
      name: 'Desk script',
      ownerName: 'Cara',
    });
    expect(afterLeaving).toMatchObject({
      status: 'revoked',
      name: 'Desk script',
      userId: 'u-cara',
      ownerName: null,
      ownerEmail: 'cara@example.test',
    });
  });

  it('reads a key a member created and no longer holds as revoked', async () => {
    // Cara is a member, so her keys are this organization's to see: one she
    // made here and no longer holds is gone, whether or not the trail kept
    // its revoke (she deleted it while away, or the audit write failed).
    const { sql } = fakeSql({
      members: ['u-cara'],
      audit: [CREATED],
      users: [CARA],
    });
    const [key] = await describeRuleApiKeys(sql, 'org-1', ['key-a']);
    expect(key).toMatchObject({ status: 'revoked', ownerName: 'Cara' });
  });

  it('keeps the audit row’s address for a holder whose account is gone', async () => {
    // An erased account leaves no member row and no revoke in this trail:
    // it reads as a holder who left, named by the address recorded here.
    const { sql } = fakeSql({
      audit: [
        {
          ...CREATED,
          resourceId: 'key-gone',
          actorId: 'u-erased',
          actorEmail: 'erased@example.test',
          name: 'Old export',
          start: 'tale_Oe',
        },
      ],
    });
    const [key] = await describeRuleApiKeys(sql, 'org-1', ['key-gone']);
    expect(key).toMatchObject({
      status: 'holder_left',
      name: 'Old export',
      userId: 'u-erased',
      ownerName: null,
      ownerEmail: 'erased@example.test',
    });
  });

  it('looks each key up once however many rules name it', async () => {
    const { sql, queries } = fakeSql({
      apikeys: [KEY],
      members: ['u-cara'],
    });
    const keys = await describeRuleApiKeys(sql, 'org-1', [
      'key-a',
      'key-a',
      'key-a',
    ]);
    expect(keys).toHaveLength(1);
    expect(queries[0]?.values).toEqual(['org-1', ['key-a']]);
  });
});
