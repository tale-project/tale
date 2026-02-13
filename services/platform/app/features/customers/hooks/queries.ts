import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';
import { useMemo } from 'react';

import type { Customer } from '@/lib/collections/entities/customers';

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
        .select(({ c }) => ({
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
        })),
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
        .select(({ c }) => ({
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
        })),
    [customerId],
  );

  return useMemo(() => data?.[0] ?? null, [data]);
}
