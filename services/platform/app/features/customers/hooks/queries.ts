import type { Collection, Ref } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';
import { useMemo } from 'react';

import type { Customer } from '@/lib/collections/entities/customers';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { api } from '@/convex/_generated/api';

const selectCustomerFields = ({ c }: { c: Ref<Customer> }) => ({
  _id: c._id,
  _creationTime: c._creationTime,
  organizationId: c.organizationId,
  name: c.name,
  email: c.email,
  externalId: c.externalId,
  status: c.status,
  source: c.source,
  locale: c.locale,
  address: c.address,
  metadata: c.metadata,
});

export function useCustomers(collection: Collection<Customer, string>) {
  const { data, isLoading } = useLiveQuery(() => collection);

  return {
    customers: data,
    isLoading,
  };
}

export function useCustomerByEmail(
  collection: Collection<Customer, string>,
  email: string | undefined,
) {
  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ c: collection })
        .fn.where((row) => row.c.email === email)
        .select(selectCustomerFields),
    [email],
  );

  return useMemo(() => data?.[0] ?? null, [data]);
}

export function useCustomerById(
  collection: Collection<Customer, string>,
  customerId: string | undefined,
) {
  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ c: collection })
        .fn.where((row) => row.c._id === customerId)
        .select(selectCustomerFields),
    [customerId],
  );

  return useMemo(() => data?.[0] ?? null, [data]);
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
