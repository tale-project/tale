import { useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { CustomerStatus } from '@/constants/convex-enums';

export function useUpdateCustomer() {
  const params = useParams();
  const searchParams = useSearchParams();

  // Build query params from URL to match the active query
  const queryParams = useMemo(() => {
    const organizationId = params.id as string;
    const pageSize = searchParams.get('size')
      ? Number.parseInt(searchParams.get('size')!)
      : 10;
    const statusFilters = searchParams.get('status')?.split(',').filter(Boolean) as
      | CustomerStatus[]
      | undefined;
    const sourceFilters = searchParams.get('source')?.split(',').filter(Boolean);
    const localeFilters = searchParams.get('locale')?.split(',').filter(Boolean);
    const searchTerm = searchParams.get('query') || undefined;

    return {
      organizationId,
      paginationOpts: {
        numItems: pageSize,
        cursor: null,
      },
      status: statusFilters,
      source: sourceFilters,
      locale: localeFilters,
      searchTerm,
    };
  }, [params.id, searchParams]);

  return useMutation(api.customers.updateCustomer).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.customers.getCustomers, queryParams);

      if (current !== undefined) {
        type Customer = (typeof current.page)[number];
        const updatedPage = current.page.map((customer: Customer) =>
          customer._id === args.customerId
            ? {
                ...customer,
                ...(args.name !== undefined && { name: args.name }),
                ...(args.email !== undefined && { email: args.email }),
                ...(args.locale !== undefined && { locale: args.locale }),
              }
            : customer
        );
        localStore.setQuery(api.customers.getCustomers, queryParams, {
          ...current,
          page: updatedPage,
        });
      }
    }
  );
}
