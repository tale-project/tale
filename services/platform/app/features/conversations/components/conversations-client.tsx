'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, usePaginatedQuery } from 'convex/react';
import { Input } from '@/app/components/ui/forms/input';
import { Button } from '@/app/components/ui/primitives/button';
import { Search, Loader2Icon } from 'lucide-react';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { ConversationPanel } from './conversation-panel';
import { ConversationsList } from './conversations-list';
import { ActivateConversationsEmptyState } from './activate-conversations-empty-state';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { cn } from '@/lib/utils/cn';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { ConversationItem } from '@/convex/conversations/types';
import { useBulkCloseConversations } from '../hooks/use-bulk-close-conversations';
import { useBulkReopenConversations } from '../hooks/use-bulk-reopen-conversations';
import { useAddMessage } from '../hooks/use-add-message';
import type { Conversation } from '../types';
import { useT } from '@/lib/i18n/client';
import { filterByTextSearch, filterByFields, sortByDate } from '@/lib/utils/client-utils';

interface ConversationsClientProps {
  status?: Conversation['status'];
  organizationId: string;
  page?: number;
  limit?: number;
  priority?: string;
  category?: string;
  search?: string;
}

type SelectionState =
  | {
      type: 'individual';
      selectedIds: Set<string>;
    }
  | {
      type: 'all';
    };

function isAllSelection(state: SelectionState): state is { type: 'all' } {
  return state.type === 'all';
}

