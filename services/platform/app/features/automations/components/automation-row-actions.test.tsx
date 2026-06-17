// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { AutomationRowActions } from './automation-row-actions';

// Shared spy so the delete-flow test can assert the mutation was invoked with
// the row's workflow args (the component-tier stand-in for the E2E's "row
// disappears from the list", which is a backend persistence + reactive-query
// effect that jsdom cannot reproduce).
const deleteMutate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'org-123' }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../hooks/file-mutations', () => ({
  useDuplicateWorkflowFile: () => ({ mutate: vi.fn() }),
  useDeleteWorkflowFile: () => ({ mutate: deleteMutate, isPending: false }),
  useRenameWorkflow: () => ({ mutateAsync: vi.fn() }),
}));

describe('AutomationRowActions', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <AutomationRowActions
          organizationId="org-123"
          automation={{
            _id: 'wf-1',
            name: 'Test Automation',
          }}
        />,
      );
      await checkAccessibility(container);
    });
  });

  // Migrated from the `automation editor` E2E "deletes the throwaway
  // automation": opening the row's action menu, clicking the "Delete" item, and
  // confirming in the dialog is pure menu + dialog UI. The E2E then asserts the
  // row vanishes (a backend delete + reactive list refresh, unreproducible in
  // jsdom); the faithful component-tier equivalent is that confirming invokes
  // the delete mutation with this row's `{ organizationId, workflowSlug }`.
  describe('delete flow', () => {
    it('opens the confirm dialog from the menu and deletes on confirm', async () => {
      const { user } = render(
        <AutomationRowActions
          organizationId="org-123"
          automation={{ _id: 'wf-1', name: 'E2E Editor automation' }}
        />,
      );

      // Open the row action menu (the "..." IconButton).
      await user.click(screen.getByRole('button', { name: 'Open menu' }));

      // The destructive "Delete" entry is a menuitem.
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

      // Confirm dialog opens with the delete-automation title + named warning.
      const dialog = await screen.findByRole('dialog');
      expect(
        screen.getByRole('heading', { name: 'Delete automation' }),
      ).toBeInTheDocument();
      expect(dialog).toHaveTextContent(
        'Are you sure you want to delete "E2E Editor automation"?',
      );

      // The menuitem and the dialog button share the "Delete" label, so scope
      // the confirm to the open dialog (a button, not a menuitem) — exactly as
      // the E2E disambiguates it.
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      // The component-tier equivalent of the E2E's row-removal assertion: the
      // delete mutation fires for this row's workflow.
      expect(deleteMutate).toHaveBeenCalledWith(
        { organizationId: 'org-123', workflowSlug: 'wf-1' },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });
  });
});
