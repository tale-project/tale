import { describe, expect, it } from 'vitest';

import {
  type AssistantContent,
  truncateAssistantContent,
} from './truncate_message_content';

describe('truncateAssistantContent — string content', () => {
  it('truncates to the requested length', () => {
    expect(truncateAssistantContent('Hello world', 5)).toBe('Hello');
  });

  it('returns the full string when length exceeds content', () => {
    expect(truncateAssistantContent('Hi', 50)).toBe('Hi');
  });

  it('returns empty string when length is 0', () => {
    expect(truncateAssistantContent('Hello', 0)).toBe('');
  });

  it('preserves multi-byte characters (slices by UTF-16 unit, like the snapshot)', () => {
    // Snapshot length on the client is also UTF-16; ensures parity.
    const text = 'Hi 🌍';
    expect(truncateAssistantContent(text, 3)).toBe('Hi ');
  });

  it('throws on negative length', () => {
    expect(() => truncateAssistantContent('Hello', -1)).toThrow(/>= 0/);
  });
});

describe('truncateAssistantContent — array content', () => {
  it('truncates a single text part', () => {
    const content: AssistantContent = [{ type: 'text', text: 'Hello world' }];
    const result = truncateAssistantContent(content, 5);
    expect(result).toEqual([{ type: 'text', text: 'Hello' }]);
  });

  it('preserves a file part placed before a text part', () => {
    const content: AssistantContent = [
      {
        type: 'file',
        data: 'data:image/png;base64,xxx',
        mediaType: 'image/png',
      },
      { type: 'text', text: 'Here is the image you asked for' },
    ];
    const result = truncateAssistantContent(content, 7);
    expect(result).toEqual([
      {
        type: 'file',
        data: 'data:image/png;base64,xxx',
        mediaType: 'image/png',
      },
      { type: 'text', text: 'Here is' },
    ]);
  });

  it('preserves a tool-call placed after the truncation point', () => {
    const content: AssistantContent = [
      { type: 'text', text: 'Let me check.' },
      {
        type: 'tool-call',
        toolCallId: 't1',
        toolName: 'search',
        input: { query: 'x' },
      },
    ];
    // displayedLength sits inside the text part; tool-call still kept.
    const result = truncateAssistantContent(content, 7);
    expect(result).toEqual([
      { type: 'text', text: 'Let me ' },
      {
        type: 'tool-call',
        toolCallId: 't1',
        toolName: 'search',
        input: { query: 'x' },
      },
    ]);
  });

  it('drops subsequent text parts past the cumulative limit but keeps non-text parts', () => {
    const content: AssistantContent = [
      { type: 'text', text: 'Hello' },
      { type: 'reasoning', text: 'thinking...' },
      { type: 'text', text: 'world' },
    ];
    // Limit at 5 — first text part fully fits, second should be dropped,
    // reasoning between them stays.
    const result = truncateAssistantContent(content, 5);
    expect(result).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'reasoning', text: 'thinking...' },
    ]);
  });

  it('preserves all non-text parts when displayedLength is 0', () => {
    const content: AssistantContent = [
      {
        type: 'file',
        data: 'data:image/png;base64,xxx',
        mediaType: 'image/png',
      },
      { type: 'text', text: 'Hello' },
      { type: 'reasoning', text: 'thinking' },
    ];
    const result = truncateAssistantContent(content, 0);
    expect(result).toEqual([
      {
        type: 'file',
        data: 'data:image/png;base64,xxx',
        mediaType: 'image/png',
      },
      { type: 'reasoning', text: 'thinking' },
    ]);
  });

  it('returns the full content when displayedLength exceeds total text', () => {
    const content: AssistantContent = [
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'world' },
    ];
    const result = truncateAssistantContent(content, 1000);
    expect(result).toEqual(content);
  });
});
