import { SuspenseLoader } from '@/components/suspense-loader';
import { api } from '@/convex/_generated/api';

import AutomationsTable from './components/automations-table';
import { fetchQuery } from '@/lib/convex-next-server';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { TableSkeleton } from '@/components/skeletons';

interface AutomationsPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Skeleton for the automations table.
 */
function AutomationsSkeleton() {
  return (
    <div className="px-4 py-6">
      <TableSkeleton
        rows={6}
        headers={['Name', 'Status', 'Trigger', 'Last Run', 'Actions']}
      />
    </div>
  );
}

interface AutomationsContentProps {
  params: Promise<{ id: string }>;
}

async function AutomationsPageContent({ params }: AutomationsContentProps) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const token = await getAuthToken();
  const { id: organizationId } = await params;
  if (!token) {
    redirect('/log-in');
  }

  // Parallelize both fetches for better performance
  // We fetch automations eagerly but only render if user has access
  const [memberContext, automations] = await Promise.all([
    fetchQuery(
      api.member.getCurrentMemberContext,
      { organizationId },
      { token },
    ),
    fetchQuery(
      api.wf_definitions.listWorkflowsWithBestVersionPublic,
      { organizationId },
      { token },
    ),
  ]);

  // Only Admin and Developer can access automations (case-insensitive comparison)
  const userRole = (memberContext.role ?? '').toLowerCase();
  if (userRole !== 'admin' && userRole !== 'developer') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <h1 className="text-2xl font-semibold text-foreground mb-2">
          Access Denied
        </h1>
        <p className="text-muted-foreground">
          You need Admin or Developer permissions to access automations.
        </p>
      </div>
    );
  }

  return (
    <AutomationsTable
      automations={automations}
      organizationId={organizationId}
    />
  );
}

export default function AutomationsPage({ params }: AutomationsPageProps) {
  return (
    <SuspenseLoader fallback={<AutomationsSkeleton />}>
      <AutomationsPageContent params={params} />
    </SuspenseLoader>
  );
}
