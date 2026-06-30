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

const mockSendMessageViaIntegration = vi.fn();
const noopMutation = () => ({ mutateAsync: vi.fn() });

vi.mock('./mutations', () => ({
  useBulkArchiveConversations: () => noopMutation(),
  useBulkCloseConversations: () => noopMutation(),
  useBulkReopenConversations: () => noopMutation(),
  useBulkSpamConversations: () => noopMutation(),
  useBulkUnarchiveConversations: () => noopMutation(),
  useSendMessageViaIntegration: () => ({
    mutateAsync: mockSendMessageViaIntegration,
  }),
}));

import { useBulkActions } from './use-bulk-actions';

const UNKNOWN_CUSTOMER_EMAIL = 'unknown@example.com';

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
    integrationName: 'gmail',
    id,
    title: 'title',
    description: 'description',
    customer_id: 'cust-1',
    business_id: 'biz-1',
    message_count: 1,
    unread_count: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    customer: {
      id: 'cust-1',
      email,
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
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
  mockSendMessageViaIntegration.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useBulkActions handleSendMessages', () => {
  it('dispatches via integration once per selected conversation with resolved fields', async () => {
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

    expect(mockSendMessageViaIntegration).toHaveBeenCalledTimes(2);
    expect(mockSendMessageViaIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        organizationId: 'org-1',
        integrationName: 'gmail',
        content: 'Hello there',
        text: 'Hello there',
        to: ['alice@example.com'],
        subject: 'panel.replySubjectPrefix:{"subject":"Original subject"}',
      }),
    );
    expect(mockSendMessageViaIntegration).toHaveBeenCalledWith(
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

    expect(mockSendMessageViaIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'panel.replySubjectPrefix:{"subject":"panel.defaultSubject"}',
      }),
    );
  });

  it('counts conversations with missing or unknown email as failures and does not dispatch them', async () => {
    const conversations = [
      makeConversation('conv-1', 'alice@example.com'),
      makeConversation('conv-2', UNKNOWN_CUSTOMER_EMAIL),
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
    expect(mockSendMessageViaIntegration).toHaveBeenCalledTimes(1);
    expect(mockSendMessageViaIntegration).toHaveBeenCalledWith(
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
      makeConversation('conv-1', UNKNOWN_CUSTOMER_EMAIL),
      makeConversation('conv-2', ''),
    ];
    const { result, onComplete } = setup(
      conversations,
      individualSelection(['conv-1', 'conv-2']),
    );

    await act(async () => {
      await result.current.handleSendMessages('Hello');
    });

    expect(mockSendMessageViaIntegration).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          'bulk.messagesSentDescription:{"successCount":0,"failedCount":2}',
        variant: 'destructive',
      }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('tallies integration failures into the failed count', async () => {
    mockSendMessageViaIntegration
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('integration down'));
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

    expect(mockSendMessageViaIntegration).not.toHaveBeenCalled();
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

    expect(mockSendMessageViaIntegration).toHaveBeenCalledTimes(2);
  });
});
