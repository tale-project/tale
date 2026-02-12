import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { Customer } from '@/lib/collections/entities/customers';

export function useDeleteCustomer(collection: Collection<Customer, string>) {
  return useCallback(
    async (args: { customerId: string }) => {
      const tx = collection.delete(args.customerId);
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useUpdateCustomer(collection: Collection<Customer, string>) {
  return useCallback(
    async (args: {
      customerId: string;
      name?: string;
      email?: string;
      externalId?: string;
      status?: 'active' | 'potential' | 'churned';
      source?: 'manual_import' | 'file_upload' | 'circuly';
      locale?: string;
      address?: {
        street?: string;
        city?: string;
        state?: string;
        zip?: string;
        country?: string;
      };
      metadata?: Record<string, unknown>;
    }) => {
      const tx = collection.update(args.customerId, (draft) => {
        if (args.name !== undefined) draft.name = args.name;
        if (args.email !== undefined) draft.email = args.email;
        if (args.externalId !== undefined) draft.externalId = args.externalId;
        if (args.status !== undefined) draft.status = args.status;
        if (args.source !== undefined) draft.source = args.source;
        if (args.locale !== undefined) draft.locale = args.locale;
        if (args.address !== undefined) draft.address = args.address;
        if (args.metadata !== undefined) draft.metadata = args.metadata;
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}
