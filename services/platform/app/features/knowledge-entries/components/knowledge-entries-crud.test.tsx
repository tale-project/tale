import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import type { KnowledgeEntryItem } from '../hooks/queries';
import { AddKnowledgeEntryDialog } from './knowledge-entry-add-dialog';
import { KnowledgeEntryRowActions } from './knowledge-entry-row-actions';

// Migrated from the `knowledge` E2E "creates, edits and deletes a
// knowledge-entries entity". The E2E walked the manual-entry CRUD loop: open the
// add dialog → fill topic + content → save → row appears → row 3-dot menu → Edit
// → the topic field is prefilled with the original value → rename → save → the
// renamed row appears → row menu → Delete → the confirm dialog opens → confirm →
// the row disappears. Every assertion there is about RENDERED dialog UI and the
// client-side form/mutation wiring — the dialogs are pure react-hook-form +
// zodResolver forms whose only backend touch is the create/update/delete Convex
// mutation, and the "row appears/disappears" is just the list re-rendering off
// that mutation's result. None of it needs a real backend, so it belongs at the
// component tier. We mock the three mutation hooks and assert the SAME seams the
// E2E did: the add dialog renders topic + content and a save calls the create
// mutation with the typed values; the edit dialog opens from the row menu
// PREFILLED with the entry's topic and a rename calls the update mutation with
// the new value; the delete confirm dialog opens from the row menu and confirming
// calls the delete mutation for that entry.

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('../hooks/mutations', () => ({
  useCreateKnowledgeEntry: () => ({ mutate: mockCreate, isPending: false }),
  useUpdateKnowledgeEntry: () => ({ mutate: mockUpdate, isPending: false }),
  useDeleteKnowledgeEntry: () => ({ mutateAsync: mockDelete }),
}));

// Edit/delete actions only render for a writer (RBAC is backend-enforced; the
// menu visibility is the pure client gate the E2E exercised as a logged-in
// writer).
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

// The FormDialog shell reads the org id from the router for its error boundary;
// outside a RouterProvider that hook throws, so stub it like the sibling dialog
// tests.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const ORG_ID = 'org-1';

function makeEntry(
  overrides: Partial<KnowledgeEntryItem> = {},
): KnowledgeEntryItem {
  return {
    _id: 'entry-1' as never,
    _creationTime: Date.now(),
    organizationId: ORG_ID,
    topic: 'Store opening hours',
    topicKey: 'store opening hours',
    content: 'Our store is open Monday to Friday from 9 am to 5 pm.',
    status: 'active',
    source: 'manual',
    createdBy: 'user-1',
    createdAt: Date.now(),
    ragStatus: 'not_indexed',
    ...overrides,
  };
}

describe('Knowledge-entries CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('add dialog', () => {
    it('renders the topic and content fields when open', async () => {
      const { container } = render(
        <AddKnowledgeEntryDialog
          isOpen
          onClose={vi.fn()}
          organizationId={ORG_ID}
        />,
      );

      expect(
        screen.getByRole('dialog', { name: 'Add knowledge entry' }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Topic')).toBeInTheDocument();
      expect(screen.getByLabelText('Content')).toBeInTheDocument();

      await checkAccessibility(container);
    });

    it('creates an entry from the typed topic + content on save', async () => {
      const onClose = vi.fn();
      const { user } = render(
        <AddKnowledgeEntryDialog
          isOpen
          onClose={onClose}
          organizationId={ORG_ID}
        />,
      );

      await user.type(screen.getByLabelText('Topic'), 'Return policy');
      await user.type(
        screen.getByLabelText('Content'),
        'Returns accepted within 30 days with a receipt.',
      );
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledTimes(1);
      });
      expect(mockCreate.mock.calls[0][0]).toEqual({
        organizationId: ORG_ID,
        topic: 'Return policy',
        content: 'Returns accepted within 30 days with a receipt.',
      });
    });

    it('blocks the create and surfaces required errors on an empty submit', async () => {
      const { user } = render(
        <AddKnowledgeEntryDialog
          isOpen
          onClose={vi.fn()}
          organizationId={ORG_ID}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('Topic is required')).toBeInTheDocument();
      expect(screen.getByText('Content is required')).toBeInTheDocument();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('edit via the row actions menu', () => {
    it('opens the edit dialog prefilled and updates the entry on rename + save', async () => {
      const entry = makeEntry({ topic: 'Store opening hours' });
      const { user } = render(<KnowledgeEntryRowActions entry={entry} />);

      // Open the row's 3-dot actions menu, then Edit (mirrors the E2E's
      // openRowAction(row, edit)).
      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      await user.click(screen.getByRole('menuitem', { name: 'Edit' }));

      const dialog = await screen.findByRole('dialog', {
        name: 'Edit knowledge entry',
      });
      // The topic field is prefilled with the existing value (the E2E asserted
      // `toHaveValue(name)` before renaming).
      const topicField = screen.getByLabelText('Topic');
      expect(topicField).toHaveValue('Store opening hours');

      await user.clear(topicField);
      await user.type(topicField, 'Store opening hours edited');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledTimes(1);
      });
      expect(mockUpdate.mock.calls[0][0]).toEqual({
        entryId: entry._id,
        topic: 'Store opening hours edited',
        content: entry.content,
      });
      expect(dialog).toBeInTheDocument();
    });
  });

  describe('delete via the row actions menu', () => {
    it('opens the confirm dialog and deletes the entry on confirm', async () => {
      const entry = makeEntry();
      const { user } = render(<KnowledgeEntryRowActions entry={entry} />);

      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

      const dialog = await screen.findByRole('dialog', {
        name: 'Delete knowledge entry',
      });
      expect(dialog).toBeInTheDocument();
      await checkAccessibility(dialog);

      // The confirm button shares the "Delete" label; scope to the dialog.
      const confirm = screen.getByRole('button', { name: 'Delete' });
      await user.click(confirm);

      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalledTimes(1);
      });
      expect(mockDelete).toHaveBeenCalledWith({ entryId: entry._id });
    });
  });
});
