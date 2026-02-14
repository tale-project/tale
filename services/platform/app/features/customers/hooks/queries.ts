import { useMemo } from 'react';

import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export type Customer = ConvexItemOf<typeof api.customers.queries.listCustomers>;

export function useCustomers(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.customers.queries.listCustomers,
    { organizationId },
  );

  return {
    customers: data ?? [],
    isLoading,
  };
}

export function useCustomerByEmail(
  customers: Customer[],
  email: string | undefined,
) {
  return useMemo(
    () => customers.find((c) => c.email === email) ?? null,
    [customers, email],
  );
}

export function useCustomerById(
  customers: Customer[],
  customerId: string | undefined,
) {
  return useMemo(
    () => customers.find((c) => c._id === customerId) ?? null,
    [customers, customerId],
  );
}

interface ListCustomersPaginatedArgs {
  organizationId: string;
  status?: string;
  source?: string;
  locale?: string;
  initialNumItems: number;
}

export function useListCustomersPaginated(args: ListCustomersPaginatedArgs) {
  const { initialNumItems, ...queryArgs } = args;

  return useCachedPaginatedQuery(
    api.customers.queries.listCustomersPaginated,
    queryArgs,
    { initialNumItems },
  );
}
