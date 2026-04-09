import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { VendorRowActions } from './vendor-row-actions';

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteVendor: () => ({ mutateAsync: vi.fn() }),
  useUpdateVendor: () => ({ mutateAsync: vi.fn() }),
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

describe('VendorRowActions', () => {
  describe('accessibility', () => {
    it('passes axe audit with editable vendor', async () => {
      const { container } = render(<VendorRowActions vendor={makeVendor()} />);
      await checkAccessibility(container);
    });

    it('passes axe audit with file_upload source', async () => {
      const vendor = { ...makeVendor(), source: 'file_upload' as const };
      const { container } = render(<VendorRowActions vendor={vendor} />);
      await checkAccessibility(container);
    });
  });
});
