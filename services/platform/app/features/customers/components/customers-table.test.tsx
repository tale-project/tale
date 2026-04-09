import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { CustomersTable } from './customers-table';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('../hooks/mutations', () => ({
  useBulkCreateCustomers: () => ({ mutateAsync: vi.fn() }),
  useDeleteCustomer: () => ({ mutateAsync: vi.fn() }),
  useUpdateCustomer: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../hooks/queries', () => ({
  useApproxCustomerCount: () => ({ data: 0 }),
  useListCustomersPaginated: () => ({
    results: [],
    status: 'Exhausted',
    loadMore: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock('../hooks/use-customers-table-config', () => ({
  useCustomersTableConfig: () => ({
    columns: [],
    searchPlaceholder: 'Search customers...',
    stickyLayout: undefined,
    pageSize: 25,
  }),
}));

describe('CustomersTable', () => {
  describe('accessibility', () => {
    it('passes axe audit in empty state', async () => {
      const { container } = render(
        <CustomersTable organizationId="test-org-id" />,
      );
      // Disable aria-allowed-attr: Radix UI Popover renders aria-haspopup on a div,
      // which is a third-party component issue outside our control.
      await checkAccessibility(container, {
        rules: { 'aria-allowed-attr': { enabled: false } },
      });
    });
  });
});