function ConversationsClientSkeleton() {
  return (
    <>
      {/* Left Panel - Conversation List Skeleton */}
      <div className="flex flex-col border-r border-border overflow-y-auto relative w-full md:flex-[0_0_24.75rem] md:max-w-[24.75rem]">
        {/* Sticky header skeleton */}
        <div className="flex bg-background/50 backdrop-blur-sm items-center p-4 gap-2.5 border-b border-border sticky top-0 z-10 h-16">
          <div className="size-4 rounded border-2 border-muted bg-background" />
          <div className="relative flex-1">
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        </div>

        {/* Conversation list skeleton */}
        <div className="divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex items-center mt-1">
                  <div className="size-4 rounded border-2 border-muted bg-background" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between mb-1.5">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-12 ml-4" />
                  </div>
                  <div className="flex items-center justify-between mb-3 gap-2">
                    <Skeleton className="h-4 w-full" />
                  </div>
                  <div className="flex gap-2">
                    {i % 3 === 0 && (
                      <Skeleton className="h-5 w-16 rounded-full" />
                    )}
                    {i % 2 === 0 && (
                      <Skeleton className="h-5 w-20 rounded-full" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Panel - Conversation Detail Skeleton */}
      <div className="flex-1 min-w-0 hidden md:flex flex-col">
        {/* Header skeleton */}
        <div className="flex px-4 py-3 flex-[0_0_auto] bg-background/50 backdrop-blur-sm h-16 sticky top-0 z-50 border-b border-border">
          <div className="flex items-center gap-3 flex-1">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-col gap-1.5 flex-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </div>

        {/* Messages skeleton */}
        <div className="pt-6 mx-auto max-w-3xl flex-1 w-full px-4">
          <div className="flex flex-col gap-4 mb-8">
            <div className="flex justify-start">
              <div className="relative">
                <Skeleton className="h-24 w-96 rounded-2xl" />
                <Skeleton className="h-3 w-20 mt-1" />
              </div>
            </div>
            <div className="flex justify-end">
              <Skeleton className="h-20 w-80 rounded-2xl" />
            </div>
            <div className="flex justify-start">
              <div className="relative">
                <Skeleton className="h-16 w-72 rounded-2xl" />
                <Skeleton className="h-3 w-20 mt-1" />
              </div>
            </div>
          </div>
        </div>

        {/* Message editor skeleton */}
        <div className="sticky bottom-0 z-50 bg-background px-2">
          <div className="max-w-3xl mx-auto w-full px-4 py-4">
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </>
  );
}

const PAGE_SIZE = 25;

export function ConversationsClient({
  status,
  organizationId,
  page: _page = 1,
  limit: _limit = 20,
  priority: initialPriority,
  category: _initialCategory,
  search: initialSearch,
}: ConversationsClientProps) {
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);

  // Local search state
  const [searchQuery, setSearchQuery] = useState(initialSearch || '');

  // Translations
  const { t: tChat } = useT('chat');
  const { t: tConversations } = useT('conversations');
  const { t: tCommon } = useT('common');

  // Fetch conversations with cursor-based pagination
  const { results, status: paginationStatus, loadMore, isLoading } = usePaginatedQuery(
    api.conversations.queries.listConversations,
    { organizationId },
    { initialNumItems: PAGE_SIZE },
  );

  // Client-side filtering
  const filteredConversations = useMemo(() => {
    if (!results) return [];

    let data = [...results] as ConversationItem[];

    // Filter by status
    if (status) {
      data = data.filter((c) => c.status === status);
    }

    // Filter by priority
    if (initialPriority) {
      data = data.filter((c) => c.priority === initialPriority);
    }

    // Filter by search
    const searchTerm = searchQuery || initialSearch;
    if (searchTerm) {
      data = filterByTextSearch(data, searchTerm, [
        'title',
        'description',
        'subject',
        'externalMessageId',
      ]);
    }

    // Sort by lastMessageAt descending
    return data.sort((a, b) => {
      const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : a._creationTime;
      const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : b._creationTime;
      return bTime - aTime;
    });
  }, [results, status, initialPriority, searchQuery, initialSearch]);

  // Fetch email providers
  const emailProviders = useQuery(api.email_providers.queries.list, {
    organizationId,
  });

  // Convex mutations
  const bulkResolve = useBulkCloseConversations();
  const bulkReopen = useBulkReopenConversations();
  const addMessage = useAddMessage();

  const [selectionState, setSelectionState] = useState<SelectionState>({
    type: 'individual',
    selectedIds: new Set(),
  });
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkSendMessagesDialog, setBulkSendMessagesDialog] = useState({
    isOpen: false,
    isSending: false,
  });

  // Load more when needed (if filtered results are less than available)
  useMemo(() => {
    if (
      paginationStatus === 'CanLoadMore' &&
      filteredConversations.length < PAGE_SIZE &&
      !isLoading
    ) {
      loadMore(PAGE_SIZE);
    }
  }, [paginationStatus, filteredConversations.length, isLoading, loadMore]);

  // Show skeleton while loading
  if (isLoading && !results) {
    return <ConversationsClientSkeleton />;
  }

  if (emailProviders === undefined) {
    return <ConversationsClientSkeleton />;
  }

  // Use filtered conversations
  const conversations = filteredConversations;
  const hasEmailProviders = (emailProviders?.length ?? 0) > 0;

  // Show empty state when there are no conversations and no email providers configured
  const showActivateEmptyState =
    conversations.length === 0 &&
    !hasEmailProviders &&
    !searchQuery &&
    !initialSearch;

  if (showActivateEmptyState) {
    return <ActivateConversationsEmptyState organizationId={organizationId} />;
  }

  return (
    <ConversationsClientInner
      status={status}
      organizationId={organizationId}
      conversations={conversations}
      selectedConversationId={selectedConversationId}
      setSelectedConversationId={setSelectedConversationId}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      isBulkProcessing={isBulkProcessing}
      setIsBulkProcessing={setIsBulkProcessing}
      selectionState={selectionState}
      setSelectionState={setSelectionState}
      bulkSendMessagesDialog={bulkSendMessagesDialog}
      setBulkSendMessagesDialog={setBulkSendMessagesDialog}
      bulkResolve={bulkResolve}
      bulkReopen={bulkReopen}
      addMessage={addMessage}
      tChat={tChat}
      tConversations={tConversations}
      tCommon={tCommon}
    />
  );
}

