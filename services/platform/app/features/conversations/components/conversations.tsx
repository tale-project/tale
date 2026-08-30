'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuItem } from '@tale/ui/dropdown-menu';
import { Row } from '@tale/ui/layout';
import { LoadingOverlay } from '@tale/ui/loading-overlay';
import { useNavigate } from '@tanstack/react-router';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronDownIcon,
  ListFilter,
  Loader2Icon,
  MailXIcon,
  SendHorizontalIcon,
  ShieldXIcon,
} from 'lucide-react';
import { useState, useMemo, useCallback, useEffect } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import type { UsePaginatedQueryReturnType } from '@/app/hooks/use-cached-paginated-query';
import type { ConversationItem } from '@/convex/conversations/types';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { filterByTextSearch } from '@/lib/utils/filtering';

import { useBulkActions } from '../hooks/use-bulk-actions';
import { useConversationSelection } from '../hooks/use-conversation-selection';
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
  const [readFilter, setReadFilter] = useState<'all' | 'read' | 'unread'>(
    'all',
  );

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

    return results;
  }, [paginatedResult.results, searchQuery, readFilter]);

  // Search and the read-status filter run client-side over the loaded pages
  // only, so while either is active we must keep draining backend pages — a
  // match beyond the first page would otherwise be silently missed (#2054).
  const isFiltering =
    Boolean(searchQuery || initialSearch) || readFilter !== 'all';

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
          {/* Compound select-all + filter trigger — matches design `5txbz` */}
          {/* Compound select-all + read-filter control. The checkbox and the
              dropdown trigger are SIBLINGS inside a styled wrapper — never
              nested — because a Radix Checkbox renders a <button>, and a
              <button> inside the trigger <button> is invalid HTML (hydration
              error: "<button> cannot be a descendant of <button>"). */}
          <div
            className={cn(
              'flex shrink-0 items-center gap-0.5 rounded py-0.5 pr-1',
              readFilter !== 'all' && 'bg-blue-100 dark:bg-blue-950',
              controlsDisabled && 'opacity-50',
            )}
          >
            <Checkbox
              id="select-all"
              checked={selectAllChecked}
              onCheckedChange={handleSelectAll}
              aria-label={tCommon('aria.selectAll')}
              disabled={controlsDisabled}
            />
            <DropdownMenu
              disabled={controlsDisabled}
              trigger={
                <button
                  type="button"
                  disabled={controlsDisabled}
                  className="flex items-center rounded disabled:cursor-not-allowed"
                  aria-label={tConversations('filter.label')}
                >
                  <ChevronDownIcon className="text-muted-foreground size-3.5" />
                </button>
              }
              items={[
                [
                  {
                    type: 'radio-group',
                    value: readFilter,
                    onValueChange: (v) => {
                      if (v === 'all' || v === 'read' || v === 'unread') {
                        setReadFilter(v);
                      }
                    },
                    options: [
                      { value: 'all', label: tConversations('filter.all') },
                      { value: 'read', label: tConversations('filter.read') },
                      {
                        value: 'unread',
                        label: tConversations('filter.unread'),
                      },
                    ],
                  } satisfies DropdownMenuItem,
                ],
              ]}
              align="start"
            />
          </div>

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

          {/* Channel filter — the connected inbox providers (server-side:
              the selected slug becomes the query's `connectorName` arg).
              Icon-only, mirrors FilterButton's chrome; sits to the right of
              the search box. Rendered only when the org has at least one
              provider to filter by. */}
          {channelFilter && channelFilter.options.length > 0 && (
            <DropdownMenu
              disabled={controlsDisabled}
              trigger={
                <Button
                  variant="secondary"
                  size="icon"
                  disabled={controlsDisabled}
                  aria-label={tConversations('filter.channel')}
                  className={cn(
                    'shrink-0',
                    channelFilter.value !== undefined &&
                      'bg-blue-100 hover:bg-blue-200 dark:bg-blue-950 dark:hover:bg-blue-900',
                  )}
                >
                  <ListFilter className="text-muted-foreground size-4" />
                </Button>
              }
              items={[
                [
                  {
                    type: 'radio-group',
                    value: channelFilter.value ?? ALL_CHANNELS,
                    onValueChange: (v) => {
                      channelFilter.onChange(
                        v === ALL_CHANNELS ? undefined : v,
                      );
                    },
                    options: [
                      {
                        value: ALL_CHANNELS,
                        label: tConversations('filter.allChannels'),
                      },
                      ...channelFilter.options,
                    ],
                  } satisfies DropdownMenuItem,
                ],
              ]}
              align="end"
            />
          )}
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
