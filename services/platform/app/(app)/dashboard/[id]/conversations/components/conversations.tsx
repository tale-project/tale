'use client';

import { useState, useMemo, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2Icon } from 'lucide-react';
import { ConversationPanel } from './conversation-panel';
import { ConversationsList } from './conversations-list';
import { FilterDropdown } from './filter-dropdown';
import { BulkSendMessagesDialog } from './bulk-send-messages-dialog';
import { useConversationFilters } from '@/hooks/use-conversation-filters';
import { FilterStatusIndicator } from './filter-status-indicator';
import { ActivateConversationsEmptyState } from './activate-conversations-empty-state';
import { cn } from '@/lib/utils/cn';
import { toast } from '@/hooks/use-toast';
import { useParams } from 'next/navigation';
import { usePreloadedQuery, type Preloaded } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { ConversationItem } from '@/convex/model/conversations/types';
import { useBulkCloseConversations } from '../hooks/use-bulk-close-conversations';
import { useBulkReopenConversations } from '../hooks/use-bulk-reopen-conversations';
import { useAddMessage } from '../hooks/use-add-message';
import type { Conversation } from '../types';
import { useT } from '@/lib/i18n';

export interface ConversationsProps {
  status?: Conversation['status'];
  preloadedConversations: Preloaded<
    typeof api.conversations.getConversationsPage
  >;
  preloadedEmailProviders: Preloaded<typeof api.email_providers.list>;
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

export function Conversations({
  status,
  preloadedConversations,
  preloadedEmailProviders,
}: ConversationsProps) {
  const { id: businessId } = useParams();
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);

  // Translations
  const { t: tChat } = useT('chat');
  const { t: tConversations } = useT('conversations');
  const { t: tCommon } = useT('common');

  // Use preloaded data with real-time reactivity
  // This provides SSR benefits AND automatic updates when data changes
  const conversationsResult = usePreloadedQuery(preloadedConversations);
  const emailProviders = usePreloadedQuery(preloadedEmailProviders);

  // Extract conversations from result
  const conversations: ConversationItem[] = conversationsResult?.conversations ?? [];
  const hasEmailProviders = (emailProviders?.length ?? 0) > 0;

  // Convex mutations
  const bulkResolve = useBulkCloseConversations();
  const bulkReopen = useBulkReopenConversations();
  const addMessage = useAddMessage();

  // Use URL-based filtering with optimistic updates
  const {
    searchQuery,
    filters,
    isLoading: isLoadingFilters,
    applyFilters,
    setSearchQuery,
    setFilters,
    clearSearch,
    clearFilter,
  } = useConversationFilters();
  const [selectionState, setSelectionState] = useState<SelectionState>({
    type: 'individual',
    selectedIds: new Set(),
  });
  const [isLoading, setIsLoading] = useState(false);
  const [bulkSendMessagesDialog, setBulkSendMessagesDialog] = useState({
    isOpen: false,
    isSending: false,
  });

  // Use conversations directly since server-side filtering is already applied
  const filteredConversations = conversations;

  const handleConversationSelect = useCallback((conversation: Conversation) => {
    setSelectedConversationId(conversation.id);
  }, []);

