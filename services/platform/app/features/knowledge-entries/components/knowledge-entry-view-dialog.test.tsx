import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import type { KnowledgeEntryItem } from '../hooks/queries';
import { KnowledgeEntryViewDialog } from './knowledge-entry-view-dialog';

let mockVersions: unknown = null;

vi.mock('../hooks/queries', () => ({
  useKnowledgeEntryVersions: () => ({ data: mockVersions }),
}));

// The badge reads and retries indexing through the backend; its own tests
// cover it.
vi.mock('@/app/features/documents/components/rag-status-badge', () => ({
  RagStatusBadge: ({ status }: { status?: string }) => <span>{status}</span>,
}));

vi.mock('../hooks/mutations', () => ({
  useUpdateKnowledgeEntry: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: vi.fn(),
}));

function makeEntry(
  overrides: Partial<KnowledgeEntryItem> = {},
): KnowledgeEntryItem {
  return {
    _id: 'entry-2' as never,
    _creationTime: Date.now(),
    organizationId: 'org-1',
    topic: 'Shipping times',
    topicKey: 'shipping times',
    content: 'Orders over CHF 100 ship free.',
    status: 'active',
    source: 'manual',
    createdBy: 'user-1',
    createdAt: Date.now(),
    ragStatus: 'not_indexed',
    ...overrides,
  };
}

function version(id: string, status: 'active' | 'superseded') {
  return {
    _id: id,
    topic: 'Shipping times',
    content: `Content of ${id}`,
    status,
    createdAt: 1789450000000,
    supersededAt: status === 'superseded' ? 1789455000000 : undefined,
  };
}

beforeEach(() => {
  mockVersions = null;
});

describe('KnowledgeEntryViewDialog', () => {
  it('names the entry and lists its facts', () => {
    render(
      <KnowledgeEntryViewDialog isOpen onClose={vi.fn()} entry={makeEntry()} />,
    );

    const dialog = screen.getByRole('dialog', {
      name: 'Knowledge entry details',
    });
    expect(
      within(dialog).getByRole('heading', { name: 'Shipping times' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Manual')).toBeInTheDocument();
    expect(within(dialog).getByText('entry-2')).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('region', { name: 'Version history' }),
    ).not.toBeInTheDocument();
  });

  // Regression: the history read the versions from a shape the adapter never
  // answered, so it never appeared; the chain also carries the current row.
  it('lists only the versions the entry replaced', () => {
    mockVersions = {
      entry: version('entry-2', 'active'),
      versions: [
        version('entry-2', 'active'),
        version('entry-1', 'superseded'),
      ],
    };

    render(
      <KnowledgeEntryViewDialog isOpen onClose={vi.fn()} entry={makeEntry()} />,
    );

    const history = screen.getByRole('region', { name: 'Version history' });
    expect(within(history).getByText('1 previous version')).toBeInTheDocument();
    expect(within(history).getAllByText('Superseded')).toHaveLength(1);
  });

  it('offers Edit, which swaps in the edit dialog', async () => {
    const { user } = render(
      <KnowledgeEntryViewDialog isOpen onClose={vi.fn()} entry={makeEntry()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(
      await screen.findByRole('dialog', { name: 'Edit knowledge entry' }),
    ).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit with a version history', async () => {
      mockVersions = {
        entry: version('entry-2', 'active'),
        versions: [
          version('entry-2', 'active'),
          version('entry-1', 'superseded'),
        ],
      };
      const { container } = render(
        <KnowledgeEntryViewDialog
          isOpen
          onClose={vi.fn()}
          entry={makeEntry()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
