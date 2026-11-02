// @vitest-environment node
import type { Context } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

/**
 * What the member list tells about how members sign in [MEMBER-R6]. Every
 * member reads the list (the pickers name people from it), but whether a
 * member uses two-factor authentication and how many passkeys they hold is
 * answered only when the role the org gate enforces on the request is an
 * owner or an admin. Pinned at the route against a list whose every row
 * carries both fields: for any other role the keys are absent, not `false`
 * or `0`, which would say something untrue.
 */

const caller = vi.hoisted(() => ({ role: 'member' }));

const list = vi.hoisted(() => ({
  rows: [
    {
      id: 'member-ada',
      organizationId: 'org-acme',
      userId: 'user-ada',
      role: 'owner',
      createdAt: '2026-01-05T09:00:00.000Z',
      displayName: 'Ada',
      email: 'ada@example.test',
      twoFactorEnabled: true,
      passkeyCount: 2,
    },
    {
      id: 'member-noah',
      organizationId: 'org-acme',
      userId: 'user-noah',
      role: 'member',
      createdAt: '2026-02-11T14:30:00.000Z',
      displayName: null,
      email: 'noah@example.test',
      twoFactorEnabled: false,
      passkeyCount: 0,
    },
  ],
}));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'user-mia', email: 'mia@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    // The role the gate enforces: a trusted-headers session's asserted
    // role arrives here the same way as a seat's.
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'org-acme');
        c.set('orgMember', { role: caller.role } as never);
        await next();
      },
  };
});

vi.mock('./service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service.ts')>();
  return {
    ...actual,
    listByOrganization: vi.fn(async () => structuredClone(list.rows)),
  };
});

import { createMemberRoutes } from './routes.ts';

const SIGN_IN_FACTORS = ['twoFactorEnabled', 'passkeyCount'];

async function listAs(role: string): Promise<Record<string, unknown>[]> {
  caller.role = role;
  const app = createMemberRoutes({ sql: {} as never, auth: {} as never });
  const res = await app.request('/?orgId=org-acme');
  expect(res.status).toBe(200);
  const body = (await res.json()) as { members: Record<string, unknown>[] };
  return body.members;
}

describe('GET /api/app/members', () => {
  it.each(['member', 'editor', 'developer'])(
    'leaves how members sign in out of the list for the %s role [MEMBER-R6]',
    async (role) => {
      const members = await listAs(role);

      for (const member of members) {
        for (const key of SIGN_IN_FACTORS) {
          expect(member).not.toHaveProperty(key);
        }
      }
      // The rest of every row is still there, for every screen that names
      // people from the list.
      expect(members).toEqual(
        list.rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).filter(
              ([key]) => !SIGN_IN_FACTORS.includes(key),
            ),
          ),
        ),
      );
    },
  );

  it.each(['admin', 'owner'])(
    'tells the %s role how every member of the list signs in [MEMBER-R6]',
    async (role) => {
      const members = await listAs(role);

      for (const member of members) {
        for (const key of SIGN_IN_FACTORS) {
          expect(member).toHaveProperty(key);
        }
      }
      expect(members).toEqual(list.rows);
    },
  );
});
