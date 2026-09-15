// @vitest-environment node

/**
 * The credit request's AUDIENCE: a member who hit a usage limit asks the
 * people who can raise it — each owner and admin gets one personal row
 * pointing at the budget rules — and nobody else. It used to write an
 * org-wide `system` notification every member's bell shows, announcing one
 * colleague's exhausted budget to the whole organization.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthEnv } from '../../auth/session.ts';

const { notifyUser, requireOrganizationMember, caller } = vi.hoisted(() => ({
  notifyUser: vi.fn(),
  requireOrganizationMember: vi.fn(),
  caller: { id: 'user-member', name: 'Sam Rivera', email: 'sam@example.test' },
}));

vi.mock('../collab/service.ts', () => ({ notifyUser }));

vi.mock('../../auth/membership.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/membership.ts')>()),
  requireOrganizationMember,
}));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<AuthEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', { user: { ...caller } } as never);
      await next();
    },
}));

import { MembershipError } from '../../auth/membership.ts';
import {
  createOrganizationRoutes,
  USAGE_CREDITS_REQUESTED_NOTIFICATION_TYPE,
} from './routes.ts';

const ORG_ID = 'org-1';
const TX = { tx: true };

/** The recipient read answers `recipients`; `begin` runs its callback on a
 * marker transaction so the writes can be seen to share it. */
function database(recipients: string[]) {
  const queries: { text: string; values: unknown[] }[] = [];
  const sql = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({ text: strings.join('?'), values });
      return recipients.map((userId) => ({ userId }));
    },
    {
      begin: async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(TX),
    },
  );
  return { sql: sql as never, queries };
}

async function requestCredits(sql: never): Promise<Response> {
  return await createOrganizationRoutes({
    sql,
    auth: {} as never,
  }).request(`/${ORG_ID}/request-credits`, { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOrganizationMember.mockResolvedValue({ role: 'member' });
  notifyUser.mockResolvedValue(undefined);
  caller.name = 'Sam Rivera';
});

describe('POST /:id/request-credits', () => {
  it('writes one personal row per owner and admin, none org-wide', async () => {
    const { sql, queries } = database(['user-owner', 'user-admin']);

    const response = await requestCredits(sql);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    // The audience read asks for owners and admins other than the caller.
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toContain(`"role" IN ('owner', 'admin')`);
    expect(queries[0]?.values).toEqual([ORG_ID, caller.id]);
    expect(notifyUser).toHaveBeenCalledTimes(2);
    for (const [index, recipient] of ['user-owner', 'user-admin'].entries()) {
      expect(notifyUser).toHaveBeenNthCalledWith(index + 1, TX, {
        userId: recipient,
        organizationId: ORG_ID,
        type: USAGE_CREDITS_REQUESTED_NOTIFICATION_TYPE,
        titleKey: 'usageCreditsRequested',
        bodyKey: 'usageCreditsRequestedBody',
        params: { name: 'Sam Rivera', budgets: true },
        resourceType: 'member',
        resourceId: caller.id,
        actorType: 'user',
        actorId: caller.id,
      });
    }
  });

  it('does not claim it asked when nobody else can grant credits', async () => {
    const { sql } = database([]);

    const response = await requestCredits(sql);

    expect(await response.json()).toEqual({ ok: false });
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('refuses a caller outside the organization before reading anyone', async () => {
    requireOrganizationMember.mockRejectedValue(
      new MembershipError('not a member', 'ORG_FORBIDDEN'),
    );
    const { sql, queries } = database(['user-owner']);

    const response = await requestCredits(sql);

    expect(response.status).toBe(403);
    expect(queries).toEqual([]);
    expect(notifyUser).not.toHaveBeenCalled();
  });
});
