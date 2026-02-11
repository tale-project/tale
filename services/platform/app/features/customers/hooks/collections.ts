import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Customer } from '@/lib/collections/entities/customers';

import { createCustomersCollection } from '@/lib/collections/entities/customers';
import { useCollection } from '@/lib/collections/use-collection';

export function useCustomerCollection(organizationId: string) {
  return useCollection('customers', createCustomersCollection, organizationId);
}

export function useCustomers(collection: Collection<Customer, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ customer: collection }).select(({ customer }) => customer),
  );

  return {
    customers: data,
    isLoading,
  };
}
