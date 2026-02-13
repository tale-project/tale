import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { VendorsEmptyState } from '@/app/features/vendors/components/vendors-empty-state';
import { VendorsTable } from '@/app/features/vendors/components/vendors-table';
import { VendorsTableSkeleton } from '@/app/features/vendors/components/vendors-table-skeleton';
import { useListVendorsPaginated } from '@/app/features/vendors/hooks/queries';

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
  const search = Route.useSearch();

  const paginatedResult = useListVendorsPaginated({
    organizationId,
    source: search.source,
    locale: search.locale,
    initialNumItems: 20,
  });

  if (paginatedResult.status === 'LoadingFirstPage') {
    return <VendorsTableSkeleton organizationId={organizationId} />;
  }

  if (
    paginatedResult.status === 'Exhausted' &&
    paginatedResult.results.length === 0
  ) {
    return <VendorsEmptyState organizationId={organizationId} />;
  }

  return (
    <VendorsTable
      organizationId={organizationId}
      paginatedResult={paginatedResult}
      source={search.source}
      locale={search.locale}
    />
  );
}
