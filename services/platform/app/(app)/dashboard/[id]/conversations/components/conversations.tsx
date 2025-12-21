'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2Icon } from 'lucide-react';
import ConversationPanel from './conversation-panel';
import ConversationsList from './conversations-list';
import FilterDropdown from './filter-dropdown';
import { BulkSendMessagesDialog } from './bulk-send-messages-dialog';
import { useConversationFilters } from '@/hooks/use-conversation-filters';
import FilterStatusIndicator from './filter-status-indicator';
import ActivateConversationsEmptyState from './activate-conversations-empty-state';
import { cn } from '@/lib/utils/cn';
import { toast } from '@/hooks/use-toast';
import { useParams } from 'next/navigation';
import { useMutation, usePreloadedQuery, type Preloaded } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import type { Conversation } from '../types';

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

export default function Conversations({
  status,
  preloadedConversations,
  preloadedEmailProviders,
}: ConversationsProps) {
  const { id: businessId } = useParams();
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);

  // Use preloaded data with real-time reactivity
  // This provides SSR benefits AND automatic updates when data changes
  const conversationsResult = usePreloadedQuery(preloadedConversations);
  const emailProviders = usePreloadedQuery(preloadedEmailProviders);

  // Extract conversations from result
  const conversations = conversationsResult?.conversations || [];
  const hasEmailProviders = (emailProviders?.length ?? 0) > 0;

  // Convex mutations
  const bulkResolve = useMutation(api.conversations.bulkCloseConversations);
  const bulkReopen = useMutation(api.conversations.bulkReopenConversations);
  const addMessage = useMutation(api.conversations.addMessageToConversation);

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

  const handleConversationSelect = (conversation: Conversation) => {
    setSelectedConversationId(conversation.id);
  };

  const handleConversationCheck = (
    conversationId: string,
    checked: boolean,
  ) => {
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
  };

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    if (typeof checked !== 'boolean') return;

    if (checked) {
      setSelectionState({ type: 'all' });
    } else {
      setSelectionState({ type: 'individual', selectedIds: new Set() });
    }
  };

  const isConversationSelected = (conversationId: string): boolean => {
    if (selectionState.type === 'all') {
      return true;
    }
    return selectionState.selectedIds.has(conversationId);
  };

  const isSelectAllChecked = (): boolean => {
    if (selectionState.type === 'all') {
      return true;
    }
    return (
      filteredConversations.length > 0 &&
      filteredConversations.every((c) => selectionState.selectedIds.has(c._id))
    );
  };

  const isSelectAllIndeterminate = (): boolean => {
    if (selectionState.type === 'all') {
      return false;
    }
    const selectedCount = filteredConversations.filter((c) =>
      selectionState.selectedIds.has(c._id),
    ).length;
    return selectedCount > 0 && selectedCount < filteredConversations.length;
  };

  // Check if any items are selected AND there are conversations available
  const hasSelectedItems =
    filteredConversations.length > 0 &&
    (selectionState.type === 'all' || selectionState.selectedIds.size > 0);

  const handleApproveSelected = () => {
    setBulkSendMessagesDialog({
      isOpen: true,
      isSending: false,
    });
  };

  const selectedCount = isAllSelection(selectionState)
    ? filteredConversations.length
    : selectionState.selectedIds.size;

  const handleSendMessages = async () => {
    if (!businessId || typeof businessId !== 'string') {
      toast({
        title: 'Business ID not found',
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

      // Send messages to all selected conversations
      let successCount = 0;
      let failedCount = 0;

      for (const conversationId of conversationIds) {
        try {
          await addMessage({
            conversationId: conversationId as Id<'conversations'>,
            organizationId: businessId as string,
            sender: 'Agent', // TODO: Get from user context
            content: 'Message sent', // TODO: Get actual message content
            isCustomer: false,
            status: 'sent',
          });
          successCount++;
        } catch (error) {
          console.error(`Failed to send message to ${conversationId}:`, error);
          failedCount++;
        }
      }

      toast({
        title: 'Messages sent',
        description: `Successfully sent ${successCount} messages${failedCount > 0 ? `, ${failedCount} failed` : ''}`,
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
        title: 'Failed to send messages',
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
        title: 'Business ID not found',
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
        title: 'Conversations resolved',
        description: `Successfully resolved ${result.successCount} conversations${result.failedCount > 0 ? `, ${result.failedCount} failed` : ''}`,
        variant: result.successCount > 0 ? 'default' : 'destructive',
      });

      // Clear selection - Convex real-time reactivity handles data updates
      setSelectionState({ type: 'individual', selectedIds: new Set() });
      setSelectedConversationId(null);
    } catch (error) {
      console.error('Error resolving conversations:', error);
      toast({
        title: 'Failed to resolve conversations',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };

  const handleReopenConversations = async () => {
    if (!businessId || typeof businessId !== 'string') {
      toast({
        title: 'Business ID not found',
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
        title: 'Conversations reopened',
        description: `Successfully reopened ${result.successCount} conversations${result.failedCount > 0 ? `, ${result.failedCount} failed` : ''}`,
        variant: result.successCount > 0 ? 'default' : 'destructive',
      });

      // Clear selection - Convex real-time reactivity handles data updates
      setSelectionState({ type: 'individual', selectedIds: new Set() });
      setSelectedConversationId(null);
    } catch (error) {
      console.error('Error reopening conversations:', error);
      toast({
        title: 'Failed to reopen conversations',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };

  const selectAllChecked = isSelectAllIndeterminate()
    ? 'indeterminate'
    : isSelectAllChecked()
      ? true
      : false;

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
        {/* Left Panel - Conversation List */}
        <div className="flex flex-col flex-[0_0_24.75rem] max-w-[24.75rem] border-r border-border overflow-y-auto relative">
          {/* Fixed Search and Filter Section / Action Buttons */}
          <div className="flex bg-background/50 backdrop-blur-sm items-center p-4 gap-2.5 border-b border-border sticky top-0 z-10 h-16">
            {/* Select All Checkbox */}
            <div className="flex items-center">
              <Checkbox
                id="select-all"
                checked={selectAllChecked}
                onCheckedChange={handleSelectAll}
                aria-label="Select all conversations"
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
                    Send messages
                  </Button>
                )}
                {status === 'open' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBulkResolveConversations}
                    className="flex-1"
                  >
                    Close
                  </Button>
                )}
                {status !== 'open' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleReopenConversations}
                    className="flex-1"
                  >
                    Reopen
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
                    placeholder="Search conversations"
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
                <span className="text-sm">Updating conversations...</span>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Conversation Details */}
        <ConversationPanel
          selectedConversationId={selectedConversationId}
          onSelectedConversationChange={setSelectedConversationId}
        />
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
