// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import type { ConversationItem } from '@/backend/core/conversations/types';

import type { SelectionState } from '../types/selection';

const mockToast = vi.fn();
vi.mock('@tale/ui/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

const mockSendMessageViaConnector = vi.fn();
/** Each status verb's `mutateAsync`, and the hooks that hand them out. */
const verbs = vi.hoisted(() => ({
  archive: vi.fn(),
  close: vi.fn(),
  reopen: vi.fn(),
  spam: vi.fn(),
  unarchive: vi.fn(),
}));
const verbHooks = vi.hoisted(() => ({
  useBulkArchiveConversations: vi.fn(() => ({ mutateAsync: verbs.archive })),
  useBulkCloseConversations: vi.fn(() => ({ mutateAsync: verbs.close })),
  useBulkReopenConversations: vi.fn(() => ({ mutateAsync: verbs.reopen })),
  useBulkSpamConversations: vi.fn(() => ({ mutateAsync: verbs.spam })),
  useBulkUnarchiveConversations: vi.fn(() => ({
    mutateAsync: verbs.unarchive,
  })),
}));

vi.mock('./mutations', () => ({
  ...verbHooks,
  useSendMessageViaConnector: () => ({
    mutateAsync: mockSendMessageViaConnector,
  }),
}));

import { BULK_CONVERSATION_LIMIT } from '@/lib/shared/conversations/bulk-limit';

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
        content: 'Hello there',
      }),
    );
    expect(mockSendMessageViaConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-2',
        content: 'Hello there',
      }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // The reply door takes content alone and derives the connector, recipient
  // and subject from the conversation. Anything sent from here was dropped in
  // the adapter, so composing it invited the reader to believe the client
  // chose the route.
  it('sends content only, leaving the envelope to the reply door', async () => {
    const conversations = [
      makeConversation('conv-1', 'alice@example.com', { subject: undefined }),
    ];
    const { result } = setup(conversations, individualSelection(['conv-1']));

    await act(async () => {
      await result.current.handleSendMessages('Hi');
    });

    const sent = mockSendMessageViaConnector.mock.calls[0]?.[0] ?? {};
    expect(Object.keys(sent).sort()).toEqual([
      'content',
      'conversationId',
      'organizationId',
    ]);
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

/**
 * The five status verbs send the selection in batches the bulk door takes:
 * one request of all 201 selected rows was refused whole by a door capped at
 * 200, and nothing closed (#3733). Each batch is its own request, one after
 * the other; the toast states what the whole selection came to, and what a
 * refused batch named stays selected to try again.
 */
describe('useBulkActions status verbs', () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      makeConversation(`conv-${i}`, `c${i}@example.com`),
    );
  const idsOf = (list: ConversationItem[]) => list.map((row) => row._id);
  const answerAll = async ({
    conversationIds,
  }: {
    conversationIds: string[];
  }) => ({
    successCount: conversationIds.length,
    failedCount: 0,
    errors: [],
  });
  const sentBatches = (mock: ReturnType<typeof vi.fn>) =>
    mock.mock.calls.map(
      ([args]) => (args as { conversationIds: string[] }).conversationIds,
    );

  beforeEach(() => {
    for (const verb of Object.values(verbs)) {
      verb.mockReset();
      verb.mockImplementation(answerAll);
    }
  });

  it('sends a full batch as one request', async () => {
    const list = rows(BULK_CONVERSATION_LIMIT);
    const { result, onComplete } = setup(list, { type: 'all' });

    await act(async () => {
      await result.current.handleBulkResolve();
    });

    expect(sentBatches(verbs.close)).toEqual([idsOf(list)]);
    expect(onComplete).toHaveBeenCalledWith([]);
  });

  it('sends one row past the cap as a second request, in selection order', async () => {
    const list = rows(BULK_CONVERSATION_LIMIT + 1);
    const { result, onComplete } = setup(list, { type: 'all' });

    await act(async () => {
      await result.current.handleBulkResolve();
    });

    expect(sentBatches(verbs.close)).toEqual([
      idsOf(list.slice(0, BULK_CONVERSATION_LIMIT)),
      idsOf(list.slice(BULK_CONVERSATION_LIMIT)),
    ]);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'bulk.resolved',
        description: `bulk.resolvedDescription:{"successCount":${BULK_CONVERSATION_LIMIT + 1},"failedCount":0}`,
        variant: 'default',
      }),
    );
    expect(onComplete).toHaveBeenCalledWith([]);
  });

  it('sends only the selected rows the list still shows', async () => {
    const shown = rows(250);
    const selected = [
      ...idsOf(shown.slice(0, 210)),
      'hidden-by-search-1',
      'hidden-by-search-2',
    ];
    const { result } = setup(shown, individualSelection(selected));

    await act(async () => {
      await result.current.handleBulkResolve();
    });

    const sent = sentBatches(verbs.close);
    expect(sent.map((batch) => batch.length)).toEqual([200, 10]);
    expect(sent.flat()).toEqual(idsOf(shown.slice(0, 210)));
  });

  it('stays busy and counts the batches off until the last one settles', async () => {
    let settleLast = (): void => {};
    verbs.close.mockImplementationOnce(answerAll).mockImplementationOnce(
      (args: { conversationIds: string[] }) =>
        new Promise((resolve) => {
          settleLast = () => resolve(answerAll(args));
        }),
    );
    const list = rows(BULK_CONVERSATION_LIMIT + 1);
    const { result } = setup(list, { type: 'all' });

    let running: Promise<void> = Promise.resolve();
    act(() => {
      running = result.current.handleBulkResolve();
    });
    await waitFor(() => expect(verbs.close).toHaveBeenCalledTimes(2));

    expect(result.current.isBulkProcessing).toBe(true);
    expect(result.current.bulkProgress).toEqual({
      settled: BULK_CONVERSATION_LIMIT,
      total: BULK_CONVERSATION_LIMIT + 1,
    });
    // A second press while the batches go out starts nothing.
    await act(async () => {
      await result.current.handleBulkResolve();
    });
    expect(verbs.close).toHaveBeenCalledTimes(2);

    await act(async () => {
      settleLast();
      await running;
    });
    expect(result.current.isBulkProcessing).toBe(false);
    expect(result.current.bulkProgress).toBeNull();
  });

  it('reports a refused batch beside the rest, and keeps its rows selected', async () => {
    verbs.close
      .mockImplementationOnce(answerAll)
      .mockRejectedValueOnce(new Error('Request failed with status 503'));
    const list = rows(BULK_CONVERSATION_LIMIT + 1);
    const { result, onComplete } = setup(list, { type: 'all' });

    await act(async () => {
      await result.current.handleBulkResolve();
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'bulk.resolved',
        description: `bulk.resolvedDescription:{"successCount":${BULK_CONVERSATION_LIMIT},"failedCount":1}`,
        variant: 'default',
      }),
    );
    expect(onComplete).toHaveBeenCalledWith(
      idsOf(list.slice(BULK_CONVERSATION_LIMIT)),
    );
  });

  it('hands the refused rows back by the id the selection keeps', async () => {
    // The requests name rows by `_id`, the selection keeps `id`.
    const list = Array.from({ length: BULK_CONVERSATION_LIMIT + 1 }, (_, i) =>
      makeIdStub(`row-${i}`, `doc-${i}`),
    );
    verbs.close
      .mockImplementationOnce(answerAll)
      .mockRejectedValueOnce(new Error('Request failed'));
    const { result, onComplete } = setup(list, { type: 'all' });

    await act(async () => {
      await result.current.handleBulkResolve();
    });

    expect(sentBatches(verbs.close)[1]).toEqual([
      `doc-${BULK_CONVERSATION_LIMIT}`,
    ]);
    expect(onComplete).toHaveBeenCalledWith([`row-${BULK_CONVERSATION_LIMIT}`]);
  });

  it('says why when nothing changed, and keeps the selection as it was', async () => {
    const refusal = Object.assign(new Error('invalid body'), {
      data: {
        code: 'invalid body',
        message: 'conversationIds: Too big: expected array to have <=200 items',
      },
    });
    verbs.close.mockRejectedValue(refusal);
    const { result, onComplete } = setup(rows(3), { type: 'all' });

    await act(async () => {
      await result.current.handleBulkResolve();
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith({
      title: 'bulk.resolveFailed',
      description:
        'conversationIds: Too big: expected array to have <=200 items',
      variant: 'destructive',
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('asks each verb for no failure toast of its own', () => {
    setup(rows(1), { type: 'all' });
    for (const hook of Object.values(verbHooks)) {
      expect(hook).toHaveBeenCalledWith({ errorToast: false });
    }
  });

  it.each([
    ['handleBulkReopen', 'reopen', 'bulk.reopened'],
    ['handleBulkSpam', 'spam', 'bulk.markedAsSpam'],
    ['handleBulkArchive', 'archive', 'bulk.archived'],
    ['handleBulkUnarchive', 'unarchive', 'bulk.unarchived'],
  ] as const)('%s batches the same way', async (handler, verb, title) => {
    const list = rows(BULK_CONVERSATION_LIMIT + 1);
    const { result, onComplete } = setup(list, { type: 'all' });

    await act(async () => {
      await result.current[handler]();
    });

    expect(sentBatches(verbs[verb]).map((batch) => batch.length)).toEqual([
      BULK_CONVERSATION_LIMIT,
      1,
    ]);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title, variant: 'default' }),
    );
    expect(onComplete).toHaveBeenCalledWith([]);
  });
});
