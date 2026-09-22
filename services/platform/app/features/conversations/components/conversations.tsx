'use client';

import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
import { cn } from '@tale/ui/cn';
import {
  FilterPanel,
  type FilterConfig,
  type FilterOption,
} from '@tale/ui/filters/filter-panel';
import { Row } from '@tale/ui/layout';
import { LoadingOverlay } from '@tale/ui/loading-overlay';
import { SearchInput } from '@tale/ui/search-input';
import { Tooltip } from '@tale/ui/tooltip';
import { useNavigate } from '@tanstack/react-router';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  Loader2Icon,
  MailXIcon,
  SendHorizontalIcon,
  ShieldXIcon,
} from 'lucide-react';
import { useState, useMemo, useCallback, useEffect } from 'react';

import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import {
  useTeamNames,
  useTeams,
} from '@/app/features/settings/teams/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import type { UsePaginatedQueryReturnType } from '@/app/hooks/use-cached-paginated-query';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import type { ConversationItem } from '@/backend/core/conversations/types';
import { useT } from '@/lib/i18n/client';
import { filterByTextSearch } from '@/lib/utils/filtering';

import { useBulkActions } from '../hooks/use-bulk-actions';
import { useConversationSelection } from '../hooks/use-conversation-selection';
import {
  ASSIGNEE_ME,
  ASSIGNEE_MY_TEAMS,
  ASSIGNEE_UNASSIGNED,
  buildAssigneeOptions,
  matchesAssigneeFilter,
} from '../lib/assignee-filter';
import type { Conversation } from '../types';
import { BulkSendDialog } from './bulk-send-dialog';
import { ComposeEmailPane } from './compose-email-pane';
import { ConversationListPanel } from './conversation-list-panel';
import { ConversationListToolbar } from './conversation-list-toolbar';
import { ConversationPanel } from './conversation-panel';
import { ConversationsEmptyState } from './conversations-empty-state';
import { ConversationsList } from './conversations-list';

export interface ChannelFilterOption {
  /** Connector slug of a connected inbox provider (e.g. `gmail`). */
  value: string;
  /** Display title (e.g. "Gmail"). */
  label: string;
}

export interface ChannelFilter {
  options: ChannelFilterOption[];
  /** The selected provider slug; undefined = all channels. */
  value?: string;
  /** Called with the provider slug, or undefined for "All channels". */
  onChange: (value?: string) => void;
}

interface ConversationsProps {
  status?: Conversation['status'];
  organizationId: string;
  search?: string;
  /** Deep-link from notifications (`?conversation=`). */
  initialConversationId?: string;
  paginatedResult: UsePaginatedQueryReturnType<ConversationItem>;
  conversationCount: number | undefined;
  totalConversationCount: number | undefined;
  /** Server-side provider filter (the route owns the URL state). The control
   *  renders only when at least one option exists. */
  channelFilter?: ChannelFilter;
  /** Compose mode — render the compose pane in the reading pane (URL: `?compose`). */
  composing?: boolean;
  /** Contact to seed the composer with (URL: `?composeContact`). */
  composeContact?: string;
  /**
   * Assignee filter (URL: `?assignee`): any mix of the `__me__`,
   * `__unassigned__` and `__my-teams__` sentinels, user ids and team ids. A row
   * matches when it satisfies ANY of them. In-page over the loaded rows, like
   * search — the list is already scoped server-side to what the viewer may see.
   */
  assigneeFilter?: string[];
  onAssigneeFilterChange?: (values: string[]) => void;
  /** Read-status filter (URL: `?read`). In-page over the loaded rows. */
  readFilter?: ReadFilter;
  onReadFilterChange?: (value: ReadFilter) => void;
}

export type ReadFilter = 'all' | 'read' | 'unread';

/** The read facet's resting value — narrows nothing. */
const ALL_READ_STATES = 'all';

export function isReadFilter(value: string): value is ReadFilter {
  return value === 'all' || value === 'read' || value === 'unread';
}