  const handleConversationCheck = useCallback(
    (conversationId: string, checked: boolean) => {
      if (selectionState.type === 'all') {
        // If we're in "select all" mode, switch to individual mode
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
        // Individual selection mode
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
    [selectionState, filteredConversations],
  );

  const handleSelectAll = useCallback((checked: boolean | 'indeterminate') => {
    if (typeof checked !== 'boolean') return;

    if (checked) {
      setSelectionState({ type: 'all' });
    } else {
      setSelectionState({ type: 'individual', selectedIds: new Set() });
    }
  }, []);

  const isConversationSelected = useCallback(
    (conversationId: string): boolean => {
      if (selectionState.type === 'all') {
        return true;
      }
      return selectionState.selectedIds.has(conversationId);
    },
    [selectionState],
  );

  // Memoize selection state calculations to avoid recalculating on every render
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
          conversationCount > 0 && selectedInFilteredCount === conversationCount,
        isSelectAllIndeterminate:
          selectedInFilteredCount > 0 &&
          selectedInFilteredCount < conversationCount,
        selectedCount: selectedIds.size,
      };
    }, [selectionState, filteredConversations]);

  // Check if any items are selected AND there are conversations available
  const hasSelectedItems =
    filteredConversations.length > 0 &&
    (selectionState.type === 'all' || selectionState.selectedIds.size > 0);

  const handleApproveSelected = useCallback(() => {
    setBulkSendMessagesDialog({
      isOpen: true,
      isSending: false,
    });
  }, []);

  const handleSendMessages = async () => {
    if (!businessId || typeof businessId !== 'string') {
      toast({
        title: tCommon('errors.organizationNotFound'),
        variant: 'destructive',
      });
      return;
    }

    setBulkSendMessagesDialog({
      isOpen: true,
      isSending: true,
    });

    try {
      const conversationIds = isAllSelection(selectionState)
        ? filteredConversations.map((c) => c._id)
        : Array.from(selectionState.selectedIds);

      // Send messages to all selected conversations in parallel
      const results = await Promise.allSettled(
        conversationIds.map((conversationId) =>
          addMessage({
            conversationId: conversationId as Id<'conversations'>,
            organizationId: businessId as string,
            sender: 'Agent', // TODO: Get from user context
            content: 'Message sent', // TODO: Get actual message content
            isCustomer: false,
            status: 'sent',
          }),
        ),
      );

      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failedCount = results.filter((r) => r.status === 'rejected').length;

      // Log failed messages for debugging
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(
            `Failed to send message to ${conversationIds[index]}:`,
            result.reason,
          );
        }
      });

      toast({
        title: tConversations('bulk.messagesSent'),
        description: tConversations('bulk.messagesSentDescription', { successCount, failedCount }),
        variant: successCount > 0 ? 'default' : 'destructive',
      });

      setBulkSendMessagesDialog({
        isOpen: false,
        isSending: false,
      });

      // Clear selection - Convex real-time reactivity handles data updates
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
    }
  };

  const handleBulkResolveConversations = async () => {
    if (!businessId || typeof businessId !== 'string') {
      toast({
        title: tCommon('errors.organizationNotFound'),
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);

    try {
      const conversationIds = isAllSelection(selectionState)
        ? filteredConversations.map((c) => c._id)
        : Array.from(selectionState.selectedIds);

      const result = await bulkResolve({
        conversationIds: conversationIds as Id<'conversations'>[],
      });

      toast({
        title: tConversations('bulk.resolved'),
        description: tConversations('bulk.resolvedDescription', { successCount: result.successCount, failedCount: result.failedCount }),
        variant: result.successCount > 0 ? 'default' : 'destructive',
      });

      // Clear selection - Convex real-time reactivity handles data updates
      setSelectionState({ type: 'individual', selectedIds: new Set() });
      setSelectedConversationId(null);
    } catch (error) {
      console.error('Error resolving conversations:', error);
      toast({
        title: tConversations('bulk.resolveFailed'),
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };

  const handleReopenConversations = async () => {
    if (!businessId || typeof businessId !== 'string') {
      toast({
        title: tCommon('errors.organizationNotFound'),
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);

    try {
      const conversationIds = isAllSelection(selectionState)
        ? filteredConversations.map((c) => c._id)
        : Array.from(selectionState.selectedIds);

      const result = await bulkReopen({
        conversationIds: conversationIds as Id<'conversations'>[],
      });

      toast({
        title: tConversations('bulk.reopened'),
        description: tConversations('bulk.reopenedDescription', { successCount: result.successCount, failedCount: result.failedCount }),
        variant: result.successCount > 0 ? 'default' : 'destructive',
      });

      // Clear selection - Convex real-time reactivity handles data updates
      setSelectionState({ type: 'individual', selectedIds: new Set() });
      setSelectedConversationId(null);
    } catch (error) {
      console.error('Error reopening conversations:', error);
      toast({
        title: tConversations('bulk.reopenFailed'),
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };

  const selectAllChecked = isSelectAllIndeterminate
    ? 'indeterminate'
    : isSelectAllChecked;

  // Show empty state when there are no conversations and no email providers configured
  const showActivateEmptyState =
    conversations.length === 0 && !hasEmailProviders;

  if (showActivateEmptyState) {
    return (
      <ActivateConversationsEmptyState organizationId={businessId as string} />
    );
  }

  return (
    <>
      <div className="flex justify-stretch size-full flex-1 max-h-[calc(100%-6rem)]">
        {/* Left Panel - Conversation List - hidden on mobile when conversation is selected */}
        <div className={cn(
          "flex flex-col border-r border-border overflow-y-auto relative",
          "w-full md:flex-[0_0_24.75rem] md:max-w-[24.75rem]",
          selectedConversationId ? "hidden md:flex" : "flex"
        )}>
          {/* Fixed Search and Filter Section / Action Buttons */}
          <div className="flex bg-background/50 backdrop-blur-sm items-center p-4 gap-2.5 border-b border-border sticky top-0 z-10 h-16">
            {/* Select All Checkbox */}
            <div className="flex items-center">
              <Checkbox
                id="select-all"
                checked={selectAllChecked}
                onCheckedChange={handleSelectAll}
                aria-label={tCommon('aria.selectAll')}
              />
            </div>

            {hasSelectedItems ? (
              /* Action Buttons when items are selected */
              <>
                {status === 'open' && (
                  <Button
                    size="sm"
                    onClick={handleApproveSelected}
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
                    className="flex-1"
                  >
                    {tConversations('bulk.close')}
                  </Button>
                )}
                {status !== 'open' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleReopenConversations}
                    className="flex-1"
                  >
                    {tConversations('bulk.reopen')}
                  </Button>
                )}
              </>
            ) : (
              /* Search and Filter when no items are selected */
              <>
                {/* Search Input */}
                <div
                  className={cn(
                    'relative flex-1',
                    isLoadingFilters && 'animate-pulse pointer-events-none',
                  )}
                >
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    placeholder={tChat('searchConversations')}
                    size="sm"
                    className="pl-9 pr-3 bg-transparent shadow-none text-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        applyFilters();
                      }
                    }}
                  />
                </div>

                {/* Filter Dropdown */}
                <FilterDropdown
                  filters={filters}
                  onFiltersChange={setFilters}
                  isLoading={isLoadingFilters}
                />
              </>
            )}
          </div>

          {/* Filter Status Indicator */}
          <FilterStatusIndicator
            searchQuery={searchQuery}
            filters={filters}
            isLoading={isLoadingFilters}
            onClearSearch={clearSearch}
            onClearFilter={clearFilter}
          />

          {/* Scrollable Conversation List */}
          <ConversationsList
            conversations={filteredConversations}
            selectedConversationId={selectedConversationId}
            onConversationSelect={handleConversationSelect}
            onConversationCheck={handleConversationCheck}
            isConversationSelected={isConversationSelected}
          />
          {(isLoading || isLoadingFilters) && (
            <div className="absolute inset-0 bg-background/50 backdrop-blur-sm z-10 flex items-center justify-center">
              <div className="flex items-center text-muted-foreground">
                <Loader2Icon className="size-4 mr-2 animate-spin" />
                <span className="text-sm">{tConversations('updating')}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Conversation Details - full width on mobile when conversation is selected */}
        <div className={cn(
          "flex-1 min-w-0",
          selectedConversationId ? "flex" : "hidden md:flex"
        )}>
          <ConversationPanel
            selectedConversationId={selectedConversationId}
            onSelectedConversationChange={setSelectedConversationId}
          />
        </div>
      </div>

      <BulkSendMessagesDialog
        open={bulkSendMessagesDialog.isOpen}
        onOpenChange={(open) =>
          setBulkSendMessagesDialog({ ...bulkSendMessagesDialog, isOpen: open })
        }
        selectedCount={selectedCount}
        onSend={handleSendMessages}
        isLoading={bulkSendMessagesDialog.isSending}
      />
    </>
  );
}
