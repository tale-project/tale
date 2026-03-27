'use client';

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

import type { ConversationItem } from '@/convex/conversations/types';

import { LoadingOverlay } from '@/app/components/ui/feedback/loading-overlay';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import {
  DropdownMenu,
  type DropdownMenuItem,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import { filterByTextSearch } from '@/lib/utils/client-utils';
import { cn } from '@/lib/utils/cn';

import type { Conversation } from '../types';

import { useBulkActions } from '../hooks/use-bulk-actions';
import { useConversationSelection } from '../hooks/use-conversation-selection';
import { ActivateConversationsEmptyState } from './activate-conversations-empty-state';
import { BulkSendDialog } from './bulk-send-dialog';
import { ConversationListPanel } from './conversation-list-panel';
import { ConversationListToolbar } from './conversation-list-toolbar';
import { ConversationPanel } from './conversation-panel';
import { ConversationsList } from './conversations-list';
import {
  ConversationPanelSkeleton,
  ConversationsListSkeleton,
} from './conversations-skeleton';

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

  if (bodyState === 'activate-empty') {
    return <ActivateConversationsEmptyState organizationId={organizationId} />;
  }

  const isLoading = bodyState === 'loading' || bodyState === 'skeleton';
  const skeletonRows = Math.min(conversationCount ?? 3, 8);

  const handleConversationSelect = (conversation: Conversation) => {
    setSelectedConversationId(conversation.id);
  };

  return (
    <>
      <ConversationListPanel
        hidden={!!selectedConversationId}
        overlay={
          isBulkProcessing ? (
            <LoadingOverlay message={tConversations('updating')} />
          ) : undefined
        }
      >
        <ConversationListToolbar>
          {/* Compound select-all + filter trigger — matches design `5txbz` */}
          <DropdownMenu
            trigger={
              <button
                type="button"
                className={cn(
                  'flex shrink-0 items-center gap-0.5 rounded pr-1 py-0.5',
                  readFilter !== 'all' && 'bg-blue-100',
                )}
                aria-label={tConversations('filter.label')}
              >
                {/* Prevent checkbox clicks from opening the dropdown */}
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Checkbox
                    id="select-all"
                    checked={selectAllChecked}
                    onCheckedChange={handleSelectAll}
                    aria-label={tCommon('aria.selectAll')}
                    disabled={isLoading}
                  />
                </div>
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

          {hasSelectedItems ? (
            <>
              <span className="shrink-0 text-sm font-semibold">
                {tConversations('bulk.selectedCount', { count: selectedCount })}
              </span>
              <div className="ml-auto flex items-center gap-1">
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
              </div>
            </>
          ) : (
            <SearchInput
              placeholder={tChat('searchConversations')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              wrapperClassName="flex-1"
              className="bg-transparent pr-3 text-sm shadow-none"
              disabled={isLoading}
            />
          )}
        </ConversationListToolbar>

        {isLoading ? (
          <ConversationsListSkeleton rows={skeletonRows} />
        ) : (
          <ConversationsList
            conversations={filteredConversations}
            selectedConversationId={selectedConversationId}
            onConversationSelect={handleConversationSelect}
            onConversationCheck={handleConversationCheck}
            isConversationSelected={isConversationSelected}
            paginationStatus={paginatedResult.status}
            loadMore={paginatedResult.loadMore}
          />
        )}
      </ConversationListPanel>

      <div
        className={cn(
          'flex-1 min-w-0',
          selectedConversationId ? 'flex' : 'hidden md:flex',
        )}
      >
        {isLoading ? (
          <ConversationPanelSkeleton status={status} />
        ) : (
          <ConversationPanel
            selectedConversationId={selectedConversationId}
            onSelectedConversationChange={setSelectedConversationId}
            status={status}
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
