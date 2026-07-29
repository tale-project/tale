// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import type { ConversationItem } from '@/convex/conversations/types';

import type { SelectionState } from '../types/selection';

const mockToast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

const mockSendMessageViaConnector = vi.fn();
const noopMutation = () => ({ mutateAsync: vi.fn() });

vi.mock('./mutations', () => ({
  useBulkArchiveConversations: () => noopMutation(),
  useBulkCloseConversations: () => noopMutation(),
  useBulkReopenConversations: () => noopMutation(),
  useBulkSpamConversations: () => noopMutation(),
  useBulkUnarchiveConversations: () => noopMutation(),
  useSendMessageViaConnector: () => ({
    mutateAsync: mockSendMessageViaConnector,
  }),
}));

import { getSelectedConversationIds, useBulkActions } from './use-bulk-actions';

const UNKNOWN_CONTACT_EMAIL = 'unknown@example.com';

// `getSelectedConversationIds` reads only `id` / `_id` from each row, and the
// selection `Set` stores `id` while bulk mutations operate on `_id`. Use a stub
// where `id !== _id` so the `filter(c.id) -> map(c._id)` transformation is
// actually exercised (an `id === _id` stub would mask it entirely).
function makeIdStub(id: string, _id: string): ConversationItem {
  return { id, _id } as unknown as ConversationItem;
}

const all = [
  makeIdStub('a', 'doc-a'),
  makeIdStub('b', 'doc-b'),
  makeIdStub('c', 'doc-c'),
];

function makeConversation(
  id: string,
  email: string,
  overrides: Partial<ConversationItem> = {},
): ConversationItem {
  return {
    _id: id,
    _creationTime: 0,
    organizationId: 'org-1',
    subject: 'Original subject',
    connectorName: 'gmail',
    id,
    title: 'title',
    description: 'description',
    contact_id: 'cont-1',
    business_id: 'biz-1',
    message_count: 1,
    unread_count: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    contact: {
      id: 'cont-1',
      email,
    },
    messages: [],
    ...overrides,
  } as unknown as ConversationItem;
}

function individualSelection(ids: string[]): SelectionState {
  return { type: 'individual', selectedIds: new Set(ids) };
}

function setup(
  conversations: ConversationItem[],
  selectionState: SelectionState,
) {
  const onComplete = vi.fn();
  const { result } = renderHook(() =>
    useBulkActions({
      organizationId: 'org-1',
      conversations,
      selectionState,
      onComplete,
    }),
  );
  return { result, onComplete };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendMessageViaConnector.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

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
    const visible = [makeIdStub('a', 'doc-a')];

    // After narrowing, an "all" selection must not reach hidden rows.
    expect(getSelectedConversationIds(state, visible)).toEqual(['doc-a']);
  });

  it('returns only the visible selected conversations’ _id values', () => {
    const state: SelectionState = {
      type: 'individual',
      selectedIds: new Set(['a', 'b']),
    };
    // Narrow the list so only 'a' is still visible: 'b' is selected but hidden.
    const visible = [makeIdStub('a', 'doc-a')];

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
    const visible = [makeIdStub('b', 'doc-b')];

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

describe('useBulkActions handleSendMessages', () => {
  it('dispatches via connector once per selected conversation with resolved fields', async () => {
    const conversations = [
      makeConversation('conv-1', 'alice@example.com'),
      makeConversation('conv-2', 'bob@example.com'),
    ];
    const { result, onComplete } = setup(
      conversations,
      individualSelection(['conv-1', 'conv-2']),
    );

    await act(async () => {
      await result.current.handleSendMessages('  Hello there  ');
    });

    expect(mockSendMessageViaConnector).toHaveBeenCalledTimes(2);
    expect(mockSendMessageViaConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        organizationId: 'org-1',
        connectorName: 'gmail',
        content: 'Hello there',
        text: 'Hello there',
        to: ['alice@example.com'],
        subject: 'panel.replySubjectPrefix:{"subject":"Original subject"}',
      }),
    );
    expect(mockSendMessageViaConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-2',
        to: ['bob@example.com'],
      }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('falls back to a default subject when the conversation has none', async () => {
    const conversations = [
      makeConversation('conv-1', 'alice@example.com', { subject: undefined }),
    ];
    const { result } = setup(conversations, individualSelection(['conv-1']));

    await act(async () => {
      await result.current.handleSendMessages('Hi');
    });

    expect(mockSendMessageViaConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'panel.replySubjectPrefix:{"subject":"panel.defaultSubject"}',
      }),
    );
  });

  it('counts conversations with missing or unknown email as failures and does not dispatch them', async () => {
    const conversations = [
      makeConversation('conv-1', 'alice@example.com'),
      makeConversation('conv-2', UNKNOWN_CONTACT_EMAIL),
      makeConversation('conv-3', ''),
    ];
    const { result, onComplete } = setup(
      conversations,
      individualSelection(['conv-1', 'conv-2', 'conv-3']),
    );

    await act(async () => {
      await result.current.handleSendMessages('Hello');
    });

    // Only the conversation with a usable email is dispatched.
    expect(mockSendMessageViaConnector).toHaveBeenCalledTimes(1);
    expect(mockSendMessageViaConnector).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1' }),
    );

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'bulk.messagesSent',
        description:
          'bulk.messagesSentDescription:{"successCount":1,"failedCount":2}',
        variant: 'default',
      }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('uses the destructive toast variant when every send fails', async () => {
    const conversations = [
      makeConversation('conv-1', UNKNOWN_CONTACT_EMAIL),
      makeConversation('conv-2', ''),
    ];
    const { result, onComplete } = setup(
      conversations,
      individualSelection(['conv-1', 'conv-2']),
    );

    await act(async () => {
      await result.current.handleSendMessages('Hello');
    });

    expect(mockSendMessageViaConnector).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          'bulk.messagesSentDescription:{"successCount":0,"failedCount":2}',
        variant: 'destructive',
      }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('tallies connector failures into the failed count', async () => {
    mockSendMessageViaConnector
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('connector down'));
    const conversations = [
      makeConversation('conv-1', 'alice@example.com'),
      makeConversation('conv-2', 'bob@example.com'),
    ];
    const { result } = setup(
      conversations,
      individualSelection(['conv-1', 'conv-2']),
    );

    await act(async () => {
      await result.current.handleSendMessages('Hello');
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          'bulk.messagesSentDescription:{"successCount":1,"failedCount":1}',
        variant: 'default',
      }),
    );
  });

  it('does nothing when the message body is empty after trimming', async () => {
    const conversations = [makeConversation('conv-1', 'alice@example.com')];
    const { result, onComplete } = setup(
      conversations,
      individualSelection(['conv-1']),
    );

    await act(async () => {
      await result.current.handleSendMessages('   ');
    });

    expect(mockSendMessageViaConnector).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('dispatches to every loaded conversation for an "all" selection', async () => {
    const conversations = [
      makeConversation('conv-1', 'alice@example.com'),
      makeConversation('conv-2', 'bob@example.com'),
    ];
    const { result } = setup(conversations, { type: 'all' });

    await act(async () => {
      await result.current.handleSendMessages('Hello');
    });

    expect(mockSendMessageViaConnector).toHaveBeenCalledTimes(2);
  });
});
