import { useMemo } from 'react';

import { type LookedUpMember, useMemberLookup } from './member-lookup';
import {
  type FoundMember,
  type MemberSearchOptions,
  useMemberSearch,
} from './member-search';

/** A member a picker offers: found for what was typed, or chosen and named. */
export type ChoiceMember = FoundMember | LookedUpMember;

export interface MemberChoicesOptions extends MemberSearchOptions {
  /** The people the picker has chosen. Each is named (looked up by id) even
   * when what was typed does not find them, so the field can show who it
   * holds. */
  chosen?: readonly string[];
}

export interface MemberChoices {
  /** The people found for what was typed, in the order they joined, with
   * the chosen ones the search did not find first. */
  members: readonly ChoiceMember[];
  /** The search has answered: a picker that waits for it stays closed. */
  answered: boolean;
  /** More members match than were found: typing more narrows them. */
  more: boolean;
  /** What is shown does not answer what is typed now yet. */
  searching: boolean;
  /** The search failed and has not answered: the list is no answer. */
  unavailable: boolean;
  /** The search answered before, but its latest refresh failed: the list
   * shown is the last answer, possibly out of date. */
  stale: boolean;
  /** The error the search settled in, while it failed. */
  error: unknown;
  /** The search is running again while the failure stands. */
  retrying: boolean;
  /** How many times the search has settled in error. */
  failureCount: number;
  /** Searches again after a failure. */
  retry: () => void;
}

/** A member's name as a picker shows it. */
export function memberLabel(member: {
  userId: string;
  displayName?: string;
  email?: string;
}): string {
  return member.displayName || member.email || member.userId;
}

/**
 * The members a picker offers for what is typed: searched on the server one
 * page at a time (`useMemberSearch`, MEMBER-R12) instead of reading every
 * member, plus the people the picker has already chosen, named by id
 * (`useMemberLookup`, MEMBER-R11). The caller keeps the query and its own
 * narrowing (who may be picked); this only composes the two reads.
 */
export function useMemberChoices(
  organizationId: string,
  query: string,
  { chosen = [], ...options }: MemberChoicesOptions = {},
): MemberChoices {
  const search = useMemberSearch(organizationId, query, options);
  const chosenIds = chosen.filter((userId) => userId !== '');
  const chosenKey = chosenIds.join('\n');
  const lookup = useMemberLookup(
    organizationId,
    chosenIds.map((userId) => ({ userId })),
  );
  const members = useMemo(() => {
    const chosenSet = new Set(chosenKey.split('\n'));
    const found = new Set(search.members.map((member) => member.userId));
    const named = lookup.members.filter(
      (member) => chosenSet.has(member.userId) && !found.has(member.userId),
    );
    return [...named, ...search.members];
  }, [search.members, lookup.members, chosenKey]);
  return {
    members,
    answered: search.answered,
    more: search.more,
    searching: search.searching,
    unavailable: search.unavailable,
    stale: search.stale,
    error: search.error,
    retrying: search.retrying,
    failureCount: search.failureCount,
    retry: search.retry,
  };
}
