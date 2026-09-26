// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { ChatMessageView } from '../types';

const LONG_REPLY = 'A very long reply that keeps going. '.repeat(80).trim();

const MESSAGES: ChatMessageView[] = [
  {
    id: 'm1',
    role: 'user',
    sequence: 1,
    createdAt: 1_717_000_000_000,
    parts: [{ type: 'text', text: 'Short question?' }],
  },
  {
    id: 'm2',
    role: 'assistant',
    sequence: 2,
    createdAt: 1_717_000_001_000,
    parts: [{ type: 'text', text: LONG_REPLY }],
  },
];

vi.mock('../data/chat-backend', () => ({
  useChatMessages: () => ({ status: 'ready' as const, data: MESSAGES }),
}));

import { ExportChatDialog } from './export-chat-dialog';

describe('ExportChatDialog', () => {
  it('names every row checkbox by role and a bounded snippet', async () => {
    // 2026-09-26 evaluation, A-08: a label wrapping the whole reply left the
    // long rows' checkboxes with no accessible name at all.
    const { baseElement } = render(
      <ExportChatDialog
        open
        onOpenChange={() => {}}
        organizationId="org-1"
        threadId="t1"
      />,
    );

    const question = screen.getByRole('checkbox', {
      name: 'You: Short question?',
    });
    expect(question).toBeChecked();

    const reply = screen.getByRole('checkbox', { name: /^Assistant: / });
    const name = reply.getAttribute('aria-label') ?? '';
    expect(name.length).toBeLessThan(140);
    expect(name.endsWith('…')).toBe(true);
    expect(name).toContain('A very long reply that keeps going.');

    await checkAccessibility(baseElement);
  });
});
