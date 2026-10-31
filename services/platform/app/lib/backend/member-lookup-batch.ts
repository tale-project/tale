import {
  MEMBER_LOOKUP_LIMIT,
  MEMBER_LOOKUP_VALUE_MAX_LENGTH,
} from '@/lib/shared/constants/member-lookup';
import {
  isTypeableHandle,
  memberMentionEntry,
} from '@/lib/shared/mention-handles';

import { backendFetch } from './api-client';

/** One person a screen names: by user id, or by a plain `@handle`. */
export type MemberLookupTarget = { userId: string } | { handle: string };

/** A member as `GET /members/lookup` answers (MEMBER-R11). */
export interface MemberLookupWire {
  id: string;
  userId: string;
  role: string;
  createdAt: string;
  displayName: string | null;
  email: string | null;
}

interface QueuedLookup {
  target: MemberLookupTarget;
  resolve: (rows: MemberLookupWire[]) => void;
  reject: (error: unknown) => void;
}

/** How long one request's query string may grow: well inside the 8 KiB
 * request line proxies commonly hold, whatever the ids and handles are. */
const QUERY_BUDGET = 4000;

const queued = new Map<string, QueuedLookup[]>();

/**
 * What the server takes for this person, as the request names it: the
 * handle lowercased, the way the server reads it. Null for a value it
 * refuses (empty, too long, a comma that would split it, a handle no
 * mention could name) — a value that names nobody, so it is never sent.
 */
export function memberLookupAsk(
  target: MemberLookupTarget,
): MemberLookupTarget | null {
  if ('userId' in target) {
    const { userId } = target;
    return userId !== '' &&
      userId.length <= MEMBER_LOOKUP_VALUE_MAX_LENGTH &&
      userId.trim() === userId &&
      !userId.includes(',')
      ? { userId }
      : null;
  }
  const handle = target.handle.toLowerCase();
  return handle.length <= MEMBER_LOOKUP_VALUE_MAX_LENGTH &&
    isTypeableHandle(handle)
    ? { handle }
    : null;
}

/** One key per person asked for: `user:<id>` or `handle:<handle>`. */
export function memberLookupKey(target: MemberLookupTarget): string {
  return 'userId' in target
    ? `user:${target.userId}`
    : `handle:${target.handle}`;
}

/** The members of one answer this person stands for — the same rules the
 * server confirmed a handle by. */
function membersFor(
  target: MemberLookupTarget,
  rows: readonly MemberLookupWire[],
): MemberLookupWire[] {
  if ('userId' in target) {
    return rows.filter((row) => row.userId === target.userId);
  }
  return rows.filter((row) =>
    memberMentionEntry({
      id: row.userId,
      name: row.displayName,
      email: row.email,
    }).handles.some(({ handle }) => handle === target.handle),
  );
}

/** The lookups waiting on one person: every read that asked for them in
 * this task, answered by one ask. */
interface AskGroup {
  target: MemberLookupTarget;
  lookups: QueuedLookup[];
}

function lookupRoute(groups: readonly AskGroup[]): string {
  const userIds: string[] = [];
  const handles: string[] = [];
  for (const { target } of groups) {
    if ('userId' in target) userIds.push(encodeURIComponent(target.userId));
    else handles.push(encodeURIComponent(target.handle));
  }
  const params = [
    ...(userIds.length > 0 ? [`userIds=${userIds.join(',')}`] : []),
    ...(handles.length > 0 ? [`handles=${handles.join(',')}`] : []),
  ];
  return `/members/lookup?${params.join('&')}`;
}

/** The asks, split into requests the server takes: at most
 * {@link MEMBER_LOOKUP_LIMIT} values each, and a query string inside
 * {@link QUERY_BUDGET}. */
function splitAsks(groups: readonly AskGroup[]): AskGroup[][] {
  const requests: AskGroup[][] = [];
  let current: AskGroup[] = [];
  let length = 0;
  for (const group of groups) {
    const { target } = group;
    const value = 'userId' in target ? target.userId : target.handle;
    const cost = encodeURIComponent(value).length + 1;
    if (
      current.length > 0 &&
      (current.length >= MEMBER_LOOKUP_LIMIT || length + cost > QUERY_BUDGET)
    ) {
      requests.push(current);
      current = [];
      length = 0;
    }
    current.push(group);
    length += cost;
  }
  if (current.length > 0) requests.push(current);
  return requests;
}

function sendLookups(orgId: string, lookups: readonly QueuedLookup[]): void {
  const groups = new Map<string, AskGroup>();
  for (const lookup of lookups) {
    const key = memberLookupKey(lookup.target);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { target: lookup.target, lookups: [lookup] });
    } else {
      group.lookups.push(lookup);
    }
  }
  for (const request of splitAsks([...groups.values()])) {
    void backendFetch<{ members: MemberLookupWire[] }>(lookupRoute(request), {
      orgId,
    }).then(
      (body) => {
        for (const { target, lookups: waiting } of request) {
          const members = membersFor(target, body.members);
          for (const lookup of waiting) lookup.resolve(members);
        }
      },
      (error: unknown) => {
        for (const group of request) {
          for (const lookup of group.lookups) lookup.reject(error);
        }
      },
    );
  }
}

/**
 * The members one person a screen names stands for, through
 * `GET /members/lookup` (MEMBER-R11). Every lookup asked in the same task
 * goes out together — a board asks for each person on it as it renders
 * them — in as few requests as the server takes. A value the server would
 * refuse names nobody and is never sent, so it cannot fail its batch.
 */
export function lookupMember(
  orgId: string,
  target: MemberLookupTarget,
): Promise<MemberLookupWire[]> {
  const ask = memberLookupAsk(target);
  if (ask === null) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const batch = queued.get(orgId);
    if (batch !== undefined) {
      batch.push({ target: ask, resolve, reject });
      return;
    }
    const lookups: QueuedLookup[] = [{ target: ask, resolve, reject }];
    queued.set(orgId, lookups);
    queueMicrotask(() => {
      queued.delete(orgId);
      sendLookups(orgId, lookups);
    });
  });
}
