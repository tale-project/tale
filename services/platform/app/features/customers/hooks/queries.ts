import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';
import { useMemo } from 'react';

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

export function useCustomerByEmail(
  collection: Collection<Customer, string>,
  email: string | undefined,
) {
  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ c: collection })
        .fn.where((row) => row.c.email === email)
        .select(({ c }) => c),
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
        .select(({ c }) => c),
    [customerId],
  );

  return useMemo(() => data?.[0] ?? null, [data]);
}
