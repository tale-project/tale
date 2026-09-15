import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ProductRowActions } from './product-row-actions';

let mockCanWrite = true;

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => mockCanWrite,
    cannot: () => !mockCanWrite,
  }),
}));

vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteProduct: () => ({ mutateAsync: vi.fn() }),
  useUpdateProduct: () => ({ mutateAsync: vi.fn() }),
  useCreateProduct: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

function makeProduct(overrides = {}) {
  return {
    _id: 'product-1',
    _creationTime: Date.now(),
    organizationId: 'test-org-id',
    name: 'Test Product',
    description: 'A test product',
    price: 19.99,
    currency: 'USD',
    ...overrides,
  };
}

async function openMenu(product = makeProduct()) {
  const { user } = render(<ProductRowActions product={product} />);
  await user.click(screen.getByRole('button', { name: 'Open menu' }));
  const items = await screen.findAllByRole('menuitem');
  return { user, labels: items.map((item) => item.textContent) };
}

describe('ProductRowActions', () => {
  it('offers View, Edit, View source, then Delete', async () => {
    const { labels } = await openMenu(
      makeProduct({ metadata: { url: 'https://example.com/product' } }),
    );

    expect(labels).toEqual(['View', 'Edit', 'View source', 'Delete']);
  });

  it('still offers View to a member who cannot edit', async () => {
    mockCanWrite = false;
    try {
      const { labels } = await openMenu();

      expect(labels).toEqual(['View']);
    } finally {
      mockCanWrite = true;
    }
  });

  it('opens the product details from View', async () => {
    const { user } = await openMenu();

    await user.click(screen.getByRole('menuitem', { name: 'View' }));

    expect(
      await screen.findByRole('dialog', { name: 'Product details' }),
    ).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ProductRowActions product={makeProduct()} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with external link', async () => {
      const { container } = render(
        <ProductRowActions
          product={makeProduct({
            metadata: { url: 'https://example.com/product' },
          })}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
