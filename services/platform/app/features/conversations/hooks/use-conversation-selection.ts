import { useState, useMemo, useCallback } from 'react';

import type { ConversationItem } from '@/backend/core/conversations/types';

import type { SelectionState } from '../types/selection';

export function useConversationSelection(conversations: ConversationItem[]) {
  const [selectionState, setSelectionState] = useState<SelectionState>({
    type: 'individual',
    selectedIds: new Set(),
  });

  const handleConversationCheck = useCallback(
    (conversationId: string, checked: boolean) => {
      if (selectionState.type === 'all') {
        const newSelectedIds = new Set(conversations.map((c) => c.id));
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
    [selectionState, conversations],
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
    (conversationId: string) => {
      if (selectionState.type === 'all') {
        return true;
      }
      return selectionState.selectedIds.has(conversationId);
    },
    [selectionState],
  );

  const {
    isSelectAllChecked,
    isSelectAllIndeterminate,
    selectedCount,
    hasIndividualSelectionInView,
  } = useMemo(() => {
    if (selectionState.type === 'all') {
      return {
        isSelectAllChecked: true,
        isSelectAllIndeterminate: false,
        selectedCount: conversations.length,
        hasIndividualSelectionInView: false,
      };
    }

    const { selectedIds } = selectionState;
    const conversationCount = conversations.length;
    // Only count selections that are still visible in the current
    // (filtered) list. Narrowing the search must not leave a stale
    // "N selected" count that refers to now-hidden rows, and bulk
    // actions derive their id-list from the same intersection so they
    // never silently mutate out-of-view conversations.
    const selectedInFilteredCount = conversations.filter((c) =>
      selectedIds.has(c.id),
    ).length;

    return {
      isSelectAllChecked:
        conversationCount > 0 && selectedInFilteredCount === conversationCount,
      isSelectAllIndeterminate:
        selectedInFilteredCount > 0 &&
        selectedInFilteredCount < conversationCount,
      selectedCount: selectedInFilteredCount,
      hasIndividualSelectionInView: selectedInFilteredCount > 0,
    };
  }, [selectionState, conversations]);

  const hasSelectedItems =
    conversations.length > 0 &&
    (selectionState.type === 'all' || hasIndividualSelectionInView);

  const selectAllChecked = isSelectAllIndeterminate
    ? ('indeterminate' as const)
    : isSelectAllChecked;

  const clearSelection = useCallback(() => {
    setSelectionState({ type: 'individual', selectedIds: new Set() });
  }, []);

  return {
    selectionState,
    handleConversationCheck,
    handleSelectAll,
    isConversationSelected,
    selectAllChecked,
    selectedCount,
    hasSelectedItems,
    clearSelection,
  };
}
