/**
 * A produced file's ref is its identity: the same file renders the same on
 * every push, and a revised version — a new file under the same name that
 * takes the earlier one's place — renders anew.
 */

import { describe, expect, it } from 'vitest';

import type { MessagePart } from '@/lib/chat/types';

import type { ChatMessageItem } from '../types';
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
