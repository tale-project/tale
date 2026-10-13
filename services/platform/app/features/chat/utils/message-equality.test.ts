/**
 * A produced file's ref is its identity: the same file renders the same on
 * every push, and a revised version — a new file under the same name that
 * takes the earlier one's place — renders anew. So does a change to a field
 * of the usage blob the message-info panel draws: where the reply was
 * served, and the anchors of its phase bar.
 */

import { describe, expect, it } from 'vitest';

import type { MessagePart } from '@/lib/chat/types';

import type { ChatMessageItem, ChatMessageUsage } from '../types';
import { chatItemRenderEqual } from './message-equality';

const artifact = (fileId: string): MessagePart => ({
  type: 'artifact',
  fileId,
  name: 'report.docx',
  mediaType:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  sizeBytes: 18_204,
  callId: 'call_1',
});

const row = (parts: MessagePart[]): ChatMessageItem => ({
  id: 'm1',
  key: 'm1',
  role: 'assistant',
  parts,
  sequence: 2,
  createdAt: 1_760_000_000_000,
  text: 'The report is attached.',
  isStreaming: false,
  isFinalReveal: false,
});

describe('chatItemRenderEqual — produced files', () => {
  it('renders a reply the same while its files stay the same', () => {
    expect(
      chatItemRenderEqual(
        row([{ type: 'text', text: 'Done.' }, artifact('s3:acme/v1')]),
        row([{ type: 'text', text: 'Done.' }, artifact('s3:acme/v1')]),
      ),
    ).toBe(true);
  });

  it('renders anew when a revised version replaces a file', () => {
    expect(
      chatItemRenderEqual(
        row([artifact('s3:acme/v1')]),
        row([artifact('s3:acme/v2')]),
      ),
    ).toBe(false);
  });

  it('renders anew when a file is added', () => {
    expect(chatItemRenderEqual(row([]), row([artifact('s3:acme/v1')]))).toBe(
      false,
    );
  });
});

function usageRow(usage: ChatMessageUsage): ChatMessageItem {
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

describe('chatItemRenderEqual — usage', () => {
  it('keeps a row whose usage blob was rebuilt with the same values', () => {
    const usage: ChatMessageUsage = {
      durationMs: 900,
      setupMs: 40,
      serving: { providers: ['Anthropic'], endpoint: EU_ENDPOINT },
    };
    expect(
      chatItemRenderEqual(
        usageRow(usage),
        usageRow({
          ...usage,
          serving: { ...usage.serving, endpoint: EU_ENDPOINT },
        }),
      ),
    ).toBe(true);
  });

  it('re-renders when only the regional endpoint changed', () => {
    const before = usageRow({ serving: { providers: ['Anthropic'] } });
    const withEndpoint = usageRow({
      serving: { providers: ['Anthropic'], endpoint: EU_ENDPOINT },
    });
    expect(chatItemRenderEqual(before, withEndpoint)).toBe(false);
    expect(
      chatItemRenderEqual(
        withEndpoint,
        usageRow({
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
      chatItemRenderEqual(usageRow(usage), usageRow({ ...usage, setupMs: 40 })),
    ).toBe(false);
    expect(
      chatItemRenderEqual(
        usageRow(usage),
        usageRow({ ...usage, timeToFirstReasoningMs: 200 }),
      ),
    ).toBe(false);
  });
});
