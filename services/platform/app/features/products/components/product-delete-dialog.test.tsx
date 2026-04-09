import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ProductDeleteDialog } from './product-delete-dialog';

describe('ProductDeleteDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <ProductDeleteDialog
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          productName="Test Product"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when deleting', async () => {
      const { container } = render(
        <ProductDeleteDialog
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          productName="Test Product"
          isDeleting={true}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
