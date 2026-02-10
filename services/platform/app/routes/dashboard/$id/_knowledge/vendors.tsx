import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { VendorsEmptyState } from '@/app/features/vendors/components/vendors-empty-state';
import { VendorsTable } from '@/app/features/vendors/components/vendors-table';
import { VendorsTableSkeleton } from '@/app/features/vendors/components/vendors-table-skeleton';
import { api } from '@/convex/_generated/api';

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
  const { data: hasVendors, isLoading } = useQuery(
    convexQuery(api.vendors.queries.hasVendors, { organizationId }),
  );

  if (isLoading) {
    return <VendorsTableSkeleton organizationId={organizationId} />;
  }

  if (!hasVendors) {
    return <VendorsEmptyState organizationId={organizationId} />;
  }

  return <VendorsTable organizationId={organizationId} />;
}
