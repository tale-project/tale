import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ProductRowActions } from './product-row-actions';

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
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

function makeProduct() {
  return {
    _id: 'product-1' as never,
    _creationTime: Date.now(),
    organizationId: 'test-org-id',
    name: 'Test Product',
    description: 'A test product',
    price: 19.99,
    currency: 'USD',
    source: 'manual_import' as const,
    locale: 'en',
  };
}

describe('ProductRowActions', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ProductRowActions product={makeProduct()} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with external link', async () => {
      const product = {
        ...makeProduct(),
        metadata: { url: 'https://example.com/product' },
      };
      const { container } = render(<ProductRowActions product={product} />);
      await checkAccessibility(container);
    });
  });
});
