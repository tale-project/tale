import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ConversationItem } from '@/backend/core/conversations/types';

import { useConversationSelection } from './use-conversation-selection';

// The hook only ever reads `id` / `_id` / `length` from the list, so a thin
// stub is enough to exercise the selection-vs-filter intersection logic.
function makeConversation(id: string): ConversationItem {
  return { id, _id: id } as unknown as ConversationItem;
}

const all = [
  makeConversation('a'),
  makeConversation('b'),
  makeConversation('c'),
];

describe('useConversationSelection', () => {
  it('counts only selections that are still visible after the list narrows', () => {
    const { result, rerender } = renderHook(
      ({ conversations }) => useConversationSelection(conversations),
      { initialProps: { conversations: all } },
    );

    act(() => {
      result.current.handleConversationCheck('a', true);
    });
    act(() => {
      result.current.handleConversationCheck('b', true);
    });

    expect(result.current.selectedCount).toBe(2);
    expect(result.current.hasSelectedItems).toBe(true);

    // Narrow the list so only 'a' remains visible: the stale count must drop
    // to the intersection rather than keep reporting the full selection size.
    rerender({ conversations: [makeConversation('a')] });

    expect(result.current.selectedCount).toBe(1);
    expect(result.current.hasSelectedItems).toBe(true);
  });

  it('hides the bulk bar when no selected row is visible in the filtered list', () => {
    const { result, rerender } = renderHook(
      ({ conversations }) => useConversationSelection(conversations),
      { initialProps: { conversations: all } },
    );

    act(() => {
      result.current.handleConversationCheck('a', true);
    });

    // Narrow to a list that excludes the only selection.
    rerender({ conversations: [makeConversation('b'), makeConversation('c')] });

    expect(result.current.selectedCount).toBe(0);
    expect(result.current.hasSelectedItems).toBe(false);

    // Restoring the original list brings the (non-destructive) selection back.
    rerender({ conversations: all });
    expect(result.current.selectedCount).toBe(1);
    expect(result.current.hasSelectedItems).toBe(true);
  });

  it('reports indeterminate state from the visible intersection', () => {
    const { result } = renderHook(() => useConversationSelection(all));

    act(() => {
      result.current.handleConversationCheck('a', true);
    });

    expect(result.current.selectAllChecked).toBe('indeterminate');

    act(() => {
      result.current.handleSelectAll(true);
    });

    expect(result.current.selectAllChecked).toBe(true);
    expect(result.current.selectedCount).toBe(all.length);
  });
});
