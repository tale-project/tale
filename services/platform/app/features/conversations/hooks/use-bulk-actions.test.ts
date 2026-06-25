import { describe, expect, it } from 'vitest';

import type { ConversationItem } from '@/convex/conversations/types';

import type { SelectionState } from '../types/selection';
import { getSelectedConversationIds } from './use-bulk-actions';

// `getSelectedConversationIds` reads only `id` / `_id` from each row, and the
// selection `Set` stores `id` while bulk mutations operate on `_id`. Use a stub
// where `id !== _id` so the `filter(c.id) -> map(c._id)` transformation is
// actually exercised (an `id === _id` stub would mask it entirely).
function makeConversation(id: string, _id: string): ConversationItem {
  return { id, _id } as unknown as ConversationItem;
}

const all = [
  makeConversation('a', 'doc-a'),
  makeConversation('b', 'doc-b'),
  makeConversation('c', 'doc-c'),
];

describe('getSelectedConversationIds', () => {
  it('returns the _id of every visible conversation for an "all" selection', () => {
    const state: SelectionState = { type: 'all' };

    expect(getSelectedConversationIds(state, all)).toEqual([
      'doc-a',
      'doc-b',
      'doc-c',
    ]);
  });

  it('maps an "all" selection to only the currently-visible rows', () => {
    const state: SelectionState = { type: 'all' };
    const visible = [makeConversation('a', 'doc-a')];

    // After narrowing, an "all" selection must not reach hidden rows.
    expect(getSelectedConversationIds(state, visible)).toEqual(['doc-a']);
  });

  it('returns only the visible selected conversations’ _id values', () => {
    const state: SelectionState = {
      type: 'individual',
      selectedIds: new Set(['a', 'b']),
    };
    // Narrow the list so only 'a' is still visible: 'b' is selected but hidden.
    const visible = [makeConversation('a', 'doc-a')];

    const result = getSelectedConversationIds(state, visible);

    // Only the visible selection, mapped to its _id (never the raw id, never
    // the hidden 'doc-b').
    expect(result).toEqual(['doc-a']);
  });

  it('does not mutate now-hidden selected rows after the list narrows', () => {
    const state: SelectionState = {
      type: 'individual',
      selectedIds: new Set(['a', 'c']),
    };
    // The list narrows to a single row that is NOT selected.
    const visible = [makeConversation('b', 'doc-b')];

    expect(getSelectedConversationIds(state, visible)).toEqual([]);
  });

  it('maps the full individual selection to _id values when all rows are visible', () => {
    const state: SelectionState = {
      type: 'individual',
      selectedIds: new Set(['a', 'b', 'c']),
    };

    expect(getSelectedConversationIds(state, all)).toEqual([
      'doc-a',
      'doc-b',
      'doc-c',
    ]);
  });
});
