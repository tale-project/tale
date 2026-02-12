import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Customer } from '@/lib/collections/entities/customers';

export function useCustomers(collection: Collection<Customer, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ customer: collection }).select(({ customer }) => customer),
  );

  return {
    customers: data,
    isLoading,
  };
}
