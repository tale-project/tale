import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { CustomerRowActions } from './customer-row-actions';

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteCustomer: () => ({ mutateAsync: vi.fn() }),
  useUpdateCustomer: () => ({ mutateAsync: vi.fn() }),
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

describe('CustomerRowActions', () => {
  describe('accessibility', () => {
    it('passes axe audit with editable customer', async () => {
      const { container } = render(
        <CustomerRowActions customer={makeCustomer()} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with file_upload source', async () => {
      const customer = { ...makeCustomer(), source: 'file_upload' as const };
      const { container } = render(<CustomerRowActions customer={customer} />);
      await checkAccessibility(container);
    });
  });
});
