import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { KnowledgeEntryItem } from '../hooks/queries';
import { KnowledgeEntryRowActions } from './knowledge-entry-row-actions';

let mockCanWrite = true;

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => mockCanWrite,
    cannot: () => !mockCanWrite,
  }),
}));

// The dialogs are covered by their own tests; here only the wiring matters.
vi.mock('./knowledge-entry-view-dialog', () => ({
  KnowledgeEntryViewDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="Entry details" /> : null,
}));
vi.mock('./knowledge-entry-edit-dialog', () => ({
  KnowledgeEntryEditDialog: () => null,
}));
vi.mock('./knowledge-entry-delete-dialog', () => ({
  KnowledgeEntryDeleteDialog: () => null,
}));

const entry = {
  _id: 'entry-1' as never,
  _creationTime: Date.now(),
  organizationId: 'org-1',
  topic: 'Store opening hours',
  topicKey: 'store opening hours',
  content: 'Monday to Friday, 9 am to 5 pm.',
  status: 'active',
  source: 'manual',
  createdBy: 'user-1',
  createdAt: Date.now(),
  ragStatus: 'not_indexed',
} satisfies KnowledgeEntryItem;

async function openMenu() {
  const { user } = render(<KnowledgeEntryRowActions entry={entry} />);
  await user.click(screen.getByRole('button', { name: 'Open menu' }));
  const items = await screen.findAllByRole('menuitem');
  return { user, labels: items.map((item) => item.textContent) };
}

beforeEach(() => {
  mockCanWrite = true;
});

describe('KnowledgeEntryRowActions', () => {
  it('offers View, Edit, then Delete', async () => {
    const { labels } = await openMenu();

    expect(labels).toEqual(['View', 'Edit', 'Delete']);
  });

  it('still offers View to a member who cannot edit', async () => {
    mockCanWrite = false;

    const { labels } = await openMenu();

    expect(labels).toEqual(['View']);
  });

  it('opens the entry details from View', async () => {
    const { user } = await openMenu();

    await user.click(screen.getByRole('menuitem', { name: 'View' }));

    expect(
      screen.getByRole('dialog', { name: 'Entry details' }),
    ).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<KnowledgeEntryRowActions entry={entry} />);
      await checkAccessibility(container);
    });
  });
});
