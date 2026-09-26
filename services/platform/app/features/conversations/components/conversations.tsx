'use client';

import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
import { cn } from '@tale/ui/cn';
import { FilterPanel } from '@tale/ui/filters/filter-panel';
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

import type { UsePaginatedQueryReturnType } from '@/app/hooks/use-cached-paginated-query';
import type { ConversationItem } from '@/backend/core/conversations/types';
import { useT } from '@/lib/i18n/client';

import {
  ALL_READ_STATES,
  useInboxList,
  type ChannelFilter,
  type ReadFilter,
} from '../hooks/use-inbox-list';
import type { Conversation } from '../types';
import { BulkSendDialog } from './bulk-send-dialog';
import { ComposeEmailPane } from './compose-email-pane';
import { ConversationListPanel } from './conversation-list-panel';
import { ConversationListToolbar } from './conversation-list-toolbar';
import { ConversationPanel } from './conversation-panel';
import { ConversationsEmptyState } from './conversations-empty-state';
import { ConversationsList } from './conversations-list';

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

const NO_ASSIGNEES: readonly string[] = [];

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

  const {
    filteredConversations,
    isFiltering,
    filters,
    clearAllFilters: handleClearAllFilters,
    selection: {
      handleConversationCheck,
      handleSelectAll,
      isConversationSelected,
      selectAllChecked,
      selectedCount,
      hasSelectedItems,
    },
    bulk: {
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
    },
  } = useInboxList({
    organizationId,
    rows: paginatedResult.results,
    searchQuery,
    searchPending: Boolean(initialSearch),
    onSearchChange: handleSearchChange,
    readFilter,
    ...(onReadFilterChange !== undefined ? { onReadFilterChange } : {}),
    assigneeSelection: assigneeFilter ?? NO_ASSIGNEES,
    ...(onAssigneeFilterChange !== undefined ? { onAssigneeFilterChange } : {}),
    ...(channelFilter !== undefined ? { channelFilter } : {}),
    onBulkComplete: () => handleSelectedConversationChange(null),
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
