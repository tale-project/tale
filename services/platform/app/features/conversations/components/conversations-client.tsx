'use client';

import { Loader2Icon } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';

import type { ConversationItem } from '@/convex/conversations/types';

import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { Button } from '@/app/components/ui/primitives/button';
import { toast } from '@/app/hooks/use-toast';
import { toId, toIds } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { filterByTextSearch } from '@/lib/utils/client-utils';
import { cn } from '@/lib/utils/cn';

import type { Conversation } from '../types';

import {
  useConversationCollection,
  useConversations,
} from '../hooks/collections';
import {
  useAddMessage,
  useBulkCloseConversations,
  useBulkReopenConversations,
} from '../hooks/mutations';
import { ActivateConversationsEmptyState } from './activate-conversations-empty-state';
import { ConversationPanel } from './conversation-panel';
import { ConversationsList } from './conversations-list';

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
      <div className="border-border relative flex w-full flex-col overflow-y-auto border-r md:max-w-[24.75rem] md:flex-[0_0_24.75rem]">
        {/* Sticky header skeleton */}
        <div className="bg-background/50 border-border sticky top-0 z-10 flex h-16 items-center gap-2.5 border-b p-4 backdrop-blur-sm">
          <div className="border-muted bg-background size-4 rounded border-2" />
          <div className="relative flex-1">
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        </div>

        {/* Conversation list skeleton */}
        <div className="divide-border divide-y">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="p-4">
              <div className="flex items-start gap-3">
                <div className="mt-1 flex items-center">
                  <div className="border-muted bg-background size-4 rounded border-2" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-start justify-between">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="ml-4 h-3 w-12" />
                  </div>
                  <div className="mb-3 flex items-center justify-between gap-2">
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
      <div className="hidden min-w-0 flex-1 flex-col md:flex">
        {/* Header skeleton */}
        <div className="bg-background/50 border-border sticky top-0 z-50 flex h-16 flex-[0_0_auto] border-b px-4 py-3 backdrop-blur-sm">
          <div className="flex flex-1 items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </div>

        {/* Messages skeleton */}
        <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6">
          <div className="mb-8 flex flex-col gap-4">
            <div className="flex justify-start">
              <div className="relative">
                <Skeleton className="h-24 w-96 rounded-2xl" />
                <Skeleton className="mt-1 h-3 w-20" />
              </div>
            </div>
            <div className="flex justify-end">
              <Skeleton className="h-20 w-80 rounded-2xl" />
            </div>
            <div className="flex justify-start">
              <div className="relative">
                <Skeleton className="h-16 w-72 rounded-2xl" />
                <Skeleton className="mt-1 h-3 w-20" />
              </div>
            </div>
          </div>
        </div>

        {/* Message editor skeleton */}
        <div className="bg-background sticky bottom-0 z-50 px-2">
          <div className="mx-auto w-full max-w-3xl px-4 py-4">
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </>
  );
}

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

  const conversationCollection = useConversationCollection(organizationId);
  const { conversations: allConversations, isLoading } = useConversations(
    conversationCollection,
  );

  // Client-side filtering by status, priority, and search
  const filteredConversations = useMemo(() => {
    if (!allConversations) return [];

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Collection returns ConversationItem from transform; cast to preserve narrow type
    let data = [...allConversations] as ConversationItem[];

    if (status) {
      data = data.filter((c) => c.status === status);
    }

    if (initialPriority) {
      data = data.filter((c) => c.priority === initialPriority);
    }

    const searchTerm = searchQuery || initialSearch;
    if (searchTerm) {
      data = filterByTextSearch(data, searchTerm, [
        'title',
        'description',
        'subject',
        'externalMessageId',
      ]);
    }

    return data;
  }, [allConversations, status, initialPriority, searchQuery, initialSearch]);

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

  if (isLoading) {
    return <ConversationsClientSkeleton />;
  }

  const conversations = filteredConversations;

  if (conversations.length === 0 && !searchQuery && !initialSearch) {
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
            conversationId: toId<'conversations'>(conversationId),
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
        conversationIds: toIds<'conversations'>(conversationIds),
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
        conversationIds: toIds<'conversations'>(conversationIds),
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
                    <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
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

      {/* Right Panel - Conversation Details */}
      <div
        className={cn(
          'flex-1 min-w-0',
          selectedConversationId ? 'flex' : 'hidden md:flex',
        )}
      >
        <ConversationPanel
          selectedConversationId={selectedConversationId}
          organizationId={organizationId}
          onSelectedConversationChange={setSelectedConversationId}
        />
      </div>

      {bulkSendMessagesDialog.isOpen && (
        <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-background mx-4 w-full max-w-md rounded-lg border p-6">
            <h3 className="mb-4 text-lg font-semibold">
              {tConversations('bulkSend.title', { count: selectedCount })}
            </h3>
            <p className="text-muted-foreground mb-6">
              {tConversations('bulkSend.description', { count: selectedCount })}
            </p>
            <div className="flex justify-end gap-3">
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
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
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
