'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuItem } from '@tale/ui/dropdown-menu';
import { Row } from '@tale/ui/layout';
import { LoadingOverlay } from '@tale/ui/loading-overlay';
import type { UsePaginatedQueryResult } from 'convex/react';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronDownIcon,
  Loader2Icon,
  MailXIcon,
  SendHorizontalIcon,
  ShieldXIcon,
} from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import type { ConversationItem } from '@/convex/conversations/types';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { filterByTextSearch } from '@/lib/utils/filtering';

import { useBulkActions } from '../hooks/use-bulk-actions';
import { useConversationSelection } from '../hooks/use-conversation-selection';
import type { Conversation } from '../types';
import { ActivateConversationsEmptyState } from './activate-conversations-empty-state';
import { BulkSendDialog } from './bulk-send-dialog';
import { ConversationListPanel } from './conversation-list-panel';
import { ConversationListToolbar } from './conversation-list-toolbar';
import { ConversationPanel } from './conversation-panel';
import { ConversationsList } from './conversations-list';

interface ConversationsProps {
  status?: Conversation['status'];
  organizationId: string;
  search?: string;
  paginatedResult: UsePaginatedQueryResult<ConversationItem>;
  conversationCount: number | undefined;
  totalConversationCount: number | undefined;
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
  paginatedStatus: UsePaginatedQueryResult<ConversationItem>['status'],
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
  paginatedResult,
  conversationCount,
  totalConversationCount,
}: ConversationsProps) {
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);

  const [searchQuery, setSearchQuery] = useState(initialSearch || '');
  const [readFilter, setReadFilter] = useState<'all' | 'read' | 'unread'>(
    'all',
  );

  const { t: tChat } = useT('chat');
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

    const searchTerm = searchQuery || initialSearch;
    if (searchTerm) {
      results = filterByTextSearch(results, searchTerm, [
        'title',
        'description',
        'subject',
        'externalMessageId',
        // The customer name is the most prominent label on each row, so the
        // search must cover it too — it lives on the nested `customer` object.
        (c) => c.customer?.name,
      ]);
    }

    if (readFilter === 'unread') {
      results = results.filter((c) => c.unread_count > 0);
    } else if (readFilter === 'read') {
      results = results.filter((c) => c.unread_count === 0);
    }

    return results;
  }, [paginatedResult.results, searchQuery, initialSearch, readFilter]);

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
    setSelectedConversationId(null);
  }, [clearSelection]);

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
    setSelectedConversationId(conversation.id);
  };

  return (
    <>
      <ConversationListPanel
        // On mobile the activate CTA owns the screen (reading pane below), so
        // hide the empty list there; on desktop it sits beside the CTA.
        hidden={!!selectedConversationId || isActivateEmpty}
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
              readFilter !== 'all' && 'bg-blue-100',
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
                      className="bg-blue-100 text-blue-500 hover:bg-blue-200 hover:text-blue-600"
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
              placeholder={tChat('searchConversations')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              wrapperClassName="flex-1"
              className="bg-transparent pr-3 text-sm shadow-none"
              disabled={controlsDisabled}
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
        />
      </ConversationListPanel>

      <div
        className={cn(
          'flex-1 min-w-0',
          // Show the reading pane on mobile when there's a selection OR when
          // it's hosting the activate CTA (the empty list is hidden there).
          selectedConversationId || isActivateEmpty ? 'flex' : 'hidden md:flex',
        )}
      >
        {isActivateEmpty ? (
          <ActivateConversationsEmptyState organizationId={organizationId} />
        ) : (
          <ConversationPanel
            selectedConversationId={selectedConversationId}
            onSelectedConversationChange={setSelectedConversationId}
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
