import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

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
          warningTitle="Associated data is deleted"
          warning="All associated data will be lost."
          onDelete={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });

  describe('warning', () => {
    it('renders the warning as an Alert with icon, title, and description', () => {
      render(
        <DeleteDialog
          open={true}
          onOpenChange={vi.fn()}
          title="Delete Resource"
          description="This will permanently delete the resource."
          warningTitle="Associated data is deleted"
          warning="All associated data will be lost."
          onDelete={vi.fn()}
        />,
      );

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Associated data is deleted');
      expect(alert).toHaveTextContent('All associated data will be lost.');
      expect(alert.querySelector('svg')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', {
          level: 5,
          name: 'Associated data is deleted',
        }),
      ).toBeInTheDocument();
    });
  });
});
