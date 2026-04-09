import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { VendorDeleteDialog } from './vendor-delete-dialog';

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteVendor: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

function makeVendor() {
  return {
    _id: 'vendor-1' as never,
    _creationTime: Date.now(),
    organizationId: 'test-org-id',
    name: 'Test Vendor',
    email: 'vendor@example.com',
    source: 'manual_import' as const,
    locale: 'en',
  };
}

describe('VendorDeleteDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <VendorDeleteDialog
          vendor={makeVendor()}
          isOpen={true}
          onOpenChange={vi.fn()}
          asChild
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with trigger button', async () => {
      const { container } = render(
        <VendorDeleteDialog vendor={makeVendor()} />,
      );
      await checkAccessibility(container);
    });
  });
});
