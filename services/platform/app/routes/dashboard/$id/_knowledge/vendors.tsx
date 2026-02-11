import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { VendorsEmptyState } from '@/app/features/vendors/components/vendors-empty-state';
import { VendorsTable } from '@/app/features/vendors/components/vendors-table';
import { VendorsTableSkeleton } from '@/app/features/vendors/components/vendors-table-skeleton';
import {
  useVendorCollection,
  useVendors,
} from '@/app/features/vendors/hooks/collections';

const searchSchema = z.object({
  query: z.string().optional(),
  source: z.string().optional(),
  locale: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/vendors')({
  validateSearch: searchSchema,
  component: VendorsPage,
});

function VendorsPage() {
  const { id: organizationId } = Route.useParams();
  const vendorCollection = useVendorCollection(organizationId);
  const { vendors, isLoading } = useVendors(vendorCollection);

  if (isLoading) {
    return <VendorsTableSkeleton organizationId={organizationId} />;
  }

  if (!vendors || vendors.length === 0) {
    return <VendorsEmptyState organizationId={organizationId} />;
  }

  return <VendorsTable organizationId={organizationId} vendors={vendors} />;
}
