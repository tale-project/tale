import { describe, expect, it, vi } from 'vitest';

import { readConversationById } from '../helpers/read_conversation_by_id';
import { readConversationList } from '../helpers/read_conversation_list';
import { readConversationMessages } from '../helpers/read_conversation_messages';

vi.mock('../../../_generated/api', () => ({
  internal: {
    conversations: {
      internal_queries: {
        getConversationById: 'mock-get-conversation-by-id',
        queryConversations: 'mock-query-conversations',
        queryConversationMessages: 'mock-query-conversation-messages',
      },
    },
  },
}));

function createMockCtx(overrides?: Record<string, unknown>) {
  return {
    organizationId: 'org1',
    runQuery: vi.fn(),
    ...overrides,
  };
}

describe('readConversationById', () => {
  it('returns null when conversation is not found', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue(null);

    const result = await readConversationById(ctx as never, {
      conversationId: 'conv1',
    });

    expect(result).toEqual({
      operation: 'get_by_id',
      conversation: null,
    });
  });

  it('returns null when conversation belongs to different org', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue({
      _id: 'conv1',
      organizationId: 'other-org',
      subject: 'Test',
      status: 'open',
    });

    const result = await readConversationById(ctx as never, {
      conversationId: 'conv1',
    });

    expect(result).toEqual({
      operation: 'get_by_id',
      conversation: null,
    });
  });

  it('returns selected fields when conversation exists', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue({
      _id: 'conv1',
      organizationId: 'org1',
      subject: 'Help needed',
      status: 'open',
      priority: 'high',
      channel: 'email',
      customerId: 'cust1',
      lastMessageAt: 1700000000000,
    });

    const result = await readConversationById(ctx as never, {
      conversationId: 'conv1',
      fields: ['_id', 'subject', 'status'],
    });

    expect(result.operation).toBe('get_by_id');
    expect(result.conversation).toEqual({
      _id: 'conv1',
      subject: 'Help needed',
      status: 'open',
    });
  });

  it('always includes _id even if not in fields', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue({
      _id: 'conv1',
      organizationId: 'org1',
      subject: 'Test',
      status: 'open',
    });

    const result = await readConversationById(ctx as never, {
      conversationId: 'conv1',
      fields: ['subject'],
    });

    expect(result.conversation?._id).toBe('conv1');
  });
});

describe('readConversationList', () => {
  it('throws when organizationId is missing', async () => {
    const ctx = createMockCtx({ organizationId: undefined });

    await expect(readConversationList(ctx as never, {})).rejects.toThrow(
      'organizationId is required',
    );
  });

  it('returns paginated conversations', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue({
      page: [
        { _id: 'conv1', subject: 'Test', status: 'open' },
        { _id: 'conv2', subject: 'Other', status: 'closed' },
      ],
      isDone: false,
      continueCursor: 'cursor-abc',
    });

    const result = await readConversationList(ctx as never, {});

    expect(result).toEqual({
      operation: 'list',
      conversations: [
        { _id: 'conv1', subject: 'Test', status: 'open' },
        { _id: 'conv2', subject: 'Other', status: 'closed' },
      ],
      pagination: {
        hasMore: true,
        totalFetched: 2,
        cursor: 'cursor-abc',
      },
    });
  });

  it('passes status filter to query', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue({
      page: [],
      isDone: true,
      continueCursor: '',
    });

    await readConversationList(ctx as never, { status: 'open' });

    expect(ctx.runQuery).toHaveBeenCalledWith(
      'mock-query-conversations',
      expect.objectContaining({ status: 'open' }),
    );
  });

  it('passes customerId filter to query', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue({
      page: [],
      isDone: true,
      continueCursor: '',
    });

    await readConversationList(ctx as never, { customerId: 'cust1' });

    expect(ctx.runQuery).toHaveBeenCalledWith(
      'mock-query-conversations',
      expect.objectContaining({ customerId: 'cust1' }),
    );
  });

  it('uses default numItems of 50', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue({
      page: [],
      isDone: true,
      continueCursor: '',
    });

    await readConversationList(ctx as never, {});

    expect(ctx.runQuery).toHaveBeenCalledWith(
      'mock-query-conversations',
      expect.objectContaining({
        paginationOpts: { numItems: 50, cursor: null },
      }),
    );
  });
});

describe('readConversationMessages', () => {
  it('throws when organizationId is missing', async () => {
    const ctx = createMockCtx({ organizationId: undefined });

    await expect(
      readConversationMessages(ctx as never, { conversationId: 'conv1' }),
    ).rejects.toThrow('organizationId is required');
  });

  it('returns paginated messages', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue({
      page: [
        {
          _id: 'msg1',
          conversationId: 'conv1',
          content: 'Hello',
          direction: 'inbound',
        },
        {
          _id: 'msg2',
          conversationId: 'conv1',
          content: 'Hi there',
          direction: 'outbound',
        },
      ],
      isDone: true,
      continueCursor: '',
    });

    const result = await readConversationMessages(ctx as never, {
      conversationId: 'conv1',
    });

    expect(result).toEqual({
      operation: 'get_messages',
      messages: [
        {
          _id: 'msg1',
          conversationId: 'conv1',
          content: 'Hello',
          direction: 'inbound',
        },
        {
          _id: 'msg2',
          conversationId: 'conv1',
          content: 'Hi there',
          direction: 'outbound',
        },
      ],
      pagination: {
        hasMore: false,
        totalFetched: 2,
        cursor: null,
      },
    });
  });

  it('uses default numItems of 100', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue({
      page: [],
      isDone: true,
      continueCursor: '',
    });

    await readConversationMessages(ctx as never, {
      conversationId: 'conv1',
    });

    expect(ctx.runQuery).toHaveBeenCalledWith(
      'mock-query-conversation-messages',
      expect.objectContaining({
        paginationOpts: { numItems: 100, cursor: null },
      }),
    );
  });

  it('passes cursor for pagination', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue({
      page: [],
      isDone: true,
      continueCursor: '',
    });

    await readConversationMessages(ctx as never, {
      conversationId: 'conv1',
      cursor: 'cursor-xyz',
      numItems: 25,
    });

    expect(ctx.runQuery).toHaveBeenCalledWith(
      'mock-query-conversation-messages',
      expect.objectContaining({
        paginationOpts: { numItems: 25, cursor: 'cursor-xyz' },
      }),
    );
  });
});
