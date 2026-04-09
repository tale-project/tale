import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { DeleteDialog } from './delete-dialog';

describe('DeleteDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <DeleteDialog
          open={true}
          onOpenChange={vi.fn()}
          title="Delete Item"
          description="Are you sure you want to delete this item?"
          onDelete={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with preview', async () => {
      const { container } = render(
        <DeleteDialog
          open={true}
          onOpenChange={vi.fn()}
          title="Delete Customer"
          description="This action cannot be undone."
          preview={{ primary: 'John Doe', secondary: 'john@example.com' }}
          onDelete={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with warning', async () => {
      const { container } = render(
        <DeleteDialog
          open={true}
          onOpenChange={vi.fn()}
          title="Delete Resource"
          description="This will permanently delete the resource."
          warning="All associated data will be lost."
          onDelete={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