interface ConversationsClientInnerProps {
  status?: Conversation['status'];
  organizationId: string;
  conversations: ConversationItem[];
  selectedConversationId: string | null;
  setSelectedConversationId: (id: string | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isBulkProcessing: boolean;
  setIsBulkProcessing: (processing: boolean) => void;
  selectionState: SelectionState;
  setSelectionState: (state: SelectionState) => void;
  bulkSendMessagesDialog: { isOpen: boolean; isSending: boolean };
  setBulkSendMessagesDialog: (dialog: {
    isOpen: boolean;
    isSending: boolean;
  }) => void;
  bulkResolve: ReturnType<typeof useBulkCloseConversations>;
  bulkReopen: ReturnType<typeof useBulkReopenConversations>;
  addMessage: ReturnType<typeof useAddMessage>;
  tChat: ReturnType<typeof useT>['t'];
  tConversations: ReturnType<typeof useT>['t'];
  tCommon: ReturnType<typeof useT>['t'];
}

function ConversationsClientInner({
  status,
  organizationId,
  conversations,
  selectedConversationId,
  setSelectedConversationId,
  searchQuery,
  setSearchQuery,
  isBulkProcessing,
  setIsBulkProcessing,
  selectionState,
  setSelectionState,
  bulkSendMessagesDialog,
  setBulkSendMessagesDialog,
  bulkResolve,
  bulkReopen,
  addMessage,
  tChat,
  tConversations,
  tCommon,
}: ConversationsClientInnerProps) {
  const filteredConversations = conversations;

  const handleConversationSelect = useCallback(
    (conversation: Conversation) => {
      setSelectedConversationId(conversation.id);
    },
    [setSelectedConversationId],
  );

  const handleConversationCheck = useCallback(
    (conversationId: string, checked: boolean) => {
      if (selectionState.type === 'all') {
        const newSelectedIds: Set<string> = new Set(
          filteredConversations.map((c) => c.id),
        );
        if (!checked) {
          newSelectedIds.delete(conversationId);
        }
        setSelectionState({
          type: 'individual',
          selectedIds: newSelectedIds,
        });
      } else {
        const newSelectedIds = new Set(selectionState.selectedIds);
        if (checked) {
          newSelectedIds.add(conversationId);
        } else {
          newSelectedIds.delete(conversationId);
        }
        setSelectionState({
          type: 'individual',
          selectedIds: newSelectedIds,
        });
      }
    },
    [selectionState, filteredConversations, setSelectionState],
  );

  const handleSelectAll = useCallback(
    (checked: boolean | 'indeterminate') => {
      if (typeof checked !== 'boolean') return;

      if (checked) {
        setSelectionState({ type: 'all' });
      } else {
        setSelectionState({ type: 'individual', selectedIds: new Set() });
      }
    },
    [setSelectionState],
  );

  const isConversationSelected = useCallback(
    (conversationId: string): boolean => {
      if (selectionState.type === 'all') {
        return true;
      }
      return selectionState.selectedIds.has(conversationId);
    },
    [selectionState],
  );

  const { isSelectAllChecked, isSelectAllIndeterminate, selectedCount } =
    useMemo(() => {
      if (selectionState.type === 'all') {
        return {
          isSelectAllChecked: true,
          isSelectAllIndeterminate: false,
          selectedCount: filteredConversations.length,
        };
      }

      const selectedIds = selectionState.selectedIds;
      const conversationCount = filteredConversations.length;
      const selectedInFilteredCount = filteredConversations.filter((c) =>
        selectedIds.has(c._id),
      ).length;

      return {
        isSelectAllChecked:
          conversationCount > 0 &&
          selectedInFilteredCount === conversationCount,
        isSelectAllIndeterminate:
          selectedInFilteredCount > 0 &&
          selectedInFilteredCount < conversationCount,
        selectedCount: selectedIds.size,
      };
    }, [selectionState, filteredConversations]);

  const hasSelectedItems =
    filteredConversations.length > 0 &&
    (selectionState.type === 'all' || selectionState.selectedIds.size > 0);

  const handleApproveSelected = useCallback(() => {
    setBulkSendMessagesDialog({
      isOpen: true,
      isSending: false,
    });
  }, [setBulkSendMessagesDialog]);

  const handleSendMessages = async () => {
    if (isBulkProcessing) return;

    setIsBulkProcessing(true);
    setBulkSendMessagesDialog({
      isOpen: true,
      isSending: true,
    });

    try {
      const conversationIds = isAllSelection(selectionState)
        ? filteredConversations.map((c) => c._id)
        : Array.from(selectionState.selectedIds);

      const results = await Promise.allSettled(
        conversationIds.map((conversationId) =>
          addMessage({
            conversationId: conversationId as Id<'conversations'>,
            organizationId,
            sender: 'Agent',
            content: 'Message sent',
            isCustomer: false,
            status: 'sent',
          }),
        ),
      );

      const successCount = results.filter(
        (r) => r.status === 'fulfilled',
      ).length;
      const failedCount = results.filter((r) => r.status === 'rejected').length;

      toast({
        title: tConversations('bulk.messagesSent'),
        description: tConversations('bulk.messagesSentDescription', {
          successCount,
          failedCount,
        }),
        variant: successCount > 0 ? 'default' : 'destructive',
      });

      setBulkSendMessagesDialog({
        isOpen: false,
        isSending: false,
      });

      setSelectionState({ type: 'individual', selectedIds: new Set() });
      setSelectedConversationId(null);
    } catch (error) {
      console.error('Error sending messages:', error);
      toast({
        title: tConversations('bulk.sendFailed'),
        variant: 'destructive',
      });
      setBulkSendMessagesDialog({
        isOpen: false,
        isSending: false,
      });
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleBulkResolveConversations = async () => {
    if (isBulkProcessing) return;

    setIsBulkProcessing(true);

    try {
      const conversationIds = isAllSelection(selectionState)
        ? filteredConversations.map((c) => c._id)
        : Array.from(selectionState.selectedIds);

      const result = await bulkResolve({
        conversationIds: conversationIds as Id<'conversations'>[],
      });

      toast({
        title: tConversations('bulk.resolved'),
        description: tConversations('bulk.resolvedDescription', {
          successCount: result.successCount,
          failedCount: result.failedCount,
        }),
        variant: result.successCount > 0 ? 'default' : 'destructive',
      });

      setSelectionState({ type: 'individual', selectedIds: new Set() });
      setSelectedConversationId(null);
    } catch (error) {
      console.error('Error resolving conversations:', error);
      toast({
        title: tConversations('bulk.resolveFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleReopenConversations = async () => {
    if (isBulkProcessing) return;

    setIsBulkProcessing(true);

    try {
      const conversationIds = isAllSelection(selectionState)
        ? filteredConversations.map((c) => c._id)
        : Array.from(selectionState.selectedIds);

      const result = await bulkReopen({
        conversationIds: conversationIds as Id<'conversations'>[],
      });

      toast({
        title: tConversations('bulk.reopened'),
        description: tConversations('bulk.reopenedDescription', {
          successCount: result.successCount,
          failedCount: result.failedCount,
        }),
        variant: result.successCount > 0 ? 'default' : 'destructive',
      });

      setSelectionState({ type: 'individual', selectedIds: new Set() });
      setSelectedConversationId(null);
    } catch (error) {
      console.error('Error reopening conversations:', error);
      toast({
        title: tConversations('bulk.reopenFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const selectAllChecked = isSelectAllIndeterminate
    ? 'indeterminate'
    : isSelectAllChecked;

  return (
    <>
      {/* Left Panel - Conversation List */}
      <div
        className={cn(
          'flex flex-col border-r border-border overflow-y-auto relative',
          'w-full md:flex-[0_0_24.75rem] md:max-w-[24.75rem]',
          selectedConversationId ? 'hidden md:flex' : 'flex',
        )}
      >
        {/* Fixed Search and Filter Section / Action Buttons */}
        <div className="flex bg-background/50 backdrop-blur-sm items-center p-4 gap-2.5 border-b border-border sticky top-0 z-10 h-16">
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
                  onClick={handleApproveSelected}
                  disabled={isBulkProcessing}
                  className="flex-1"
                >
                  {tConversations('bulk.sendMessages')}
                </Button>
              )}
              {status === 'open' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBulkResolveConversations}
                  disabled={isBulkProcessing}
                  className="flex-1"
                >
                  {isBulkProcessing && (
                    <Loader2Icon className="size-3.5 mr-1.5 animate-spin" />
                  )}
                  {tConversations('bulk.close')}
                </Button>
              )}
              {status !== 'open' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReopenConversations}
                  disabled={isBulkProcessing}
                  className="flex-1"
                >
                  {isBulkProcessing && (
                    <Loader2Icon className="size-3.5 mr-1.5 animate-spin" />
                  )}
                  {tConversations('bulk.reopen')}
                </Button>
              )}
            </>
          ) : (
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder={tChat('searchConversations')}
                size="sm"
                className="pl-9 pr-3 bg-transparent shadow-none text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          )}
        </div>

        <ConversationsList
          conversations={filteredConversations}
          selectedConversationId={selectedConversationId}
          onConversationSelect={handleConversationSelect}
          onConversationCheck={handleConversationCheck}
          isConversationSelected={isConversationSelected}
        />
        {isBulkProcessing && (
          <div className="absolute inset-0 bg-background/50 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="flex items-center text-muted-foreground">
              <Loader2Icon className="size-4 mr-2 animate-spin" />
              <span className="text-sm">{tConversations('updating')}</span>
            </div>
          </div>
        )}
      </div>

      {/* Right Panel - Conversation Details */}
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

      {bulkSendMessagesDialog.isOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-background border rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              {tConversations('bulkSend.title', { count: selectedCount })}
            </h3>
            <p className="text-muted-foreground mb-6">
              {tConversations('bulkSend.description', { count: selectedCount })}
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() =>
                  setBulkSendMessagesDialog({ isOpen: false, isSending: false })
                }
                disabled={bulkSendMessagesDialog.isSending}
              >
                {tCommon('actions.cancel')}
              </Button>
              <Button
                onClick={handleSendMessages}
                disabled={bulkSendMessagesDialog.isSending}
              >
                {bulkSendMessagesDialog.isSending && (
                  <Loader2Icon className="size-4 mr-2 animate-spin" />
                )}
                {tConversations('bulkSend.send')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
