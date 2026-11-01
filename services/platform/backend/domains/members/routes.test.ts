import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const {
  lookupMembers,
  searchMembers,
  getProjectAuthContext,
  readableProjectTeamIds,
  caller,
} = vi.hoisted(() => ({
  lookupMembers: vi.fn(),
  searchMembers: vi.fn(),
  getProjectAuthContext: vi.fn(),
  readableProjectTeamIds: vi.fn(),
  caller: { orgId: 'org-acme', role: 'member' },
}));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  lookupMembers,
  searchMembers,
}));
vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  getProjectAuthContext,
  readableProjectTeamIds,
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

import { ProjectError } from '../projects/service.ts';
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

describe('GET /search [MEMBER-R12]', () => {
  const miaAuth = {
    organizationId: 'org-acme',
    userId: 'user-mia',
    role: 'member',
    teamIds: ['team-design'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    caller.role = 'member';
    searchMembers.mockResolvedValue({ members: [noah], next: null });
    getProjectAuthContext.mockResolvedValue(miaAuth);
    readableProjectTeamIds.mockResolvedValue(['team-design']);
  });

  it('answers any member with one page of the members whose name or email holds the text [MEMBER-R12]', async () => {
    const response = await app.request(
      '/search?orgId=org-acme&q=%20Noah%20%20%20Berg%20',
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      members: [noah],
      isDone: true,
      continueCursor: '',
    });
    // Every member, the disabled too, when no access is asked for: the
    // board's assignee filter still names a disabled assignee.
    expect(searchMembers).toHaveBeenCalledWith(expect.anything(), 'org-acme', {
      query: 'Noah Berg',
      limit: 50,
      cursor: null,
    });
    expect(getProjectAuthContext).not.toHaveBeenCalled();
  });

  it('hands out where the page ends, and reads on from it [MEMBER-R12]', async () => {
    searchMembers.mockResolvedValue({
      members: [noah],
      next: { at: 1767258000000, id: 'member-noah' },
    });

    const first = await app.request('/search?orgId=org-acme&limit=1');

    expect(await first.json()).toEqual({
      members: [noah],
      isDone: false,
      continueCursor: '1767258000000:member-noah',
    });

    const next = await app.request(
      '/search?orgId=org-acme&limit=1&cursor=1767258000000:member-noah',
    );

    expect(next.status).toBe(200);
    expect(searchMembers).toHaveBeenLastCalledWith(
      expect.anything(),
      'org-acme',
      {
        query: '',
        limit: 1,
        cursor: { at: 1767258000000, id: 'member-noah' },
      },
    );
  });

  it.each([
    ['500', 100],
    ['0', 1],
    ['', 50],
  ])(
    'reads a page of at most 100 members (limit=%s reads %i) [MEMBER-R12]',
    async (limit, read) => {
      await app.request(`/search?orgId=org-acme&limit=${limit}`);

      expect(searchMembers).toHaveBeenCalledWith(
        expect.anything(),
        'org-acme',
        expect.objectContaining({ limit: read }),
      );
    },
  );

  it.each([
    ['a cursor the search did not answer', 'cursor=page-two'],
    ['a text over 200 characters', `q=${'n'.repeat(201)}`],
    ['an access the search does not know', 'access=admin'],
    ['an empty project id', 'projectId='],
  ])('refuses %s, asking nothing (400) [MEMBER-R12]', async (_case, query) => {
    const response = await app.request(`/search?orgId=org-acme&${query}`);

    expect(response.status).toBe(400);
    expect(searchMembers).not.toHaveBeenCalled();
  });

  it('answers the cursor it did not answer with INVALID_CURSOR [MEMBER-R12]', async () => {
    const response = await app.request(
      '/search?orgId=org-acme&cursor=1.5:member-noah',
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'INVALID_CURSOR' });
  });

  it('takes a text of exactly 200 characters [MEMBER-R12]', async () => {
    const response = await app.request(
      `/search?orgId=org-acme&q=${'n'.repeat(200)}`,
    );

    expect(response.status).toBe(200);
  });

  it('keeps, in a project, the readers of the project the caller can read [MEMBER-R12]', async () => {
    const response = await app.request(
      '/search?orgId=org-acme&q=noah&projectId=project-launch',
    );

    expect(response.status).toBe(200);
    expect(getProjectAuthContext).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'org-acme', userId: 'user-mia', role: 'member' },
      'mia@acme.example',
    );
    expect(readableProjectTeamIds).toHaveBeenCalledWith(
      expect.anything(),
      miaAuth,
      'project-launch',
    );
    expect(searchMembers).toHaveBeenCalledWith(expect.anything(), 'org-acme', {
      query: 'noah',
      access: 'read',
      projectTeamIds: ['team-design'],
      limit: 50,
      cursor: null,
    });
  });

  it('keeps the editors when asked for them, in a project or not [MEMBER-R12]', async () => {
    await app.request(
      '/search?orgId=org-acme&projectId=project-launch&access=edit',
    );
    expect(searchMembers).toHaveBeenLastCalledWith(
      expect.anything(),
      'org-acme',
      expect.objectContaining({
        access: 'edit',
        projectTeamIds: ['team-design'],
      }),
    );

    await app.request('/search?orgId=org-acme&access=read');
    expect(searchMembers).toHaveBeenLastCalledWith(
      expect.anything(),
      'org-acme',
      { query: '', access: 'read', limit: 50, cursor: null },
    );
  });

  it.each([
    [new ProjectError('PROJECT_NOT_FOUND', 'Project not found', 404), 404],
    [new ProjectError('PROJECT_FORBIDDEN', 'No project access', 403), 403],
  ])(
    'refuses a project the caller cannot read as the projects do (%s) [MEMBER-R12]',
    async (error, status) => {
      readableProjectTeamIds.mockRejectedValue(error);

      const response = await app.request(
        '/search?orgId=org-acme&projectId=project-launch',
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: error.code });
      expect(searchMembers).not.toHaveBeenCalled();
    },
  );
});
