import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { EntityDeleteDialog } from './entity-delete-dialog';

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
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
});
