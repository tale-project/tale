'use client';

import type { UsePaginatedQueryResult } from 'convex/react';

import { Loader2Icon } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';

import type { ConversationItem } from '@/convex/conversations/types';

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
import { ConversationPanel } from './conversation-panel';
import { ConversationsClientSkeleton } from './conversations-client-skeleton';
import { ConversationsList } from './conversations-list';

interface ConversationsClientProps {
  status?: Conversation['status'];
  organizationId: string;
  search?: string;
  paginatedResult: UsePaginatedQueryResult<ConversationItem>;
}

export function ConversationsClient({
  status,
  organizationId,
  search: initialSearch,
  paginatedResult,
}: ConversationsClientProps) {
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);

  const [searchQuery, setSearchQuery] = useState(initialSearch || '');

  const { t: tChat } = useT('chat');
  const { t: tConversations } = useT('conversations');
  const { t: tCommon } = useT('common');

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

  if (paginatedResult.status === 'LoadingFirstPage') {
    return <ConversationsClientSkeleton />;
  }

  if (filteredConversations.length === 0 && !searchQuery && !initialSearch) {
    return <ActivateConversationsEmptyState organizationId={organizationId} />;
  }

  const handleConversationSelect = (conversation: Conversation) => {
    setSelectedConversationId(conversation.id);
  };

  return (
    <>
      <div
        className={cn(
          'flex flex-col border-r border-border overflow-y-auto relative',
          'w-full md:flex-[0_0_24.75rem] md:max-w-[24.75rem]',
          selectedConversationId ? 'hidden md:flex' : 'flex',
        )}
      >
        <div className="bg-background/50 border-border sticky top-0 z-10 flex h-16 items-center gap-2.5 border-b p-4 backdrop-blur-sm">
          <div className="flex items-center">
            <Checkbox
              id="select-all"
              checked={selectAllChecked}
              onCheckedChange={handleSelectAll}
              aria-label={tCommon('aria.selectAll')}
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
            />
          )}
        </div>

        <ConversationsList
          conversations={filteredConversations}
          selectedConversationId={selectedConversationId}
          onConversationSelect={handleConversationSelect}
          onConversationCheck={handleConversationCheck}
          isConversationSelected={isConversationSelected}
          paginationStatus={paginatedResult.status}
          loadMore={paginatedResult.loadMore}
        />
        {isBulkProcessing && (
          <div className="bg-background/50 absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm">
            <div className="text-muted-foreground flex items-center">
              <Loader2Icon className="mr-2 size-4 animate-spin" />
              <span className="text-sm">{tConversations('updating')}</span>
            </div>
          </div>
        )}
      </div>

      <div
        className={cn(
          'flex-1 min-w-0',
          selectedConversationId ? 'flex' : 'hidden md:flex',
        )}
      >
        <ConversationPanel
          selectedConversationId={selectedConversationId}
          onSelectedConversationChange={setSelectedConversationId}
        />
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
