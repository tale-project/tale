import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProductDoc } from '@/app/lib/backend/contract/docs';
import { engagementPaginatedAdapters } from '@/app/lib/backend/engagement';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ProductsTable } from './products-table';

type Product = ProductDoc;

let mockProducts: Product[] = [];
let mockAbility = defineAbilityFor('editor');
const mockDelete = vi.fn();

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
  useAbility: () => mockAbility,
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
  useDeleteProduct: () => ({ mutateAsync: mockDelete }),
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

// `Intl` puts no-break spaces in a grouped amount (`1 234,56 €` in French).
function plainSpaces(text: string | null): string {
  return (text ?? '').replace(/\s/gu, ' ');
}

beforeEach(() => {
  mockProducts = [];
  mockAbility = defineAbilityFor('editor');
  mockDelete.mockReset().mockResolvedValue(undefined);
});

describe('ProductsTable', () => {
  describe('bulk delete permissions', () => {
    it('gives a member View but no row Delete or bulk selection', async () => {
      mockAbility = defineAbilityFor('member');
      mockProducts = [makeProduct('Read-only gadget')];
      const { user, container } = render(
        <ProductsTable organizationId="test-org-id" />,
      );
      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      expect(
        screen.getByRole('menuitem', { name: 'View' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('menuitem', { name: 'Delete' }),
      ).not.toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Delete selected' }),
      ).not.toBeInTheDocument();
      expect(mockDelete).not.toHaveBeenCalled();
      await checkAccessibility(container, {
        rules: {
          'aria-allowed-attr': { enabled: false },
          'image-redundant-alt': { enabled: false },
        },
      });
    });

    it('keeps row and bulk Delete for an editor', async () => {
      mockProducts = [makeProduct('Editable gadget')];
      const { user } = render(<ProductsTable organizationId="test-org-id" />);
      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      expect(
        screen.getByRole('menuitem', { name: 'Delete' }),
      ).toBeInTheDocument();
      await user.keyboard('{Escape}');
      const checkbox = screen.getByRole('checkbox', { name: 'Select row' });
      checkbox.focus();
      await user.keyboard(' ');
      await user.click(screen.getByRole('button', { name: 'Delete selected' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() =>
        expect(mockDelete).toHaveBeenCalledWith({
          productId: 'product-Editable gadget',
        }),
      );
    });

    it('removes a selected bulk workflow when the editor becomes a member', async () => {
      mockProducts = [makeProduct('Selected gadget')];
      const { user, rerender } = render(
        <ProductsTable organizationId="test-org-id" />,
      );
      await user.click(screen.getByRole('checkbox', { name: 'Select row' }));
      await user.click(screen.getByRole('button', { name: 'Delete selected' }));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      mockAbility = defineAbilityFor('member');
      rerender(<ProductsTable organizationId="test-org-id" />);
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Delete selected' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

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
      mockAbility = defineAbilityFor('member');
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

  // The Price cell used to format in the default `en` locale whatever the
  // reader's language, while the details dialog used theirs (#3619).
  describe('price column', () => {
    afterEach(() => {
      localStorage.removeItem('user-locale');
    });

    it.each([
      ['fr-FR', '1 234,56 €'],
      ['de-DE', '1.234,56 €'],
      ['en-US', '€1,234.56'],
    ])(
      'formats the price for %s as the product details do',
      async (locale, expected) => {
        localStorage.setItem('user-locale', locale);
        mockProducts = [
          { ...makeProduct('Euro gadget'), price: 1234.56, currency: 'EUR' },
        ];
        const { user } = render(<ProductsTable organizationId="test-org-id" />);

        const row = productRow('Euro gadget');
        expect(row).toBeInstanceOf(HTMLElement);
        if (!(row instanceof HTMLElement)) return;
        const tablePrice = plainSpaces(within(row).getByText(/€/).textContent);

        await user.click(within(row).getByText('Euro gadget'));
        const dialog = await screen.findByRole('dialog');
        const detailsPrice = plainSpaces(
          within(dialog).getByText(/€/).textContent,
        );

        expect({ tablePrice, detailsPrice }).toEqual({
          tablePrice: expected,
          detailsPrice: expected,
        });
      },
    );
  });

  // #3617: the backend answers `null` for a price or stock nobody set, and
  // the cells read it as a value: `$0.00` and a blank stock. The rows here go
  // through the real listing adapter, as a reload reads them.
  describe('unset price and stock', () => {
    const wireRow = {
      organizationId: 'test-org-id',
      description: null,
      imageUrl: null,
      category: null,
      tags: [],
      status: 'draft',
      translations: null,
      externalId: null,
      metadata: null,
      createdAt: 1770000000000,
      updatedAt: 1770003600000,
    };

    async function readBack(
      items: Record<string, unknown>[],
    ): Promise<Product[]> {
      window.__ENV__ = { BASE_PATH: '' };
      const fetchSpy = vi
        .spyOn(window, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ items, nextCursor: null })),
        );
      const page = await engagementPaginatedAdapters[
        'products/queries:listProductsPaginated'
      ]?.({}, { organizationId: 'test-org-id' })
        ?.fetchPage(null, 20)
        .finally(() => {
          fetchSpy.mockRestore();
          delete window.__ENV__;
        });
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the adapter's page holds the listing's product rows
      return (page?.page ?? []) as Product[];
    }

    function cellUnder(row: HTMLElement, header: string): string {
      const column = screen
        .getAllByRole('columnheader')
        .findIndex((cell) => cell.textContent === header);
      const cell = within(row).getAllByRole('cell')[column];
      return plainSpaces(cell?.textContent ?? null);
    }

    it('shows the dash for a price and stock nobody set, and zero for a saved zero', async () => {
      const readBackRows = await readBack([
        {
          ...wireRow,
          id: 'product-unset',
          name: 'Unpriced gadget',
          stock: null,
          price: null,
          currency: null,
        },
        {
          ...wireRow,
          id: 'product-zero',
          name: 'Free gadget',
          stock: 0,
          price: 0,
          currency: 'CHF',
        },
      ]);
      const {
        price: _price,
        stock: _stock,
        ...absent
      } = makeProduct('Absent gadget');
      mockProducts = [...readBackRows, absent];
      render(<ProductsTable organizationId="test-org-id" />);

      const shown = Object.fromEntries(
        ['Unpriced gadget', 'Free gadget', 'Absent gadget'].map((name) => {
          const row = productRow(name);
          if (!(row instanceof HTMLElement)) return [name, null];
          return [
            name,
            { price: cellUnder(row, 'Price'), stock: cellUnder(row, 'Stock') },
          ];
        }),
      );
      expect(shown).toEqual({
        'Unpriced gadget': { price: '-', stock: '-' },
        'Free gadget': { price: 'CHF 0.00', stock: '0' },
        'Absent gadget': { price: '-', stock: '-' },
      });
    });

    it('leaves an unset price and stock out of the product details', async () => {
      mockProducts = await readBack([
        {
          ...wireRow,
          id: 'product-unset',
          name: 'Unpriced gadget',
          stock: null,
          price: null,
          currency: null,
        },
      ]);
      const { user } = render(<ProductsTable organizationId="test-org-id" />);

      const row = productRow('Unpriced gadget');
      expect(row).toBeInstanceOf(HTMLElement);
      if (!(row instanceof HTMLElement)) return;
      await user.click(within(row).getByText('Unpriced gadget'));

      const dialog = await screen.findByRole('dialog', {
        name: 'Product details',
      });
      expect(within(dialog).queryByText('Price')).not.toBeInTheDocument();
      expect(within(dialog).queryByText('Stock')).not.toBeInTheDocument();
      expect(within(dialog).queryByText(/0\.00/)).not.toBeInTheDocument();
    });

    it('shows a saved zero price and stock in the product details', async () => {
      mockProducts = await readBack([
        {
          ...wireRow,
          id: 'product-zero',
          name: 'Free gadget',
          stock: 0,
          price: 0,
          currency: 'CHF',
        },
      ]);
      const { user } = render(<ProductsTable organizationId="test-org-id" />);

      const row = productRow('Free gadget');
      expect(row).toBeInstanceOf(HTMLElement);
      if (!(row instanceof HTMLElement)) return;
      await user.click(within(row).getByText('Free gadget'));

      const dialog = await screen.findByRole('dialog', {
        name: 'Product details',
      });
      expect(plainSpaces(within(dialog).getByText(/0\.00/).textContent)).toBe(
        'CHF 0.00',
      );
      expect(within(dialog).getByText('0 units')).toBeInTheDocument();
    });
  });

  // Products used to render a client paginator of its own (#1108). Every other
  // overview list ends on the shared sticky "Showing all N {entity}" footer,
  // so this one does too.
  describe('entity count footer', () => {
    it('reads the singular noun for exactly one product', () => {
      mockProducts = [makeProduct('Solo gadget')];
      render(<ProductsTable organizationId="test-org-id" />);
      expect(screen.getByText('Showing all 1 product')).toBeInTheDocument();
    });

    it('reads the plural noun for more than one product', () => {
      mockProducts = [makeProduct('One'), makeProduct('Two')];
      render(<ProductsTable organizationId="test-org-id" />);
      expect(screen.getByText('Showing all 2 products')).toBeInTheDocument();
    });

    it('renders no page navigation', () => {
      mockProducts = Array.from({ length: 30 }, (_, i) =>
        makeProduct(`Gadget ${i}`),
      );
      render(<ProductsTable organizationId="test-org-id" />);
      expect(
        screen.queryByRole('button', { name: 'Previous page' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Next page' }),
      ).not.toBeInTheDocument();
    });
  });
});
