import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProductDoc } from '@/app/lib/backend/contract/docs';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { ProductsTable } from './products-table';

type Product = ProductDoc;

let mockProducts: Product[] = [];
const canWrite = { current: true };

function makeProduct(name: string): Product {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal fixture; the table reads name/price/stock/status
  return {
    _id: `product-${name}`,
    _creationTime: Date.now(),
    organizationId: 'test-org-id',
    name,
    price: 0,
    currency: 'USD',
    stock: 0,
    status: 'draft',
    source: 'manual_import',
    locale: 'en',
  } as unknown as Product;
}

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => canWrite.current,
    cannot: () => !canWrite.current,
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('../hooks/mutations', () => ({
  useCreateProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteProduct: () => ({ mutateAsync: vi.fn() }),
  useBulkCreateProducts: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../hooks/queries', () => ({
  useApproxProductCount: () => ({ data: mockProducts.length }),
  useListProductsPaginated: () => ({
    results: mockProducts,
    status: 'Exhausted',
    loadMore: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock('../hooks/use-product-image-upload', () => ({
  PRODUCT_IMAGE_MAX_BYTES: 5 * 1024 * 1024,
  PRODUCT_IMAGE_ACCEPT: 'image/png,image/jpeg',
  useProductImageUpload: () => ({
    uploadImage: vi.fn().mockResolvedValue(null),
    isUploading: false,
  }),
}));

vi.mock('./products-action-menu', () => ({
  ProductsActionMenu: () => <div data-testid="products-action-menu" />,
}));

function productRow(name: string): HTMLElement | undefined {
  return screen.getAllByRole('row').find((row) =>
    within(row)
      .queryAllByRole('cell')
      .some((cell) => cell.textContent?.includes(name)),
  );
}

beforeEach(() => {
  mockProducts = [];
  canWrite.current = true;
});

describe('ProductsTable', () => {
  describe('accessibility', () => {
    it('passes axe audit in empty state', async () => {
      const { container } = render(
        <ProductsTable organizationId="test-org-id" />,
      );
      await checkAccessibility(container, {
        rules: { 'aria-allowed-attr': { enabled: false } },
      });
    });
  });

  describe('row click', () => {
    it('opens the product details dialog on row click', async () => {
      mockProducts = [makeProduct('Draft gadget')];
      const { user } = render(<ProductsTable organizationId="test-org-id" />);

      const row = productRow('Draft gadget');
      expect(row).toBeInstanceOf(HTMLElement);
      if (!(row instanceof HTMLElement)) return;
      await user.click(within(row).getByText('Draft gadget'));

      const dialog = screen.getByRole('dialog', { name: 'Product details' });
      expect(
        within(dialog).getByRole('heading', { name: 'Draft gadget' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('dialog', { name: 'Edit product' }),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).getByRole('button', { name: 'Edit' }),
      ).toBeInTheDocument();
    });

    it('hides Edit on the view dialog for a reader', async () => {
      canWrite.current = false;
      mockProducts = [makeProduct('Draft gadget')];
      const { user } = render(<ProductsTable organizationId="test-org-id" />);

      const row = productRow('Draft gadget');
      expect(row).toBeInstanceOf(HTMLElement);
      if (!(row instanceof HTMLElement)) return;
      await user.click(within(row).getByText('Draft gadget'));

      const dialog = screen.getByRole('dialog', { name: 'Product details' });
      expect(dialog).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: 'Edit' })).toBeNull();
      expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('opens the edit dialog from the view header for a writer', async () => {
      mockProducts = [makeProduct('Draft gadget')];
      const { user } = render(<ProductsTable organizationId="test-org-id" />);

      const row = productRow('Draft gadget');
      expect(row).toBeInstanceOf(HTMLElement);
      if (!(row instanceof HTMLElement)) return;
      await user.click(within(row).getByText('Draft gadget'));
      await user.click(screen.getByRole('button', { name: 'Edit' }));

      const dialog = await screen.findByRole('dialog', {
        name: 'Edit product',
      });
      expect(within(dialog).getByLabelText(/Product name/)).toHaveValue(
        'Draft gadget',
      );
    });
  });
});
