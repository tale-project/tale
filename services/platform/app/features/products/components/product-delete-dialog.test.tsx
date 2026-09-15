import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ProductDeleteDialog } from './product-delete-dialog';

const mockDelete = vi.fn().mockResolvedValue(undefined);

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteProduct: () => ({ mutateAsync: mockDelete }),
}));

function makeProduct() {
  return {
    _id: 'product-1',
    _creationTime: Date.now(),
    organizationId: 'org-1',
    name: 'Test Product',
  };
}

describe('ProductDeleteDialog', () => {
  it('names the product, warns, and deletes it on confirm', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <ProductDeleteDialog isOpen onClose={onClose} product={makeProduct()} />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Delete product' });
    expect(within(dialog).getByText('Test Product')).toBeInTheDocument();
    expect(within(dialog).getByText(/permanently removed/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith({ productId: 'product-1' });
    });
    expect(onClose).toHaveBeenCalled();
  });

  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <ProductDeleteDialog
          isOpen
          onClose={vi.fn()}
          product={makeProduct()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
