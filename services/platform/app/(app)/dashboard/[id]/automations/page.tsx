import { Suspense } from 'react';
import { api } from '@/convex/_generated/api';

import { AutomationsTable } from './components/automations-table';
import { AutomationsTableSkeleton } from './components/automations-table-skeleton';
import { fetchQuery, preloadQuery } from '@/lib/convex-next-server';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { DataTableEmptyState, DataTableActionMenu } from '@/components/ui/data-table';
import { Workflow, Sparkles } from 'lucide-react';
import { AccessDenied } from '@/components/layout/access-denied';
import { ContentWrapper } from '@/components/layout/content-wrapper';
import { getT } from '@/lib/i18n/server';
import {
  parseSearchParams,
  hasActiveFilters,
} from '@/lib/pagination/parse-search-params';
import { automationFilterDefinitions } from './filter-definitions';
import type { Metadata } from 'next';

// This page requires authentication (cookies/connection), so it must be dynamic
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('metadata');
  return {
    title: t('automations.title'),
    description: t('automations.description'),
  };
}

interface AutomationsPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Skeleton wrapper for SSR Suspense - uses shared columns from AutomationsTableSkeleton */
function AutomationsSkeleton({ organizationId }: { organizationId: string }) {
  return (
    <ContentWrapper>
      <AutomationsTableSkeleton organizationId={organizationId} />
    </ContentWrapper>
  );
}

/** Empty state shown when org has no automations - avoids unnecessary skeleton */
async function AutomationsEmptyState({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t: tEmpty } = await getT('emptyStates');
  const { t: tAutomations } = await getT('automations');
  return (
    <ContentWrapper>
      <DataTableEmptyState
        icon={Workflow}
        title={tEmpty('automations.title')}
        description={tEmpty('automations.description')}
        actionMenu={
          <DataTableActionMenu
            label={tAutomations('createWithAI')}
            icon={Sparkles}
            href={`/dashboard/${organizationId}/chat`}
          />
        }
      />
    </ContentWrapper>
  );
}

interface AutomationsContentProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function AutomationsPageContent({
  params,
  searchParams,
}: AutomationsContentProps) {
  // Permission check already done in parent component
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;
  const rawSearchParams = await searchParams;

  // Parse filters from URL using unified system
  const { filters } = parseSearchParams(
    rawSearchParams,
    automationFilterDefinitions,
  );

  // Preload automations with cursor-based pagination for SSR + real-time reactivity
  const preloadedAutomations = await preloadQuery(
    api.wf_definitions.getAutomations,
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
    <ContentWrapper>
      <AutomationsTable
        organizationId={organizationId}
        preloadedAutomations={preloadedAutomations}
      />
    </ContentWrapper>
  );
}

export default async function AutomationsPage({
  params,
  searchParams,
}: AutomationsPageProps) {
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;
  const rawSearchParams = await searchParams;

  // Check permissions first
  const memberContext = await fetchQuery(
    api.member.getCurrentMemberContext,
    { organizationId },
    { token },
  );

  const userRole = (memberContext.role ?? '').toLowerCase();
  if (userRole !== 'admin' && userRole !== 'developer') {
    const { t } = await getT('accessDenied');
    return <AccessDenied message={t('automations')} />;
  }

  // Parse filters to check for active filters
  const { filters } = parseSearchParams(
    rawSearchParams,
    automationFilterDefinitions,
  );
  const hasFilters = hasActiveFilters(filters, automationFilterDefinitions);

  // Two-phase loading: check if automations exist before showing skeleton
  if (!hasFilters) {
    const hasAutomations = await fetchQuery(
      api.wf_definitions.hasAutomations,
      { organizationId },
      { token },
    );

    if (!hasAutomations) {
      return <AutomationsEmptyState organizationId={organizationId} />;
    }
  }

  return (
    <Suspense fallback={<AutomationsSkeleton organizationId={organizationId} />}>
      <AutomationsPageContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
