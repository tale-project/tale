'use client';

import type { UsePaginatedQueryResult } from 'convex/react';

import { Loader2Icon } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';

import type { ConversationItem } from '@/convex/conversations/types';

import { LoadingOverlay } from '@/app/components/ui/feedback/loading-overlay';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { SearchInput } from '@/app/components/ui/forms/search-input';
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
    const searchTerm = searchQuery || initialSearch;
    if (searchTerm) {
      return filterByTextSearch(paginatedResult.results, searchTerm, [
        'title',
        'description',
        'subject',
        'externalMessageId',
      ]);
    }

    return paginatedResult.results;
  }, [paginatedResult.results, searchQuery, initialSearch]);

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
      <ConversationListPanel hidden={!!selectedConversationId}>
        <ConversationListToolbar>
          <div className="flex items-center">
            <Checkbox
              id="select-all"
              checked={selectAllChecked}
              onCheckedChange={handleSelectAll}
              aria-label={tCommon('aria.selectAll')}
              disabled={isLoading}
            />
          </div>

          {hasSelectedItems ? (
            <>
              {status === 'open' && (
                <Button
                  size="sm"
                  onClick={openBulkSendDialog}
                  disabled={isBulkProcessing}
                  className="flex-1"
                >
                  {tConversations('bulk.sendMessages')}
                </Button>
              )}
              {status === 'open' && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleBulkResolve}
                  disabled={isBulkProcessing}
                  className="flex-1"
                >
                  {isBulkProcessing && (
                    <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
                  )}
                  {tConversations('bulk.close')}
                </Button>
              )}
              {status !== 'open' && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleBulkReopen}
                  disabled={isBulkProcessing}
                  className="flex-1"
                >
                  {isBulkProcessing && (
                    <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
                  )}
                  {tConversations('bulk.reopen')}
                </Button>
              )}
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
        {isBulkProcessing && (
          <LoadingOverlay message={tConversations('updating')} />
        )}
      </ConversationListPanel>

      <div
        className={cn(
          'flex-1 min-w-0',
          selectedConversationId ? 'flex' : 'hidden md:flex',
        )}
      >
        {isLoading ? (
          <ConversationPanelSkeleton />
        ) : (
          <ConversationPanel
            selectedConversationId={selectedConversationId}
            onSelectedConversationChange={setSelectedConversationId}
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
