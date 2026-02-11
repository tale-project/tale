import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { Vendor } from '@/lib/collections/entities/vendors';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

/**
 * No optimistic update as bulk operations create multiple items
 * and the server handles validation/deduplication.
 */
export function useBulkCreateVendors() {
  return useConvexMutation(api.vendors.mutations.bulkCreateVendors);
}

export function useDeleteVendor(collection: Collection<Vendor, string>) {
  return useCallback(
    async (args: { vendorId: string }) => {
      const tx = collection.delete(args.vendorId);
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useUpdateVendor(collection: Collection<Vendor, string>) {
  return useCallback(
    async (args: {
      vendorId: string;
      name?: string;
      email?: string;
      phone?: string;
      externalId?: string;
      source?: 'manual_import' | 'file_upload' | 'circuly';
      locale?: string;
      address?: {
        street?: string;
        city?: string;
        state?: string;
        zip?: string;
        country?: string;
      };
      tags?: string[];
      metadata?: Record<string, unknown>;
      notes?: string;
    }) => {
      const tx = collection.update(args.vendorId, (draft) => {
        if (args.name !== undefined) draft.name = args.name;
        if (args.email !== undefined) draft.email = args.email;
        if (args.phone !== undefined) draft.phone = args.phone;
        if (args.externalId !== undefined) draft.externalId = args.externalId;
        if (args.source !== undefined) draft.source = args.source;
        if (args.locale !== undefined) draft.locale = args.locale;
        if (args.address !== undefined) draft.address = args.address;
        if (args.tags !== undefined) draft.tags = args.tags;
        if (args.metadata !== undefined) draft.metadata = args.metadata;
        if (args.notes !== undefined) draft.notes = args.notes;
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}
