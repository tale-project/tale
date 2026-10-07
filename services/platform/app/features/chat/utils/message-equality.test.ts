import { describe, expect, it } from 'vitest';

import type { ChatMessageItem, ChatMessageUsage } from '../types';
import { chatItemRenderEqual } from './message-equality';

function row(usage: ChatMessageUsage): ChatMessageItem {
  return {
    id: 'msg-1',
    key: 'msg-1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Hello' }],
    sequence: 2,
    createdAt: 1_700_000_000_000,
    text: 'Hello',
    isStreaming: false,
    isFinalReveal: false,
    usage,
  };
}

const EU_ENDPOINT = { host: 'eu.openrouter.ai', region: 'europe' } as const;

describe('chatItemRenderEqual', () => {
  it('keeps a row whose usage blob was rebuilt with the same values', () => {
    const usage: ChatMessageUsage = {
      durationMs: 900,
      setupMs: 40,
      serving: { providers: ['Anthropic'], endpoint: EU_ENDPOINT },
    };
    expect(
      chatItemRenderEqual(
        row(usage),
        row({ ...usage, serving: { ...usage.serving, endpoint: EU_ENDPOINT } }),
      ),
    ).toBe(true);
  });

  it('re-renders when only the regional endpoint changed', () => {
    const before = row({ serving: { providers: ['Anthropic'] } });
    const withEndpoint = row({
      serving: { providers: ['Anthropic'], endpoint: EU_ENDPOINT },
    });
    expect(chatItemRenderEqual(before, withEndpoint)).toBe(false);
    expect(
      chatItemRenderEqual(
        withEndpoint,
        row({
          serving: {
            providers: ['Anthropic'],
            endpoint: { host: 'us.openrouter.ai', region: 'united-states' },
          },
        }),
      ),
    ).toBe(false);
  });

  it('re-renders when an anchor of the phase bar changed', () => {
    const usage: ChatMessageUsage = {
      durationMs: 900,
      timeToFirstTokenMs: 500,
    };
    expect(
      chatItemRenderEqual(row(usage), row({ ...usage, setupMs: 40 })),
    ).toBe(false);
    expect(
      chatItemRenderEqual(
        row(usage),
        row({ ...usage, timeToFirstReasoningMs: 200 }),
      ),
    ).toBe(false);
  });
});
