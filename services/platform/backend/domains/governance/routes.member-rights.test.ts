// @vitest-environment node

/**
 * The Rights dialog's read is for owners and admins alone, who grant and
 * revoke the rights it shows; a user who is not a member is not found.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { readMemberRights, caller } = vi.hoisted(() => ({
  readMemberRights: vi.fn(),
  caller: { role: 'admin' },
}));

vi.mock('./member-rights.ts', () => ({ readMemberRights }));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: caller.role } as never);
      await next();
    },
}));

import { createGovernanceRoutes } from './routes.ts';

const RIGHTS = {
  userId: 'u2',
  role: 'member',
  rights: [
    {
      capability: 'tale:rest.act-as',
      held: false,
      grantId: null,
      reasons: [{ kind: 'role', standing: 'grant' }, { kind: 'no-grant' }],
    },
  ],
};

async function read(userId: string): Promise<Response> {
  return await createGovernanceRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request(`/members/${encodeURIComponent(userId)}/rights`);
}

beforeEach(() => {
  caller.role = 'admin';
  readMemberRights.mockReset().mockResolvedValue(RIGHTS);
});

describe('GET /members/:userId/rights [GOV-R21]', () => {
  it.each(['owner', 'admin'])(
    'answers an %s the member’s rights',
    async (role) => {
      caller.role = role;
      const res = await read('u2');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(RIGHTS);
      expect(readMemberRights).toHaveBeenCalledWith(
        {},
        { organizationId: 'o1', userId: 'u2' },
      );
    },
  );

  it.each(['developer', 'editor', 'member', 'disabled'])(
    'refuses a %s before reading anything',
    async (role) => {
      caller.role = role;
      const res = await read('u2');
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'FORBIDDEN' });
      expect(readMemberRights).not.toHaveBeenCalled();
    },
  );

  it('answers MEMBER_NOT_FOUND for a user who is not a member', async () => {
    readMemberRights.mockResolvedValueOnce(null);
    const res = await read('stranger');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'MEMBER_NOT_FOUND' });
  });
});
