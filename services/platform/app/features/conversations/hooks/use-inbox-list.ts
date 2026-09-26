'use client';

import { filterByTextSearch } from '@tale/ui/filtering';
import type { FilterConfig, FilterOption } from '@tale/ui/filters/filter-panel';
import { useCallback, useMemo } from 'react';

import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import {
  useTeamNames,
  useTeams,
} from '@/app/features/settings/teams/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import type { ConversationItem } from '@/backend/core/conversations/types';
import { useT } from '@/lib/i18n/client';

import {
  ASSIGNEE_ME,
  ASSIGNEE_MY_TEAMS,
  ASSIGNEE_UNASSIGNED,
  buildAssigneeOptions,
  matchesAssigneeFilter,
} from '../lib/assignee-filter';
import { useBulkActions } from './use-bulk-actions';
import { useConversationSelection } from './use-conversation-selection';

export type ReadFilter = 'all' | 'read' | 'unread';

/** The read facet's resting value — narrows nothing. */
export const ALL_READ_STATES = 'all';

export function isReadFilter(value: string): value is ReadFilter {
  return value === 'all' || value === 'read' || value === 'unread';
}

export interface ChannelFilterOption {
  /** Connector slug of a connected inbox provider (e.g. `gmail`). */
  value: string;
  label: string;
}

export interface ChannelFilter {
  options: ChannelFilterOption[];
  /** The selected provider slug; undefined = all channels. */
  value?: string;
  /** Called with the provider slug, or undefined for "All channels". */
  onChange: (value?: string) => void;
}

/** Radio sentinel for the channel filter's unfiltered state — never a real
 *  connector slug. */
const ALL_CHANNELS = 'all';

export interface UseInboxListOptions {
  organizationId: string;
  /** The loaded pages, in list order. */
  rows: ConversationItem[];
  searchQuery: string;
  /** A search is pending from the URL even before the box reflects it. */
  searchPending?: boolean;
  onSearchChange: (value: string) => void;
  readFilter: ReadFilter;
  onReadFilterChange?: (value: ReadFilter) => void;
  /**
   * Assignee filter: any mix of the `__me__`, `__unassigned__` and
   * `__my-teams__` sentinels, user ids and team ids. A row matches when it
   * satisfies ANY of them. In-page over the loaded rows, like search — the
   * list is already scoped server-side to what the viewer may see.
   */
  assigneeSelection: readonly string[];
  onAssigneeFilterChange?: (values: string[]) => void;
  /** Server-side provider filter; the control renders only with options. */
  channelFilter?: ChannelFilter;
  /** After a bulk verb lands (selection is cleared by then). */
  onBulkComplete?: () => void;
}

/**
 * One inbox list's working state — what narrows it, what is selected, and
 * the bulk verbs over the selection. Every inbox list is the same list: the
 * phone's full-screen Inbox and the Home panel's Inbox view both run on this
 * hook, so a facet, a filter rule or a bulk verb cannot drift between them.
 */
