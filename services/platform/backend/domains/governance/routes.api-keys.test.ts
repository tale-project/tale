// @vitest-environment node

/**
 * The budget editor's per-key picker. An admin capping spend must be able to
 * pick any member's API key, not only their own (the auth store's own key
 * listing answers the caller's keys alone). The listing is admin-only like
 * the budget rules, scoped to this organization's members, and never carries
 * a secret.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const caller = vi.hoisted(() => ({ role: 'admin' }));

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

import { createGovernanceRoutes } from './routes.ts';

/** A `sql` double recording each query's text and bound values. */
function fakeSql(rows: unknown[]) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join('?'), values });
    return Promise.resolve(rows);
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

beforeEach(() => {
  caller.role = 'admin';
});

describe('GET /api-keys', () => {
  it('lists the keys of this organization’s members, masked, for an admin', async () => {
    const { sql, queries } = fakeSql([KEY_ROW]);
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
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/"key":/);
    // Scoped to this organization's members; the secret column is never read.
    const read = queries[0];
    expect(read?.text).toContain('FROM "apikey" k');
    expect(read?.text).toContain('JOIN "member" m');
    expect(read?.values).toContain('org-1');
    expect(read?.text).not.toMatch(/k\."key"/);
  });

  it.each(['member', 'editor', 'developer'])('refuses a %s', async (role) => {
    caller.role = role;
    const { sql, queries } = fakeSql([KEY_ROW]);
    const res = await createGovernanceRoutes({
      sql,
      auth: {} as never,
    } as never).request('/api-keys');
    expect(res.status).toBe(403);
    expect(queries).toHaveLength(0);
  });
});
