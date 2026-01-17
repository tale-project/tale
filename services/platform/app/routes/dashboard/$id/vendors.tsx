import { createFileRoute } from '@tanstack/react-router';
import { Suspense } from 'react';
import { useQuery } from 'convex/react';
import { z } from 'zod';
import { api } from '@/convex/_generated/api';
import { VendorsTable } from '@/app/features/knowledge/vendors/components/vendors-table';
import { VendorsTableSkeleton } from '@/app/features/knowledge/vendors/components/vendors-table-skeleton';
import { VendorsPageWrapper } from '@/app/features/knowledge/vendors/components/vendors-page-wrapper';

const searchSchema = z.object({
  query: z.string().optional(),
  source: z.string().optional(),
  locale: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/vendors')({
  validateSearch: searchSchema,
  component: VendorsPage,
});

function VendorsPage() {
  const { id: organizationId } = Route.useParams();
  const hasVendors = useQuery(api.vendors.hasVendors, { organizationId });

  if (hasVendors === undefined) {
    return <VendorsTableSkeleton organizationId={organizationId} />;
  }

  return (
    <VendorsPageWrapper
      organizationId={organizationId}
      initialHasVendors={hasVendors}
    >
      <Suspense fallback={<VendorsTableSkeleton organizationId={organizationId} />}>
        <VendorsTable organizationId={organizationId} />
      </Suspense>
    </VendorsPageWrapper>
  );
}
