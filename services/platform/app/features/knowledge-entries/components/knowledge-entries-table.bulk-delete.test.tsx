import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defineAbilityFor } from '@/lib/permissions/ability';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type { KnowledgeEntryItem } from '../hooks/queries';
import { KnowledgeEntriesTable } from './knowledge-entries-table';

let mockAbility = defineAbilityFor('editor');
const mockDelete = vi.fn();
const entry: KnowledgeEntryItem = {
  _id: 'entry-1',
  _creationTime: 1789450000000,
  organizationId: 'org-1',
  topic: 'Synthetic opening hours',
  topicKey: 'synthetic opening hours',
  content: 'Open Monday to Friday.',
  status: 'active',
  source: 'manual',
  createdBy: 'user-1',
  createdAt: 1789450000000,
  ragStatus: 'not_indexed',
};

vi.mock('@/app/hooks/use-ability', () => ({ useAbility: () => mockAbility }));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('../hooks/mutations', () => ({
  useCreateKnowledgeEntry: () => ({ mutateAsync: vi.fn() }),
  useUpdateKnowledgeEntry: () => ({ mutateAsync: vi.fn() }),
  useDeleteKnowledgeEntry: () => ({ mutateAsync: mockDelete }),
}));
vi.mock('../hooks/queries', () => ({
  useApproxKnowledgeEntryCount: () => ({ data: 1 }),
  useListKnowledgeEntriesPaginated: () => ({
    results: [entry],
    status: 'Exhausted',
    loadMore: vi.fn(),
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
}));
vi.mock('@/app/features/documents/components/rag-status-badge', () => ({
  RagStatusBadge: () => null,
}));

beforeEach(() => {
  mockAbility = defineAbilityFor('editor');
  mockDelete.mockReset().mockResolvedValue(undefined);
});

describe('KnowledgeEntriesTable bulk delete permissions', () => {
  it('gives a member View but no row Delete or bulk selection', async () => {
    mockAbility = defineAbilityFor('member');
    const { user, container } = render(
      <KnowledgeEntriesTable organizationId="org-1" />,
    );
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('menuitem', { name: 'View' })).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Delete' }),
    ).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete selected' }),
    ).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
    await checkAccessibility(container);
  });

  it('keeps row and bulk Delete for an editor', async () => {
    const { user } = render(<KnowledgeEntriesTable organizationId="org-1" />);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(
      screen.getByRole('menuitem', { name: 'Delete' }),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    const checkbox = screen.getByRole('checkbox', { name: 'Select row' });
    checkbox.focus();
    await user.keyboard(' ');
    await user.click(screen.getByRole('button', { name: 'Delete selected' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(mockDelete).toHaveBeenCalledWith({ entryId: 'entry-1' }),
    );
  });

  it('removes a selected bulk workflow when the editor becomes a member', async () => {
    const { user, rerender } = render(
      <KnowledgeEntriesTable organizationId="org-1" />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Select row' }));
    await user.click(screen.getByRole('button', { name: 'Delete selected' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    mockAbility = defineAbilityFor('member');
    rerender(<KnowledgeEntriesTable organizationId="org-1" />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete selected' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
