import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { EntityDeleteDialog } from './entity-delete-dialog';

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock('@tale/ui/use-toast', () => ({
  toast: toastMock,
}));

describe('EntityDeleteDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <EntityDeleteDialog
          isOpen={true}
          onClose={vi.fn()}
          entity={{ id: '1', name: 'Test Entity' }}
          getEntityName={(e) => e.name}
          deleteMutation={vi.fn().mockResolvedValue(undefined)}
          translations={{
            title: 'Delete Entity',
            description: 'Are you sure you want to delete {name}?',
            successMessage: 'Entity deleted',
            errorMessage: 'Failed to delete entity',
          }}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with warning text', async () => {
      const { container } = render(
        <EntityDeleteDialog
          isOpen={true}
          onClose={vi.fn()}
          entity={{ id: '1', name: 'Important Item' }}
          getEntityName={(e) => e.name}
          deleteMutation={vi.fn().mockResolvedValue(undefined)}
          translations={{
            title: 'Delete Item',
            description: 'Are you sure you want to delete {name}?',
            warningText: 'This action cannot be undone.',
            successMessage: 'Item deleted',
            errorMessage: 'Failed to delete item',
          }}
        />,
      );
      await checkAccessibility(container);
    });
  });

  describe('when the delete is refused', () => {
    const refusal = new Error('Refused');

    async function deleteRefused(
      describeFailure?: (error: unknown) => string | undefined,
    ) {
      toastMock.mockClear();
      const { user } = render(
        <EntityDeleteDialog
          isOpen={true}
          onClose={vi.fn()}
          entity={{ id: '1', name: 'Test Entity' }}
          getEntityName={(e) => e.name}
          deleteMutation={vi.fn().mockRejectedValue(refusal)}
          translations={{
            title: 'Delete Entity',
            description: 'Are you sure you want to delete {name}?',
            successMessage: 'Entity deleted',
            errorMessage: 'Failed to delete entity',
          }}
          describeFailure={describeFailure}
        />,
      );
      await user.click(screen.getByRole('button', { name: /^delete$/i }));
      await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
      return toastMock.mock.calls[0]?.[0];
    }

    it('shows only its title by default', async () => {
      expect(await deleteRefused()).toEqual({
        title: 'Failed to delete entity',
        description: undefined,
        variant: 'destructive',
      });
    });

    // Its toast is the failure's only report once the delete's own write
    // stays quiet, so it must carry why the delete was refused.
    it("says why, in the caller's words for the refusal", async () => {
      const describeFailure = vi.fn(() => 'Your session has ended.');
      expect(await deleteRefused(describeFailure)).toEqual({
        title: 'Failed to delete entity',
        description: 'Your session has ended.',
        variant: 'destructive',
      });
      expect(describeFailure).toHaveBeenCalledWith(refusal);
    });
  });
});
