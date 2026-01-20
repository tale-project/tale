import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { z } from 'zod';
import { api } from '@/convex/_generated/api';
import { VendorsTable } from '@/app/features/vendors/components/vendors-table';
import { VendorsTableSkeleton } from '@/app/features/vendors/components/vendors-table-skeleton';
import { VendorsEmptyState } from '@/app/features/vendors/components/vendors-empty-state';

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
  const vendors = useQuery(api.vendors.queries.getAllVendors, { organizationId });

  if (vendors === undefined) {
    return <VendorsTableSkeleton organizationId={organizationId} />;
  }

  if (vendors.length === 0) {
    return <VendorsEmptyState organizationId={organizationId} />;
  }

  return <VendorsTable organizationId={organizationId} />;
}
