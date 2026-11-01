import { useMemo } from 'react';

import {
  type LookedUpMember,
  useMemberLookup,
} from '@/app/features/settings/organization/hooks/member-lookup';
import { useMemberSearch } from '@/app/features/settings/organization/hooks/member-search';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { EDITOR_ROLES } from '@/backend/core/projects/access';
import { useT } from '@/lib/i18n/client';

import { memberActor } from '../lib/member-actor';
import type { AssignableActor } from './use-actor-directory';

export interface AssignableMembers {
  /** The members found for what was typed, the viewer first, then the
   * person chosen when the page found lacks them. */
  members: readonly AssignableActor[];
  /** More members match than were found: typing more narrows them. */
  more: boolean;
  /** What is shown does not answer what is typed now yet. */
  searching: boolean;
  /** The search failed: the members found are no answer. */
  unavailable: boolean;
}

/** Whether the server takes a member of a project they read for `access`:
 * their role alone says. */
function roleMayTake(
  member: LookedUpMember | undefined,
  access: 'read' | 'edit',
): member is LookedUpMember {
  if (member === undefined) return false;
  return access === 'edit'
    ? EDITOR_ROLES.has(member.role)
    : member.role !== 'disabled';
}

/**
 * The people a task surface offers for what was typed — the assignee and
 * reviewer pickers, the `@`-mention autocomplete: the members who can `read`
 * the project, whom a task may be assigned to and a mention reaches, or
 * `edit` it, who may review one. They are searched on the server one page
 * at a time (`useMemberSearch`, MEMBER-R12), never every member; disabled
 * members are left out, and without a project the organization's members
 * are offered. The viewer comes first and is offered even when the page
 * found does not hold them, and so is the person a picker has chosen
 * (`chosenUserId`, the task's assignee or reviewer), right after them,
 * while their role may take the task: picking oneself stays one pick, the
 * current choice stays marked, and the list's own filter shows them only
 * while what was typed names them.
 */
export function useAssignableMembers(
  organizationId: string,
  projectId: string | undefined,
  query: string,
  access: 'read' | 'edit',
  chosenUserId?: string,
): AssignableMembers {
  const { t: tCommon } = useT('common');
  const formerMember = tCommon('formerMember');
  const search = useMemberSearch(organizationId, query, {
    ...(projectId ? { projectId } : {}),
    access,
  });
  const { data: me } = useCurrentMemberContext(organizationId);
  const myId = me?.userId;
  const lookup = useMemberLookup(
    organizationId,
    [myId, chosenUserId].flatMap((userId) =>
      userId === undefined ? [] : [{ userId }],
    ),
  );
  const mine = lookup.members.find((member) => member.userId === myId);
  const chosen =
    chosenUserId === myId
      ? undefined
      : lookup.members.find((member) => member.userId === chosenUserId);

  const members = useMemo(() => {
    const found = search.members.map((member) =>
      memberActor(member, formerMember),
    );
    // The viewer reads the project they pick in, and the chosen person was
    // picked in it, so their role alone says whether the server takes them.
    const kept = (member: LookedUpMember | undefined): AssignableActor[] =>
      roleMayTake(member, access) &&
      !found.some((candidate) => candidate.id === member.userId)
        ? [memberActor(member, formerMember)]
        : [];
    const own = found.find((member) => member.id === myId);
    return [
      ...(own === undefined ? kept(mine) : [own]),
      ...kept(chosen),
      ...found.filter((member) => member !== own),
    ];
  }, [search.members, mine, chosen, myId, access, formerMember]);

  return {
    members,
    more: search.more,
    searching: search.searching,
    unavailable: search.unavailable,
  };
}
