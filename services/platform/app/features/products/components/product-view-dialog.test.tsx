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

  it('titles the dialog with the product name and skips the filler subtitle', () => {
    render(<ProductViewDialog isOpen onClose={vi.fn()} product={PRODUCT} />);

    const dialog = screen.getByRole('dialog', { name: 'Draft gadget' });
    expect(dialog).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Product details' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('View all information about this product'),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByText('Draft')).toBeInTheDocument();
  });

  it('gives last updated the full row so the timestamp stays on one line', () => {
    render(
      <ProductViewDialog
        isOpen
        onClose={vi.fn()}
        product={{ ...PRODUCT, lastUpdated: Date.parse('2026-09-14T11:11:00') }}
      />,
    );

    const item = screen.getByText('Last updated').closest('.col-span-2');
    expect(item).toBeInTheDocument();
    expect(item?.querySelector('.whitespace-nowrap')).toBeInTheDocument();
  });

  it('does not render a placeholder image or repeat the name in the body', () => {
    render(<ProductViewDialog isOpen onClose={vi.fn()} product={PRODUCT} />);

    const dialog = screen.getByRole('dialog', { name: 'Draft gadget' });
    expect(within(dialog).queryByRole('img')).not.toBeInTheDocument();
    expect(within(dialog).getAllByText('Draft gadget')).toHaveLength(1);
  });

  it('shows the description once, next to the image when both exist', () => {
    render(
      <ProductViewDialog
        isOpen
        onClose={vi.fn()}
        product={{
          ...PRODUCT,
          description: 'A compact travel kettle.',
          imageUrl: 'https://example.com/kettle.jpg',
        }}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Draft gadget' });
    expect(
      within(dialog).getAllByText('A compact travel kettle.'),
    ).toHaveLength(1);
    expect(
      within(dialog).queryByText('Full description'),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole('img', { name: 'Draft gadget' }),
    ).toBeInTheDocument();
  });

  it('exposes a copyable product id', () => {
    render(<ProductViewDialog isOpen onClose={vi.fn()} product={PRODUCT} />);

    const dialog = screen.getByRole('dialog', { name: 'Draft gadget' });
    expect(within(dialog).getByText('Product ID')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', {
        name: /Product ID.*a2d88d57-5efd-472b-845b-7a4552762dca/,
      }),
    ).toBeInTheDocument();
  });

  it('offers Edit for a writer without opening the form until they ask', () => {
    canWrite.current = true;
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

  it('swaps the same dialog into the edit form without a second overlay', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <ProductViewDialog isOpen onClose={onClose} product={PRODUCT} />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(onClose).not.toHaveBeenCalled();
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toHaveAccessibleName('Edit product');
    expect(dialogs[0]).toHaveClass('md:max-w-[24rem]');
    expect(
      screen.queryByRole('dialog', { name: 'Draft gadget' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Product name')).toHaveValue('Draft gadget');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(
      screen.queryByText(/Required fields are marked/),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('(optional)').length).toBeGreaterThan(0);
  });

  it('returns to the view on Cancel without closing the overlay', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <ProductViewDialog isOpen onClose={onClose} product={PRODUCT} />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Draft gadget' })).toHaveClass(
      'md:max-w-[24rem]',
    );
    expect(screen.queryByLabelText('Product name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    render(
      <ProductViewDialog isOpen={false} onClose={vi.fn()} product={PRODUCT} />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      canWrite.current = true;
      const { container } = render(
        <ProductViewDialog isOpen onClose={vi.fn()} product={PRODUCT} />,
      );
      await checkAccessibility(container);
    });
  });
});
