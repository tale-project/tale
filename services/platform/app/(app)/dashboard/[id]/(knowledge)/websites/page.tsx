import { WebsitesTable } from './websites-table';
import { Suspense } from 'react';
import { DataTableSkeleton } from '@/components/ui/data-table';
import { fetchQuery, preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { getT } from '@/lib/i18n/server';
import { parseSearchParams, hasActiveFilters } from '@/lib/pagination/parse-search-params';
import { websiteFilterDefinitions } from './filter-definitions';
import { WebsitesEmptyState } from './websites-empty-state';
import type { Metadata } from 'next';

// This page requires authentication (cookies/connection), so it must be dynamic
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('metadata');
  return {
    title: t('websites.title'),
    description: t('websites.description'),
  };
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Skeleton for the websites table with header and rows - matches websites-table.tsx column sizes */
async function WebsitesSkeleton() {
  const { t } = await getT('tables');

  return (
    <DataTableSkeleton
      rows={10}
      columns={[
        { header: t('headers.website') }, // No size = expands to fill remaining space
        { header: t('headers.title'), size: 192 },
        { header: t('headers.description'), size: 256 },
        { header: t('headers.scanned'), size: 128 },
        { header: t('headers.interval'), size: 96 },
        { isAction: true, size: 128 },
      ]}
      showHeader
      showFilters
    />
  );
}


interface WebsitesContentProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function WebsitesContent({ params, searchParams }: WebsitesContentProps) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;
  const rawSearchParams = await searchParams;

  // Parse filters, pagination, and sorting using unified system
  const { filters, pagination, sorting } = parseSearchParams(
    rawSearchParams,
    websiteFilterDefinitions,
    { defaultSort: '_creationTime', defaultDesc: true },
  );

  // Preload websites for SSR + real-time reactivity on client
  const preloadedWebsites = await preloadQuery(
    api.websites.listWebsites,
    {
      organizationId,
      currentPage: pagination.page,
      pageSize: pagination.pageSize,
      searchTerm: filters.query || undefined,
      status: filters.status.length > 0 ? filters.status : undefined,
      sortField: sorting[0]?.id,
      sortOrder: sorting[0] ? (sorting[0].desc ? 'desc' : 'asc') : undefined,
    },
    { token },
  );

  return (
    <WebsitesTable
      organizationId={organizationId}
      preloadedWebsites={preloadedWebsites}
    />
  );
}

export default async function WebsitesPage({
  params,
  searchParams,
}: PageProps) {
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;
  const rawSearchParams = await searchParams;

  // Parse filters to check for active filters
  const { filters } = parseSearchParams(rawSearchParams, websiteFilterDefinitions);
  const hasFilters = hasActiveFilters(filters, websiteFilterDefinitions);

  // Two-phase loading: check if websites exist before showing skeleton
  // If no websites and no filters active, show empty state directly
  if (!hasFilters) {
    const hasWebsites = await fetchQuery(
      api.websites.hasWebsites,
      { organizationId },
      { token },
    );

    if (!hasWebsites) {
      return <WebsitesEmptyState organizationId={organizationId} />;
    }
  }

  const skeletonFallback = await Promise.resolve(<WebsitesSkeleton />);

  return (
    <Suspense fallback={skeletonFallback}>
      <WebsitesContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
