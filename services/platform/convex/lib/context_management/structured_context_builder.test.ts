import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListMessages = vi.fn();
vi.mock('@convex-dev/agent', () => ({
  listMessages: (...args: unknown[]) => mockListMessages(...args),
}));

vi.mock('../../_generated/api', () => ({
  components: { agent: {} },
  internal: {
    approvals: {
      internal_queries: {
        getApprovalsForThread: 'mock-getApprovalsForThread',
      },
    },
  },
}));

vi.mock('../../../lib/utils/type-guards', () => ({
  isRecord: (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null,
  getString: (obj: Record<string, unknown>, key: string) => {
    const val = obj[key];
    return typeof val === 'string' ? val : undefined;
  },
}));

import { buildStructuredContext } from './structured_context_builder';

function makeMessage(
  id: string,
  role: 'user' | 'assistant' | 'tool' | 'system',
  content: string | Array<unknown>,
  order: number,
  stepOrder = 0,
) {
  return {
    _id: id,
    _creationTime: Date.now() - (100 - order) * 1000,
    message: { role, content },
    order,
    stepOrder,
    status: 'success' as const,
  };
}

function makeToolResultContent(toolName: string, result: string) {
  return [
    {
      type: 'tool-result',
      toolName,
      toolCallId: `call-${toolName}`,
      result,
    },
  ];
}

function makeMockCtx() {
  return {
    runQuery: vi.fn().mockResolvedValue([]),
    runMutation: vi.fn(),
    runAction: vi.fn(),
  } as never;
}

describe('structured_context_builder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should prioritize conversational messages over tool messages', async () => {
    // Note: formatMessagesWithApprovals skips the LAST user message
    // (it's passed via prompt). So user-5 at order=11 is the last user msg.
    // We add a dummy latest user message at order=20 so all earlier ones are kept.
    const messages = [
      // Newest first (as returned by listMessages)
      makeMessage('user-latest', 'user', 'latest question', 20),
      makeMessage(
        'tool-10',
        'tool',
        makeToolResultContent('search', 'output 10'),
        15,
        1,
      ),
      makeMessage('asst-5', 'assistant', 'response 5', 15, 0),
      makeMessage(
        'tool-9',
        'tool',
        makeToolResultContent('search', 'output 9'),
        14,
        1,
      ),
      makeMessage('user-5', 'user', 'question 5', 11),
      makeMessage('asst-4', 'assistant', 'response 4', 10, 0),
      makeMessage('user-4', 'user', 'question 4', 6),
      makeMessage('asst-3', 'assistant', 'response 3', 5, 0),
      makeMessage('user-3', 'user', 'question 3', 3),
      makeMessage('asst-2', 'assistant', 'response 2', 2),
      makeMessage('user-2', 'user', 'question 2', 1),
    ];

    mockListMessages.mockResolvedValue({
      page: messages,
      isDone: true,
      continueCursor: null,
    });

    const result = await buildStructuredContext({
      ctx: makeMockCtx(),
      threadId: 'thread-1',
      maxHistoryTokens: 25_000,
    });

    // All earlier conversational messages should be present (latest user msg is skipped)
    expect(result.threadContext).toContain('question 2');
    expect(result.threadContext).toContain('response 2');
    expect(result.threadContext).toContain('question 3');
    expect(result.threadContext).toContain('response 3');
    expect(result.threadContext).toContain('question 4');
    expect(result.threadContext).toContain('response 4');
    expect(result.threadContext).toContain('question 5');
    expect(result.threadContext).toContain('response 5');
  });

  it('should maintain chronological order in output', async () => {
    const messages = [
      // Newest first — add a latest user msg so earlier ones aren't skipped
      makeMessage('user-latest', 'user', 'latest question', 10),
      makeMessage('asst-2', 'assistant', 'second reply', 4),
      makeMessage('asst-1', 'assistant', 'first reply', 2),
      makeMessage('user-1', 'user', 'first question', 1),
    ];

    mockListMessages.mockResolvedValue({
      page: messages,
      isDone: true,
      continueCursor: null,
    });

    const result = await buildStructuredContext({
      ctx: makeMockCtx(),
      threadId: 'thread-1',
      maxHistoryTokens: 25_000,
    });

    const text = result.threadContext;
    const firstQIdx = text.indexOf('first question');
    const firstRIdx = text.indexOf('first reply');
    const secondRIdx = text.indexOf('second reply');

    expect(firstQIdx).toBeGreaterThan(-1);
    expect(firstRIdx).toBeGreaterThan(-1);
    expect(secondRIdx).toBeGreaterThan(-1);
    expect(firstQIdx).toBeLessThan(firstRIdx);
    expect(firstRIdx).toBeLessThan(secondRIdx);
  });

  it('should exclude tool messages when budget is tight', async () => {
    const longContent = 'x'.repeat(5000);
    const messages = [
      makeMessage(
        'tool-1',
        'tool',
        makeToolResultContent('search', 'tool result'),
        3,
        1,
      ),
      makeMessage('asst-1', 'assistant', longContent, 2),
      makeMessage('user-1', 'user', longContent, 1),
    ];

    mockListMessages.mockResolvedValue({
      page: messages,
      isDone: true,
      continueCursor: null,
    });

    // Very tight budget — just enough for the two conversational messages
    const result = await buildStructuredContext({
      ctx: makeMockCtx(),
      threadId: 'thread-1',
      maxHistoryTokens: 3000,
    });

    expect(result.threadContext).toContain('x'.repeat(100));
    expect(result.stats.messageCount).toBeGreaterThanOrEqual(2);
  });

  it('should handle empty thread', async () => {
    mockListMessages.mockResolvedValue({
      page: [],
      isDone: true,
      continueCursor: null,
    });

    const result = await buildStructuredContext({
      ctx: makeMockCtx(),
      threadId: 'thread-1',
      maxHistoryTokens: 25_000,
    });

    expect(result.stats.messageCount).toBe(0);
  });

  it('should always include at least one conversational message', async () => {
    const hugeContent = 'y'.repeat(200000);
    const messages = [makeMessage('user-1', 'user', hugeContent, 1)];

    mockListMessages.mockResolvedValue({
      page: messages,
      isDone: true,
      continueCursor: null,
    });

    const result = await buildStructuredContext({
      ctx: makeMockCtx(),
      threadId: 'thread-1',
      maxHistoryTokens: 100,
    });

    expect(result.stats.messageCount).toBe(1);
  });

  it('should apply age-tiered truncation to tool outputs', async () => {
    const longToolOutput = 'z'.repeat(5000);
    // Create 10 tool messages with proper tool-result content
    const messages: ReturnType<typeof makeMessage>[] = [];
    // Add a user message that won't be the "last" (add a latest one)
    messages.push(makeMessage('user-latest', 'user', 'latest', 22));
    for (let i = 10; i >= 1; i--) {
      messages.push(
        makeMessage(
          `tool-${i}`,
          'tool',
          makeToolResultContent(`tool_${i}`, longToolOutput),
          i + 1,
          1,
        ),
      );
    }
    messages.push(makeMessage('user-1', 'user', 'query', 1));

    mockListMessages.mockResolvedValue({
      page: messages,
      isDone: true,
      continueCursor: null,
    });

    const result = await buildStructuredContext({
      ctx: makeMockCtx(),
      threadId: 'thread-1',
      maxHistoryTokens: 50_000,
    });

    const text = result.threadContext;
    // Tool results should be present (HTML-escaped inside <details>)
    // The escapeHtml encodes [ as [ (no change), so [Tool Result] stays as-is
    expect(text).toContain('[Tool Result]');

    // Count tool results
    const toolResultMatches = text.match(/\[Tool Result\]/g);
    expect(toolResultMatches).not.toBeNull();
    expect(toolResultMatches?.length).toBeGreaterThan(0);

    // Old tool messages should have shorter output than recent ones
    // The oldest tool messages (tool_1, tool_2, tool_3) should be truncated to ~300 chars
    // Check that not all outputs are the full 5000 chars
    const fullOutputCount = (text.match(/z{5000}/g) ?? []).length;
    const truncatedCount = (text.match(/z{300}\.\.\./g) ?? []).length;
    // With 10 tool messages: 3 recent (8000), 4 mid (2000), 3 old (300)
    // All are 5000 chars, so recent = full, mid = full, old = truncated at 300
    expect(truncatedCount).toBeGreaterThan(0);
    expect(fullOutputCount).toBeLessThan(10);
  });
});
