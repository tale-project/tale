import { useDebounce } from '@tale/ui/use-debounce';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import type { ReturnsOf } from '@/app/lib/backend/contract';
import { readStateOf, type ReadState } from '@/app/lib/backend/read-state';
import { memberSearchScope } from '@/app/lib/backend/settings';

/** A member a search found (MEMBER-R12): no sign-in factor. */
export type FoundMember =
  ReturnsOf<'members/queries:searchMembers'>['members'][number];

export interface MemberSearchOptions {
  /** Keep only who can read this project (MEMBER-R12). */
  projectId?: string;
  /** `read` leaves disabled members out; `edit` keeps, of those, the roles
   * from Editor up. Without it, every member, disabled ones too. */
  access?: 'read' | 'edit';
  /** `false` reads nothing: a picker not opened yet. */
  enabled?: boolean;
}

export interface MemberSearch extends ReadState {
  /** The members found, in the order they joined. While the search for a
   * new text loads, the ones found for the text before, in the same scope. */
  members: readonly FoundMember[];
  /** More members match than were found: typing more narrows them. */
  more: boolean;
  /** What is shown does not answer what is typed now yet. */
  searching: boolean;
  retry: () => void;
}

const NO_MEMBERS: readonly FoundMember[] = [];

/**
 * The members whose name or email holds what was typed, searched on the
 * server one page at a time (`GET /members/search`, MEMBER-R12) instead of
 * reading every member: what a picker offers. The text is searched 300 ms
 * after the last keystroke; the members found before stay on screen
 * meanwhile, but never those another project or access found. A member
 * write refreshes it (it keys under the member entity).
 */
export function useMemberSearch(
  organizationId: string,
  query: string,
  { projectId, access, enabled = true }: MemberSearchOptions = {},
): MemberSearch {
  // What the server matches: a text that differs only in its spaces is
  // the same search.
  const typed = query.trim().replaceAll(/\s+/g, ' ');
  const debounced = useDebounce(typed, 300);
  const scope = {
    ...(projectId === undefined ? {} : { projectId }),
    ...(access === undefined ? {} : { access }),
  };
  const sameScope = memberSearchScope(organizationId, scope);
  const result = useBackendQuery(
    'members/queries:searchMembers',
    enabled ? { organizationId, query: debounced, ...scope } : 'skip',
    {
      placeholderData: (previous, previousQuery) =>
        previousQuery !== undefined &&
        sameScope.every((part, index) => previousQuery.queryKey[index] === part)
          ? previous
          : undefined,
    },
  );
  return {
    members: result.data?.members ?? NO_MEMBERS,
    more: result.data?.isDone === false,
    searching:
      enabled &&
      (typed !== debounced || result.isLoading || result.isPlaceholderData),
    ...readStateOf(result),
    retry: () => void result.refetch(),
  };
}
