import { describe, expect, it } from 'vitest';

import type { AgentListMessagesResult } from './message_deduplication';

import { computeDeduplicationState } from './message_deduplication';

function createMessages(
  messages: Array<{ role: string; content: string | null }>,
): AgentListMessagesResult {
  return {
    page: messages.map((msg, i) => ({
      _id: `msg_${i}`,
      message: { role: msg.role, content: msg.content },
    })),
    isDone: true,
    continueCursor: '',
  };
}

const emptyResult: AgentListMessagesResult = {
  page: [],
  isDone: true,
  continueCursor: '',
};

describe('computeDeduplicationState', () => {
  it('treats a new message as not duplicate when thread is empty', () => {
    const result = computeDeduplicationState(emptyResult, 'Hello');
    expect(result.messageAlreadyExists).toBe(false);
    expect(result.trimmedMessage).toBe('Hello');
  });

  it('detects duplicate when same user message is latest', () => {
    const messages = createMessages([{ role: 'user', content: 'Hello' }]);
    const result = computeDeduplicationState(messages, 'Hello');
    expect(result.messageAlreadyExists).toBe(true);
    expect(result.lastUserMessage).toBeDefined();
  });

  it('skips deduplication when latest is assistant with content', () => {
    const messages = createMessages([
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'Hello' },
    ]);
    const result = computeDeduplicationState(messages, 'Hello');
    expect(result.messageAlreadyExists).toBe(false);
  });

  it('does not treat empty incoming message as duplicate when no prior user messages exist', () => {
    const result = computeDeduplicationState(emptyResult, '');
    expect(result.messageAlreadyExists).toBe(false);
  });

  it('does not treat empty incoming message as duplicate when prior messages exist but no user messages', () => {
    const messages = createMessages([{ role: 'assistant', content: null }]);
    const result = computeDeduplicationState(messages, '');
    expect(result.messageAlreadyExists).toBe(false);
  });

  it('does not treat whitespace-only incoming message as duplicate', () => {
    const result = computeDeduplicationState(emptyResult, '   ');
    expect(result.messageAlreadyExists).toBe(false);
  });

  it('trims incoming message', () => {
    const result = computeDeduplicationState(emptyResult, '  Hello  ');
    expect(result.trimmedMessage).toBe('Hello');
  });
});
