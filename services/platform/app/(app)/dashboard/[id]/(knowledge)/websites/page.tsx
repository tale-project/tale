import { WebsitesTable } from './components/websites-table';
import { WebsitesTableSkeleton } from './components/websites-table-skeleton';
import { Suspense } from 'react';
import { fetchQuery, preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { getT } from '@/lib/i18n/server';
import { parseSearchParams, hasActiveFilters } from '@/lib/pagination/parse-search-params';
import { websiteFilterDefinitions } from './filter-definitions';
import { WebsitesEmptyState } from './components/websites-empty-state';
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

  // Parse filters from URL using unified system
  const { filters } = parseSearchParams(
    rawSearchParams,
    websiteFilterDefinitions,
  );

  // Preload websites with cursor-based pagination for SSR + real-time reactivity
  const preloadedWebsites = await preloadQuery(
    api.websites.getWebsites,
    {
      organizationId,
      paginationOpts: {
        numItems: 20,
        cursor: null, // First page, no cursor
      },
      searchTerm: filters.query || undefined,
      status: filters.status.length > 0 ? filters.status : undefined,
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

  return (
    <Suspense fallback={<WebsitesTableSkeleton organizationId={organizationId} />}>
      <WebsitesContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
