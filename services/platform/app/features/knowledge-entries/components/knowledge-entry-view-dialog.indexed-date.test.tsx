import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { KnowledgeEntryItem } from '../hooks/queries';
import { KnowledgeEntryViewDialog } from './knowledge-entry-view-dialog';

// Unlike its sibling suite, this one keeps the real RAG status badge: the
// stamp a knowledge-entry listing carries has to reach its Indexed dialog.
vi.mock('../hooks/queries', () => ({
  useKnowledgeEntryVersions: () => ({ data: null }),
}));

// #3603: the badge read the backend's epoch-millisecond stamp as seconds,
// and the Indexed dialog dated the indexing in the year 58711.
describe('KnowledgeEntryViewDialog — indexing status', () => {
  // 10:00Z is 28 September from UTC−10 to UTC+13, whatever zone runs this.
  const indexedAt = Date.parse('2026-09-28T10:00:00.000Z');

  it.each([
    { ragIndexedAt: indexedAt, shows: 'September 28, 2026' },
    { ragIndexedAt: undefined, shows: 'Unknown' },
  ])('shows $shows in the Indexed dialog', async ({ ragIndexedAt, shows }) => {
    const entry: KnowledgeEntryItem = {
      _id: 'entry-2' as never,
      _creationTime: Date.parse('2026-09-21T08:00:00.000Z'),
      organizationId: 'org-1',
      topic: 'Shipping times',
      topicKey: 'shipping times',
      content: 'Orders over CHF 100 ship free.',
      status: 'active',
      source: 'manual',
      createdBy: 'user-1',
      createdAt: Date.parse('2026-09-21T08:00:00.000Z'),
      documentId: 'doc-1',
      ragStatus: 'completed',
      ragIndexedAt,
    };
    const { user } = render(
      // The RAG status badge holds its retry action, a react-query mutation.
      <QueryClientProvider client={new QueryClient()}>
        <KnowledgeEntryViewDialog isOpen onClose={vi.fn()} entry={entry} />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Document indexed' }));
    const dialog = screen.getByRole('dialog', { name: 'Document indexed' });
    expect(dialog).toHaveTextContent(`Indexed on: ${shows}`);
    expect(dialog).not.toHaveTextContent('58711');
  });
});
