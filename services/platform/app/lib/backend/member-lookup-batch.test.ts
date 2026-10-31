import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MEMBER_LOOKUP_LIMIT } from '@/lib/shared/constants/member-lookup';

import { lookupMember, type MemberLookupWire } from './member-lookup-batch';

const { backendFetch } = vi.hoisted(() => ({ backendFetch: vi.fn() }));
vi.mock('./api-client', () => ({ backendFetch }));

function member(
  userId: string,
  displayName: string | null,
  email: string | null,
): MemberLookupWire {
  return {
    id: `member-${userId}`,
    userId,
    role: 'member',
    createdAt: '2026-10-01 09:00:00+00',
    displayName,
    email,
  };
}

const noah = member('user-noah', 'Noah Berg', 'noah@acme.example');
const mia = member('user-mia', 'Mia Rossi', 'mia.r@acme.example');

/** What each request asked for: its route's user ids and handles. */
function asked(): Array<{
  orgId: string;
  userIds: string[];
  handles: string[];
}> {
  return backendFetch.mock.calls.map(([route, options]) => {
    const query = new URLSearchParams(String(route).split('?')[1]);
    return {
      orgId: (options as { orgId: string }).orgId,
      userIds: query.get('userIds')?.split(',') ?? [],
      handles: query.get('handles')?.split(',') ?? [],
    };
  });
}

beforeEach(() => {
  backendFetch.mockReset();
  backendFetch.mockResolvedValue({ members: [noah, mia] });
});

describe('lookupMember [MEMBER-R11]', () => {
  it('sends everyone asked for in one task as one request, answering each with whom they name', async () => {
    const [byId, byEmailName, byName, nobody] = await Promise.all([
      lookupMember('org-acme', { userId: 'user-noah' }),
      lookupMember('org-acme', { handle: 'mia.r' }),
      lookupMember('org-acme', { handle: 'Noah.Berg' }),
      lookupMember('org-acme', { userId: 'user-gone' }),
    ]);

    expect(byId).toEqual([noah]);
    expect(byEmailName).toEqual([mia]);
    expect(byName).toEqual([noah]);
    expect(nobody).toEqual([]);
    expect(backendFetch).toHaveBeenCalledTimes(1);
    expect(backendFetch.mock.calls[0]?.[0]).toBe(
      '/members/lookup?userIds=user-noah,user-gone&handles=mia.r,noah.berg',
    );
  });

  it('asks once for a person two reads asked for', async () => {
    const [first, second] = await Promise.all([
      lookupMember('org-acme', { userId: 'user-noah' }),
      lookupMember('org-acme', { userId: 'user-noah' }),
    ]);

    expect(first).toEqual([noah]);
    expect(second).toEqual([noah]);
    expect(asked()).toEqual([
      { orgId: 'org-acme', userIds: ['user-noah'], handles: [] },
    ]);
  });

  it('keeps each organization to its own request', async () => {
    await Promise.all([
      lookupMember('org-acme', { userId: 'user-noah' }),
      lookupMember('org-globex', { userId: 'user-noah' }),
    ]);

    expect(asked()).toEqual([
      { orgId: 'org-acme', userIds: ['user-noah'], handles: [] },
      { orgId: 'org-globex', userIds: ['user-noah'], handles: [] },
    ]);
  });

  it('splits what one request may name at the lookup limit', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `user-${i}`);

    await Promise.all(
      ids.map((userId) => lookupMember('org-acme', { userId })),
    );

    expect(asked().map((request) => request.userIds.length)).toEqual([
      MEMBER_LOOKUP_LIMIT,
      150 - MEMBER_LOOKUP_LIMIT,
    ]);
    expect(asked().flatMap((request) => request.userIds)).toEqual(ids);
  });

  it('splits long handles before the query string outgrows a request line', async () => {
    const handles = Array.from(
      { length: 60 },
      (_, i) => `${String(i).padStart(2, '0')}${'h'.repeat(98)}`,
    );

    await Promise.all(
      handles.map((handle) => lookupMember('org-acme', { handle })),
    );

    const requests = asked();
    expect(requests.length).toBeGreaterThan(1);
    for (const [route] of backendFetch.mock.calls) {
      expect(String(route).length).toBeLessThan(4200);
    }
    expect(requests.flatMap((request) => request.handles)).toEqual(handles);
  });

  it.each([
    ['an empty user id', { userId: '' }],
    ['a user id with a comma', { userId: 'user-a,user-b' }],
    ['a user id with spaces around it', { userId: ' user-noah' }],
    ['a user id longer than 100 characters', { userId: 'u'.repeat(101) }],
    ['a handle no mention could name', { handle: 'noah berg' }],
    ['a handle longer than 100 characters', { handle: 'h'.repeat(101) }],
  ])('answers %s with nobody, never sending it', async (_case, target) => {
    const [refused, sent] = await Promise.all([
      lookupMember('org-acme', target),
      lookupMember('org-acme', { userId: 'user-noah' }),
    ]);

    expect(refused).toEqual([]);
    expect(sent).toEqual([noah]);
    expect(asked()).toEqual([
      { orgId: 'org-acme', userIds: ['user-noah'], handles: [] },
    ]);
  });

  it('fails only the asks of the request that failed', async () => {
    const outage = new Error('backend unreachable');
    backendFetch
      .mockRejectedValueOnce(outage)
      .mockResolvedValueOnce({ members: [noah] });
    const ids = Array.from(
      { length: MEMBER_LOOKUP_LIMIT },
      (_, i) => `user-${i}`,
    );

    const answers = await Promise.allSettled([
      ...ids.map((userId) => lookupMember('org-acme', { userId })),
      lookupMember('org-acme', { userId: 'user-noah' }),
    ]);

    expect(answers.slice(0, -1).every((a) => a.status === 'rejected')).toBe(
      true,
    );
    expect(answers.at(-1)).toEqual({ status: 'fulfilled', value: [noah] });
  });
});
