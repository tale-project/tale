import { Suspense } from 'react';
import { api } from '@/convex/_generated/api';

import AutomationsTable from './components/automations-table';
import { fetchQuery } from '@/lib/convex-next-server';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { DataTableSkeleton } from '@/components/ui/data-table';

interface AutomationsPageProps {
  params: Promise<{ id: string }>;
}

/** Skeleton for the automations table with header and rows - matches automations-table.tsx column sizes */
function AutomationsSkeleton() {
  return (
    <div className="flex flex-col flex-1 px-4 py-6">
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

  // Fetch member context to check permissions
  const memberContext = await fetchQuery(
    api.member.getCurrentMemberContext,
    { organizationId },
    { token },
  );

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

  // Automations are now fetched in the client component with useQuery
  // This enables real-time updates and server-side search filtering
  return <AutomationsTable organizationId={organizationId} />;
}

export default function AutomationsPage({ params }: AutomationsPageProps) {
  return (
    <Suspense fallback={<AutomationsSkeleton />}>
      <AutomationsPageContent params={params} />
    </Suspense>
  );
}
