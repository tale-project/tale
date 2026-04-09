import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { CustomerDeleteDialog } from './customer-delete-dialog';

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteCustomer: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

function makeCustomer() {
  return {
    _id: 'customer-1' as never,
    _creationTime: Date.now(),
    organizationId: 'test-org-id',
    name: 'Test Customer',
    email: 'test@example.com',
    status: 'active' as const,
    source: 'manual_import' as const,
    locale: 'en',
  };
}

describe('CustomerDeleteDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <CustomerDeleteDialog
          customer={makeCustomer()}
          isOpen={true}
          onOpenChange={vi.fn()}
          asChild
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with trigger button', async () => {
      const { container } = render(
        <CustomerDeleteDialog customer={makeCustomer()} />,
      );
      await checkAccessibility(container);
    });
  });
});