// ---------------------------------------------------------------------------
// Body state machine
//
// Derives what the conversation list body should render from three signals:
//   1. totalConversationCount — drives activate-empty vs content
//   2. conversationCount      — drives skeleton row count
//   3. paginatedResult.status — whether data has arrived
//
// States:
//   'activate-empty' — no conversations at all, show onboarding CTA
//   'loading'        — counts unknown, show placeholder skeleton
//   'skeleton'       — count known > 0, show skeleton rows
//   'data'           — rows available
// ---------------------------------------------------------------------------
type BodyState = 'activate-empty' | 'loading' | 'skeleton' | 'data';

/** Radio sentinel for the channel filter's unfiltered state — never a real
 *  connector slug. */
const ALL_CHANNELS = 'all';

function deriveBodyState(
  totalConversationCount: number | undefined,
  conversationCount: number | undefined,
  paginatedStatus: UsePaginatedQueryReturnType<ConversationItem>['status'],
): BodyState {
  const isDataLoading = paginatedStatus === 'LoadingFirstPage';

  if (totalConversationCount === 0) return 'activate-empty';

  if (!isDataLoading) return 'data';

  if (conversationCount !== undefined && conversationCount > 0)
    return 'skeleton';

  return 'loading';
}

export function Conversations({
  status,
  organizationId,
  search: initialSearch,
  initialConversationId,
  paginatedResult,
  conversationCount,
  totalConversationCount,
  channelFilter,
  composing = false,
  composeContact,
  assigneeFilter,
  onAssigneeFilterChange,
  readFilter = ALL_READ_STATES,
  onReadFilterChange,
}: ConversationsProps) {
  const navigate = useNavigate();
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
  const assigneeSelection = useMemo(
    () => assigneeFilter ?? [],
    [assigneeFilter],
  );

  const [selectedConversationId, setSelectedConversationId] = useState(
    initialConversationId ?? null,
  );

  // Selection is mirrored in `?conversation=` so the mobile header back button
  // (remounted in `AdaptiveHeaderSlot` outside this tree) can read it.
  useEffect(() => {
    setSelectedConversationId(initialConversationId ?? null);
  }, [initialConversationId]);

  const handleSelectedConversationChange = useCallback(
    (id: string | null) => {
      setSelectedConversationId(id);
      void navigate({
        to: '/dashboard/$id/conversations/$status',
        params: { id: organizationId, status: status ?? 'open' },
        search: (prev) => ({
          ...prev,
          conversation: id ?? undefined,
          // Leaving compose for a thread (desktop list still visible) must
          // drop the compose params or the reading pane stays on New email.
          ...(id != null
            ? { compose: undefined, composeContact: undefined }
            : {}),
        }),
        replace: true,
      });
    },
    [navigate, organizationId, status],
  );

  // `searchQuery` is the single source of truth for the filter. It is seeded
  // once from the `?search=` URL param; thereafter the URL is kept in sync from
  // state (not the other way around) so that clearing the box actually clears
  // the filter instead of falling back to the stale URL param on every render.
  const [searchQuery, setSearchQuery] = useState(initialSearch || '');

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      void navigate({
        to: '/dashboard/$id/conversations/$status',
        params: { id: organizationId, status: status ?? 'open' },
        search: (prev) => ({
          ...prev,
          search: value.length > 0 ? value : undefined,
        }),
        replace: true,
      });
    },
    [navigate, organizationId, status],
  );

  const { t: tConversations } = useT('conversations');
  const { t: tCommon } = useT('common');

  const bodyState = useMemo(
    () =>
      deriveBodyState(
        totalConversationCount,
        conversationCount,
        paginatedResult.status,
      ),
    [totalConversationCount, conversationCount, paginatedResult.status],
  );

  const filteredConversations = useMemo(() => {
    let results = paginatedResult.results;

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
    paginatedResult.results,
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
    Boolean(searchQuery || initialSearch) ||
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
        rows: paginatedResult.results,
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
    paginatedResult.results,
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
  const handleClearAllFilters = useCallback(() => {
    onAssigneeFilterChange?.([]);
    onReadFilterChange?.(ALL_READ_STATES);
    channelFilter?.onChange(undefined);
    handleSearchChange('');
  }, [
    onAssigneeFilterChange,
    onReadFilterChange,
    channelFilter,
    handleSearchChange,
  ]);

  const {
    selectionState,
    handleConversationCheck,
    handleSelectAll,
    isConversationSelected,
    selectAllChecked,
    selectedCount,
    hasSelectedItems,
    clearSelection,
  } = useConversationSelection(filteredConversations);

  const onBulkComplete = useCallback(() => {
    clearSelection();
    handleSelectedConversationChange(null);
  }, [clearSelection, handleSelectedConversationChange]);

  const {
    isBulkProcessing,
    bulkSendDialog,
    openBulkSendDialog,
    closeBulkSendDialog,
    handleSendMessages,
    handleBulkResolve,
    handleBulkReopen,
    handleBulkSpam,
    handleBulkArchive,
    handleBulkUnarchive,
  } = useBulkActions({
    organizationId,
    conversations: filteredConversations,
    selectionState,
    onComplete: onBulkComplete,
  });

  // The not-yet-activated empty state renders *inside* the two-pane shell (list
  // panel + reading pane) instead of swapping the whole page to a centered CTA,
  // so the page layout matches the populated/loading variants and doesn't shift
  // when the first conversation lands. The connect-email CTA takes the reading
  // pane (prominent on desktop, full-width on mobile where the empty list is
  // hidden); the list panel shows its normal empty state on desktop.
  const isActivateEmpty = bodyState === 'activate-empty';
  const isLoading = bodyState === 'loading' || bodyState === 'skeleton';
  // Nothing to search/select while loading or before activation.
  const controlsDisabled = isLoading || isActivateEmpty;
  const skeletonRows = Math.min(conversationCount ?? 12, 12);

  const handleConversationSelect = (conversation: Conversation) => {
    handleSelectedConversationChange(conversation.id);
  };

  const closeCompose = useCallback(() => {
    void navigate({
      to: '/dashboard/$id/conversations/$status',
      params: { id: organizationId, status: status ?? 'open' },
      search: (prev) => ({
        ...prev,
        compose: undefined,
        composeContact: undefined,
      }),
      replace: true,
    });
  }, [navigate, organizationId, status]);

  const handleComposeSent = useCallback(
    (conversationId: string) => {
      void navigate({
        to: '/dashboard/$id/conversations/$status',
        params: { id: organizationId, status: status ?? 'open' },
        search: (prev) => ({
          ...prev,
          conversation: conversationId,
          compose: undefined,
          composeContact: undefined,
        }),
      });
    },
    [navigate, organizationId, status],
  );

  return (
    <>
      <ConversationListPanel
        // On mobile the activate CTA / a selected thread / compose owns the
        // screen (reading pane below), so hide the empty list there; on desktop
        // it sits beside them.
        hidden={!!selectedConversationId || isActivateEmpty || composing}
        overlay={
          isBulkProcessing ? (
            <LoadingOverlay message={tConversations('updating')} />
          ) : undefined
        }
      >
        <ConversationListToolbar>
          {/* Select all. The read-status chevron that used to hang off this
              checkbox now sits in the Filter panel with the other facets, so
              the checkbox is a plain checkbox again. */}
          <Checkbox
            id="select-all"
            className="shrink-0"
            checked={selectAllChecked}
            onCheckedChange={handleSelectAll}
            aria-label={tCommon('aria.selectAll')}
            disabled={controlsDisabled}
          />

          {hasSelectedItems ? (
            <>
              <span className="shrink-0 text-sm font-semibold">
                {tConversations('bulk.selectedCount', { count: selectedCount })}
              </span>
              <Row gap={1} className="ml-auto">
                {status === 'open' && (
                  <Tooltip content={tConversations('bulk.sendMessages')}>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={openBulkSendDialog}
                      disabled={isBulkProcessing}
                      aria-label={tConversations('bulk.sendMessages')}
                      className="bg-blue-100 text-blue-500 hover:bg-blue-200 hover:text-blue-600 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900 dark:hover:text-blue-200"
                    >
                      <SendHorizontalIcon className="size-4" />
                    </Button>
                  </Tooltip>
                )}
                {status === 'open' && (
                  <Tooltip content={tConversations('bulk.close')}>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={handleBulkResolve}
                      disabled={isBulkProcessing}
                      aria-label={tConversations('bulk.close')}
                    >
                      {isBulkProcessing ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <MailXIcon className="size-4" />
                      )}
                    </Button>
                  </Tooltip>
                )}
                {status === 'open' && (
                  <Tooltip content={tConversations('bulk.markSpam')}>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={handleBulkSpam}
                      disabled={isBulkProcessing}
                      aria-label={tConversations('bulk.markSpam')}
                    >
                      {isBulkProcessing ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <ShieldXIcon className="size-4" />
                      )}
                    </Button>
                  </Tooltip>
                )}
                {(status === 'closed' || status === 'spam') && (
                  <Tooltip content={tConversations('bulk.reopen')}>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={handleBulkReopen}
                      disabled={isBulkProcessing}
                      aria-label={tConversations('bulk.reopen')}
                    >
                      {isBulkProcessing ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <ArchiveRestoreIcon className="size-4" />
                      )}
                    </Button>
                  </Tooltip>
                )}
                {status === 'archived' ? (
                  <Tooltip content={tConversations('bulk.unarchive')}>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={handleBulkUnarchive}
                      disabled={isBulkProcessing}
                      aria-label={tConversations('bulk.unarchive')}
                    >
                      {isBulkProcessing ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <ArchiveRestoreIcon className="size-4" />
                      )}
                    </Button>
                  </Tooltip>
                ) : (
                  <Tooltip content={tConversations('bulk.archive')}>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={handleBulkArchive}
                      disabled={isBulkProcessing}
                      aria-label={tConversations('bulk.archive')}
                    >
                      {isBulkProcessing ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <ArchiveIcon className="size-4" />
                      )}
                    </Button>
                  </Tooltip>
                )}
              </Row>
            </>
          ) : (
            <SearchInput
              placeholder={tConversations('searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              wrapperClassName="flex-1"
              className="bg-transparent pr-3 text-sm shadow-none"
              disabled={controlsDisabled}
            />
          )}

          {/* Every facet lives behind this one button, to the RIGHT of the
              search box: the list pane is a fixed 24.75rem column, so a
              control in front of the search eats width the search needs, and
              a new facet has nowhere to go. Icon-only for the same reason.
              `align="end"` keeps the panel inside the pane. */}
          <FilterPanel
            filters={filters}
            onClearAll={handleClearAllFilters}
            disabled={controlsDisabled}
            align="end"
            iconOnly
          />
        </ConversationListToolbar>

        <ConversationsList
          conversations={isLoading ? undefined : filteredConversations}
          selectedConversationId={selectedConversationId}
          onConversationSelect={handleConversationSelect}
          onConversationCheck={handleConversationCheck}
          isConversationSelected={isConversationSelected}
          paginationStatus={paginatedResult.status}
          loadMore={paginatedResult.loadMore}
          skeletonRows={skeletonRows}
          isFiltering={isFiltering}
        />
      </ConversationListPanel>

      <div
        className={cn(
          'min-w-0 flex-1',
          // Show the reading pane on mobile when composing, when there's a
          // selection, OR when it's hosting the activate CTA (the empty list is
          // hidden there).
          selectedConversationId || isActivateEmpty || composing
            ? 'flex'
            : 'hidden md:flex',
        )}
      >
        {composing ? (
          <ComposeEmailPane
            organizationId={organizationId}
            initialContactId={composeContact}
            onSent={handleComposeSent}
            onClose={closeCompose}
          />
        ) : isActivateEmpty ? (
          <ConversationsEmptyState />
        ) : (
          <ConversationPanel
            selectedConversationId={selectedConversationId}
            onSelectedConversationChange={handleSelectedConversationChange}
            status={status}
            forceLoading={isLoading}
          />
        )}
      </div>

      {bulkSendDialog.isOpen && (
        <BulkSendDialog
          selectedCount={selectedCount}
          isSending={bulkSendDialog.isSending}
          onConfirm={handleSendMessages}
          onCancel={closeBulkSendDialog}
        />
      )}
    </>
  );
}