export function useInboxList({
  organizationId,
  rows,
  searchQuery,
  searchPending = false,
  onSearchChange,
  readFilter,
  onReadFilterChange,
  assigneeSelection,
  onAssigneeFilterChange,
  channelFilter,
  onBulkComplete,
}: UseInboxListOptions) {
  const { t: tConversations } = useT('conversations');
  // The assignee facet resolves ids to names through two directories that any
  // member may read: every team of the organization, and the member list.
  const { teams: myTeams } = useTeams();
  const { nameOf: teamNameOf } = useTeamNames();
  const { members } = useMembers(organizationId);
  const { data: memberContext } = useCurrentMemberContext(organizationId);
  const isAdmin = useAbility().can('read', 'orgSettings');
  const currentUserId =
    memberContext && 'userId' in memberContext
      ? memberContext.userId
      : undefined;
  const myTeamIds = useMemo(
    () => new Set((myTeams ?? []).map((team) => team.id)),
    [myTeams],
  );
  const personNameOf = useMemo(() => {
    const byId = new Map(
      (members ?? []).map((member) => [
        member.userId,
        member.displayName ?? member.email,
      ]),
    );
    return (userId: string) => byId.get(userId);
  }, [members]);

  const filteredConversations = useMemo(() => {
    let results = rows;

    if (searchQuery) {
      results = filterByTextSearch(results, searchQuery, [
        'title',
        'description',
        'subject',
        'externalMessageId',
        // The contact name is the most prominent label on each row, so the
        // search must cover it too — it lives on the nested `contact` object.
        (c) => c.contact?.name,
      ]);
    }

    if (readFilter === 'unread') {
      results = results.filter((c) => c.unread_count > 0);
    } else if (readFilter === 'read') {
      results = results.filter((c) => c.unread_count === 0);
    }

    if (assigneeSelection.length > 0) {
      results = results.filter((c) =>
        matchesAssigneeFilter(c, assigneeSelection, {
          ...(currentUserId === undefined ? {} : { currentUserId }),
          myTeamIds,
        }),
      );
    }

    return results;
  }, [
    rows,
    searchQuery,
    readFilter,
    assigneeSelection,
    currentUserId,
    myTeamIds,
  ]);

  // Search, the read facet and the assignee facet all run client-side over the
  // loaded pages only, so while any of them is active we must keep draining
  // backend pages — a match beyond the first page would otherwise be silently
  // missed (#2054). The channel facet is absent on purpose: it narrows
  // server-side, so its matches are never left behind a page boundary.
  const isFiltering =
    Boolean(searchQuery) ||
    searchPending ||
    readFilter !== ALL_READ_STATES ||
    assigneeSelection.length > 0;

  // The facets behind the toolbar's Filter button. Assignee comes first
  // because it is the one an inbox is usually narrowed by; Source renders only
  // when the organization has a provider to offer.
  const filters = useMemo<FilterConfig[]>(() => {
    const assigneeOptions: FilterOption[] = [
      ...(currentUserId === undefined
        ? []
        : [{ value: ASSIGNEE_ME, label: tConversations('filter.assigneeMe') }]),
      ...(isAdmin
        ? [
            {
              value: ASSIGNEE_UNASSIGNED,
              label: tConversations('filter.assigneeUnassigned'),
            },
          ]
        : []),
      ...(myTeamIds.size > 0
        ? [
            {
              value: ASSIGNEE_MY_TEAMS,
              label: tConversations('filter.assigneeMyTeams'),
            },
          ]
        : []),
      ...buildAssigneeOptions({
        rows,
        selected: assigneeSelection,
        personNameOf,
        teamNameOf,
        labels: {
          people: tConversations('filter.assigneePeople'),
          teams: tConversations('filter.assigneeTeams'),
          unknownPerson: tConversations('filter.assigneeUnknownPerson'),
          unknownTeam: tConversations('queue.unknownTeam'),
        },
      }),
    ];

    const configs: FilterConfig[] = [
      {
        key: 'assignee',
        title: tConversations('filter.assignee'),
        options: assigneeOptions,
        selectedValues: [...assigneeSelection],
        onChange: (values) => onAssigneeFilterChange?.(values),
        multiSelect: true,
      },
      {
        key: 'read',
        title: tConversations('filter.readStatus'),
        options: [
          { value: ALL_READ_STATES, label: tConversations('filter.all') },
          { value: 'read', label: tConversations('filter.read') },
          { value: 'unread', label: tConversations('filter.unread') },
        ],
        selectedValues: [readFilter],
        defaultValues: [ALL_READ_STATES],
        onChange: (values) => {
          const next = values[0];
          onReadFilterChange?.(
            next !== undefined && isReadFilter(next) ? next : ALL_READ_STATES,
          );
        },
      },
    ];

    if (channelFilter && channelFilter.options.length > 0) {
      configs.push({
        key: 'channel',
        title: tConversations('filter.channel'),
        options: [
          { value: ALL_CHANNELS, label: tConversations('filter.allChannels') },
          ...channelFilter.options,
        ],
        selectedValues: [channelFilter.value ?? ALL_CHANNELS],
        defaultValues: [ALL_CHANNELS],
        onChange: (values) => {
          const next = values[0];
          channelFilter.onChange(
            next === undefined || next === ALL_CHANNELS ? undefined : next,
          );
        },
      });
    }

    return configs;
  }, [
    tConversations,
    currentUserId,
    isAdmin,
    myTeamIds,
    rows,
    assigneeSelection,
    personNameOf,
    teamNameOf,
    onAssigneeFilterChange,
    readFilter,
    onReadFilterChange,
    channelFilter,
  ]);

  // "Clear all" reaches past the facets to the search box, which is the rest of
  // what narrows this list.
  const clearAllFilters = useCallback(() => {
    onAssigneeFilterChange?.([]);
    onReadFilterChange?.(ALL_READ_STATES);
    channelFilter?.onChange(undefined);
    onSearchChange('');
  }, [
    onAssigneeFilterChange,
    onReadFilterChange,
    channelFilter,
    onSearchChange,
  ]);

  const selection = useConversationSelection(filteredConversations);
  const { clearSelection } = selection;

  const handleBulkComplete = useCallback(() => {
    clearSelection();
    onBulkComplete?.();
  }, [clearSelection, onBulkComplete]);

  const bulk = useBulkActions({
    organizationId,
    conversations: filteredConversations,
    selectionState: selection.selectionState,
    onComplete: handleBulkComplete,
  });

  return {
    filteredConversations,
    isFiltering,
    filters,
    clearAllFilters,
    selection,
    bulk,
  };
}
