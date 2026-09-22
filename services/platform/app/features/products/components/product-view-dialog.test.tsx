import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { ProductViewDialog } from './product-view-dialog';

const canWrite = { current: true };

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => canWrite.current,
    cannot: () => !canWrite.current,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpdateProduct: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/use-product-image-upload', () => ({
  PRODUCT_IMAGE_MAX_BYTES: 5 * 1024 * 1024,
  PRODUCT_IMAGE_ACCEPT: 'image/png,image/jpeg',
  useProductImageUpload: () => ({
    uploadImage: vi.fn().mockResolvedValue(null),
    isUploading: false,
  }),
}));

const PRODUCT = {
  _id: 'a2d88d57-5efd-472b-845b-7a4552762dca',
  _creationTime: Date.parse('2026-09-14T11:11:00'),
  organizationId: 'org-1',
  name: 'Draft gadget',
  price: 0,
  currency: 'USD',
  stock: 0,
  status: 'draft' as const,
};

describe('ProductViewDialog', () => {
  beforeEach(() => {
    canWrite.current = true;
  });

  it('names the product in the shared record details', () => {
    render(<ProductViewDialog isOpen onClose={vi.fn()} product={PRODUCT} />);

    const dialog = screen.getByRole('dialog', { name: 'Product details' });
    expect(
      within(dialog).getByRole('heading', { name: 'Draft gadget' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Draft')).toBeInTheDocument();
    expect(within(dialog).getByText('Product ID')).toBeInTheDocument();
  });

  it('shows the description once', () => {
    render(
      <ProductViewDialog
        isOpen
        onClose={vi.fn()}
        product={{ ...PRODUCT, description: 'A useful gadget.' }}
      />,
    );
    expect(screen.getAllByText('A useful gadget.')).toHaveLength(1);
  });

  it('offers Edit for a writer without opening the form until they ask', () => {
    render(<ProductViewDialog isOpen onClose={vi.fn()} product={PRODUCT} />);

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Edit product' }),
    ).not.toBeInTheDocument();
  });

  it('hides Edit for a reader', () => {
    canWrite.current = false;
    render(<ProductViewDialog isOpen onClose={vi.fn()} product={PRODUCT} />);

    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
  });

  it('swaps to the edit dialog on Edit and back to the details on cancel', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <ProductViewDialog isOpen onClose={onClose} product={PRODUCT} />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const editDialog = await screen.findByRole('dialog', {
      name: 'Edit product',
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(within(editDialog).getByLabelText('Product name')).toHaveValue(
      'Draft gadget',
    );

    await user.click(
      within(editDialog).getByRole('button', { name: 'Cancel' }),
    );

    expect(
      await screen.findByRole('dialog', { name: 'Product details' }),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not render content when closed', () => {
    render(
      <ProductViewDialog isOpen={false} onClose={vi.fn()} product={PRODUCT} />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ProductViewDialog isOpen onClose={vi.fn()} product={PRODUCT} />,
      );
      await checkAccessibility(container);
    });
  });
});
