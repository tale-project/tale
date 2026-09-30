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

interface Tables {
  /** `listOrgApiKeys`: the live keys of the organization's members. */
  live?: unknown[];
  /** `describeRuleApiKeys`: the named keys that still exist. */
  held?: unknown[];
  /** The organization's `api_key.created` audit rows for the named keys. */
  created?: unknown[];
  /** The holders' accounts. */
  users?: unknown[];
}

/** A `sql` double answering each read by the table it selects from, and
 * recording each query's text and bound values. */
function fakeSql(tables: Tables) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    queries.push({ text, values });
    if (text.includes('FROM app.audit_logs')) {
      return Promise.resolve(tables.created ?? []);
    }
    if (text.includes('FROM "user"'))
      return Promise.resolve(tables.users ?? []);
    if (text.includes('LEFT JOIN "member" m')) {
      return Promise.resolve(tables.held ?? []);
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
      held: [
        {
          id: 'key-expired',
          name: 'Nightly export',
          start: 'tale_Ex',
          enabled: true,
          expired: true,
          expiresAt: new Date('2026-09-20T00:00:00Z'),
          holderId: 'u-anna',
          holderIsMember: true,
        },
      ],
      created: [
        {
          id: 'key-revoked',
          actorId: 'u-ben',
          actorEmail: 'ben@example.test',
          name: 'opencode laptop',
          start: 'tale_Rv',
        },
      ],
      users: [
        { id: 'u-anna', name: 'Anna', email: 'anna@example.test' },
        { id: 'u-ben', name: 'Ben', email: 'ben@example.test' },
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
  const HELD = {
    name: 'Desk script',
    start: 'tale_Ds',
    enabled: true,
    expired: false,
    expiresAt: null,
    holderId: 'u-cara',
    holderIsMember: true,
  };
  const CARA = { id: 'u-cara', name: 'Cara', email: 'cara@example.test' };

  it('reads nothing when no rule names a key outside the listing', async () => {
    const { sql, queries } = fakeSql({});
    await expect(describeRuleApiKeys(sql, 'org-1', [])).resolves.toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it.each([
    ['disabled', { enabled: false }],
    ['expired', { expired: true }],
    // A disabled key that also expired is first of all switched off.
    ['disabled', { enabled: false, expired: true }],
    // A live key the listing's bound cut off still reads as live.
    ['active', {}],
  ])('reads a member’s key as %s', async (status, state) => {
    const { sql } = fakeSql({
      held: [{ ...HELD, ...state, id: 'key-a' }],
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

  it('names the holder who left from the audit trail, and no one else', async () => {
    // Both keys exist and neither holder is a member. The organization's
    // audit trail recorded the first being created here — and that record is
    // all it says: not what the key was renamed to or when it expires now,
    // not the person's current profile (the member query answers no one).
    // Of the second it knows nothing, so a rule naming it must not reveal
    // that it exists, what it is called or whose it is.
    const { sql, queries } = fakeSql({
      held: [
        {
          ...HELD,
          id: 'key-left',
          name: 'Renamed after leaving',
          expiresAt: new Date('2027-06-01T00:00:00Z'),
          holderIsMember: false,
        },
        {
          ...HELD,
          id: 'key-elsewhere',
          name: 'Someone else’s key',
          holderId: 'u-stranger',
          holderIsMember: false,
        },
      ],
      created: [
        {
          id: 'key-left',
          actorId: 'u-cara',
          actorEmail: 'cara@example.test',
          name: 'Desk script',
          start: 'tale_Ds',
        },
      ],
      users: [],
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

  it('keeps the audit row’s address for a holder whose account is gone', async () => {
    const { sql } = fakeSql({
      created: [
        {
          id: 'key-gone',
          actorId: 'u-erased',
          actorEmail: 'erased@example.test',
          name: 'Old export',
          start: 'tale_Oe',
        },
      ],
      users: [],
    });
    const [key] = await describeRuleApiKeys(sql, 'org-1', ['key-gone']);
    expect(key).toMatchObject({
      status: 'revoked',
      name: 'Old export',
      userId: 'u-erased',
      ownerName: null,
      ownerEmail: 'erased@example.test',
    });
  });

  it('looks each key up once however many rules name it', async () => {
    const { sql, queries } = fakeSql({ held: [{ ...HELD, id: 'key-a' }] });
    const keys = await describeRuleApiKeys(sql, 'org-1', [
      'key-a',
      'key-a',
      'key-a',
    ]);
    expect(keys).toHaveLength(1);
    expect(queries[0]?.values).toEqual(['org-1', ['key-a']]);
  });
});
