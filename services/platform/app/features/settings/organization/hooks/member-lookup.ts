import type { UseQueryResult } from '@tanstack/react-query';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';

import { useBackendQueries } from '@/app/hooks/use-backend-query';
import type { ItemOf } from '@/app/lib/backend/contract';
import {
  memberLookupAsk,
  memberLookupKey,
  type MemberLookupTarget,
} from '@/app/lib/backend/member-lookup-batch';

export type { MemberLookupTarget };

/** A member the lookup found (MEMBER-R11): no sign-in factor. */
export type LookedUpMember = ItemOf<'members/queries:lookupMember'>;

export interface MemberLookup {
  /** The members found so far, in the order they joined. */
  members: readonly LookedUpMember[];
  /** Whether the lookup has answered for this person yet, found or not. A
   * value no member could be answers at once: nobody. */
  answered: (target: MemberLookupTarget) => boolean;
}

interface LookupAnswer {
  members: LookedUpMember[];
  /** The keys (`memberLookupKey`) of the asks answered. */
  answered: string[];
}

function askOfKey(key: string): MemberLookupTarget {
  const split = key.indexOf(':');
  const value = key.slice(split + 1);
  return key.slice(0, split) === 'user' ? { userId: value } : { handle: value };
}

/** Each person's answer folded into one: everyone found, once, in the
 * order they joined — the order the server's mention directory breaks a
 * tie between two people by. */
function foldAnswers(
  asks: readonly MemberLookupTarget[],
  results: readonly UseQueryResult<LookedUpMember[]>[],
): LookupAnswer {
  const members = new Map<string, LookedUpMember>();
  const answered: string[] = [];
  // Without an organization to read, no ask was sent.
  if (results.length !== asks.length) return { members: [], answered };
  asks.forEach((ask, index) => {
    const data = results[index]?.data;
    if (data === undefined) return;
    answered.push(memberLookupKey(ask));
    for (const member of data) members.set(member.userId, member);
  });
  return {
    members: [...members.values()].sort(
      (a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id),
    ),
    answered,
  };
}

/**
 * The members a screen names, by user id or by plain `@handle`, looked up
 * one person at a time (`GET /members/lookup`, MEMBER-R11) instead of
 * reading every member. Each person is a cache entry of their own, so a
 * person another screen already looked up answers at once, and a member
 * write refreshes every one (they key under the member entity). People
 * asked for together share one request.
 */
export function useMemberLookup(
  organizationId: string,
  targets: readonly MemberLookupTarget[],
): MemberLookup {
  // The same people, in any order, are the same reads.
  const signature = [
    ...new Set(
      targets.flatMap((target) => {
        const ask = memberLookupAsk(target);
        return ask === null ? [] : [memberLookupKey(ask)];
      }),
    ),
  ]
    .sort()
    .join('\n');
  const asks = useMemo(
    () => (signature === '' ? [] : signature.split('\n').map(askOfKey)),
    [signature],
  );
  const argsList = useMemo(
    () => asks.map((ask) => ({ organizationId, ...ask })),
    [asks, organizationId],
  );
  const combine = useCallback(
    (results: UseQueryResult<LookedUpMember[]>[]) => foldAnswers(asks, results),
    [asks],
  );
  const answer = useBackendQueries(
    'members/queries:lookupMember',
    argsList,
    combine,
  );
  return useMemo(() => {
    const answered = new Set(answer.answered);
    return {
      members: answer.members,
      answered: (target) => {
        const ask = memberLookupAsk(target);
        return ask === null || answered.has(memberLookupKey(ask));
      },
    };
  }, [answer]);
}

/** The people a directory was asked for, per organization, published
 * once per task. */
interface MemberAskStore {
  ask: (organizationId: string, target: MemberLookupTarget) => void;
  subscribe: (listener: () => void) => () => void;
  snapshot: (organizationId: string) => readonly MemberLookupTarget[];
}

const NOBODY: readonly MemberLookupTarget[] = [];

function createMemberAskStore(): MemberAskStore {
  const asked = new Map<string, Map<string, MemberLookupTarget>>();
  const snapshots = new Map<string, readonly MemberLookupTarget[]>();
  const listeners = new Set<() => void>();
  let scheduled = false;
  const publish = () => {
    scheduled = false;
    for (const [organizationId, asks] of asked) {
      if (snapshots.get(organizationId)?.length !== asks.size) {
        snapshots.set(organizationId, [...asks.values()]);
      }
    }
    for (const listener of listeners) listener();
  };
  return {
    ask: (organizationId, target) => {
      const ask = memberLookupAsk(target);
      if (ask === null) return;
      const key = memberLookupKey(ask);
      let asks = asked.get(organizationId);
      if (asks === undefined) {
        asks = new Map();
        asked.set(organizationId, asks);
      }
      if (asks.has(key)) return;
      asks.set(key, ask);
      if (scheduled) return;
      scheduled = true;
      // Published after the render that asked, so everyone the render named
      // goes out in one request.
      queueMicrotask(publish);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: (organizationId) => snapshots.get(organizationId) ?? NOBODY,
  };
}

export interface AskedMemberLookup extends MemberLookup {
  /** Ask for this person, and say whether the lookup is still out for
   * them. Call it while rendering whatever names them: the people a
   * render asks for are looked up together once it is done. */
  pending: (target: MemberLookupTarget) => boolean;
}

/**
 * A member lookup that learns whom to look up from the screen: a directory
 * hands its readers {@link AskedMemberLookup.pending}, and each person a
 * reader names is asked for as it renders them. A person not answered yet
 * is pending; one the lookup answered without is no member.
 */
export function useAskedMemberLookup(
  organizationId: string,
): AskedMemberLookup {
  const [store] = useState(createMemberAskStore);
  const snapshot = useCallback(
    () => store.snapshot(organizationId),
    [store, organizationId],
  );
  const asked = useSyncExternalStore(store.subscribe, snapshot, snapshot);
  const lookup = useMemberLookup(organizationId, asked);
  return useMemo(
    () => ({
      ...lookup,
      pending: (target) => {
        store.ask(organizationId, target);
        return !lookup.answered(target);
      },
    }),
    [lookup, store, organizationId],
  );
}
