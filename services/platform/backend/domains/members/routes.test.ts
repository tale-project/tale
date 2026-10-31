import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { lookupMembers, caller } = vi.hoisted(() => ({
  lookupMembers: vi.fn(),
  caller: { orgId: 'org-acme', role: 'member' },
}));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  lookupMembers,
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'user-mia', email: 'mia@acme.example', name: 'Mia' },
        session: { id: 'session-mia' },
      } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', () => ({
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', caller.orgId);
      c.set('orgMember', { role: caller.role } as never);
      await next();
    },
}));

import { createMemberRoutes } from './routes.ts';

const app = createMemberRoutes({ sql: {} as never, auth: {} as never });

const noah = {
  id: 'member-noah',
  userId: 'user-noah',
  role: 'member',
  createdAt: '2026-01-01 09:00:00+00',
  displayName: 'Noah Berg',
  email: 'noah@acme.example',
};

describe('GET /lookup [MEMBER-R11]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    caller.role = 'member';
    lookupMembers.mockResolvedValue([noah]);
  });

  it('answers any member with the members their organization names [MEMBER-R11]', async () => {
    const response = await app.request(
      '/lookup?orgId=org-acme&userIds=user-noah,%20user-noah,,user-ada&handles=Noah.Berg',
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ members: [noah] });
    expect(lookupMembers).toHaveBeenCalledWith(expect.anything(), 'org-acme', {
      userIds: ['user-noah', 'user-ada'],
      handles: ['noah.berg'],
    });
  });

  it('answers an empty lookup with no one [MEMBER-R11]', async () => {
    lookupMembers.mockResolvedValue([]);

    const response = await app.request('/lookup?orgId=org-acme');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ members: [] });
    expect(lookupMembers).toHaveBeenCalledWith(expect.anything(), 'org-acme', {
      userIds: [],
      handles: [],
    });
  });

  it.each([
    ['a handle no mention could name', 'handles=noah%20berg'],
    ['a handle with a letter no mention can hold', 'handles=no%C3%A4h'],
    ['a value longer than 100 characters', `userIds=${'u'.repeat(101)}`],
    [
      'more than 100 user ids and handles together',
      `userIds=${Array.from({ length: 60 }, (_, i) => `user-${i}`).join(',')}&handles=${Array.from({ length: 41 }, (_, i) => `h${i}`).join(',')}`,
    ],
  ])('refuses %s, asking nothing (400) [MEMBER-R11]', async (_case, query) => {
    const response = await app.request(`/lookup?orgId=org-acme&${query}`);

    expect(response.status).toBe(400);
    expect(lookupMembers).not.toHaveBeenCalled();
  });

  it('takes exactly 100 user ids and handles together [MEMBER-R11]', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `user-${i}`);
    const handles = Array.from({ length: 40 }, (_, i) => `h${i}`);

    const response = await app.request(
      `/lookup?orgId=org-acme&userIds=${ids.join(',')}&handles=${handles.join(',')}`,
    );

    expect(response.status).toBe(200);
    expect(lookupMembers).toHaveBeenCalledWith(expect.anything(), 'org-acme', {
      userIds: ids,
      handles,
    });
  });
});
