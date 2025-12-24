import { Suspense } from 'react';
import { api } from '@/convex/_generated/api';

import AutomationsTable from './components/automations-table';
import { fetchQuery } from '@/lib/convex-next-server';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import {
  DataTableSkeleton,
  DataTableEmptyState,
} from '@/components/ui/data-table';
import { Workflow, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { AccessDenied, ContentWrapper } from '@/components/layout';

interface AutomationsPageProps {
  params: Promise<{ id: string }>;
}

/** Skeleton for the automations table with header and rows - matches automations-table.tsx column sizes */
function AutomationsSkeleton() {
  return (
    <ContentWrapper>
      <DataTableSkeleton
        rows={6}
        columns={[
          { header: 'Automation' }, // No size = expands to fill remaining space
          { header: 'Status', size: 140 },
          { header: 'Version', size: 100 },
          { header: 'Created', size: 140 },
          { isAction: true, size: 80 },
        ]}
        showHeader
      />
    </ContentWrapper>
  );
}

/** Empty state shown when org has no automations - avoids unnecessary skeleton */
function AutomationsEmptyState({ organizationId }: { organizationId: string }) {
  return (
    <ContentWrapper>
      <DataTableEmptyState
        icon={Workflow}
        title="No automations yet"
        description="Describe your workflow and let your AI automate it"
        action={
          <Button asChild>
            <Link href={`/dashboard/${organizationId}/chat`}>
              <Sparkles className="size-4 mr-2" />
              Create automation with AI
            </Link>
          </Button>
        }
      />
    </ContentWrapper>
  );
}

interface AutomationsContentProps {
  params: Promise<{ id: string }>;
}

async function AutomationsPageContent({ params }: AutomationsContentProps) {
  // Permission check already done in parent component
  const { id: organizationId } = await params;

  // Automations are fetched in the client component with useQuery
  // This enables real-time updates and server-side search filtering
  return (
    <ContentWrapper>
      <AutomationsTable organizationId={organizationId} />
    </ContentWrapper>
  );
}

export default async function AutomationsPage({
  params,
}: AutomationsPageProps) {
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;

  // Check permissions first
  const memberContext = await fetchQuery(
    api.member.getCurrentMemberContext,
    { organizationId },
    { token },
  );

  const userRole = (memberContext.role ?? '').toLowerCase();
  if (userRole !== 'admin' && userRole !== 'developer') {
    return (
      <AccessDenied message="You need Admin or Developer permissions to access automations." />
    );
  }

  // Two-phase loading: check if automations exist before showing skeleton
  const hasAutomations = await fetchQuery(
    api.wf_definitions.hasAutomations,
    { organizationId },
    { token },
  );

  if (!hasAutomations) {
    return <AutomationsEmptyState organizationId={organizationId} />;
  }

  return (
    <Suspense fallback={<AutomationsSkeleton />}>
      <AutomationsPageContent params={params} />
    </Suspense>
  );
}
