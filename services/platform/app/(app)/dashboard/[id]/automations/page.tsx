import { SuspenseLoader } from '@/components/suspense-loader';
import { api } from '@/convex/_generated/api';

import AutomationsTable from './components/automations-table';
import { fetchQuery } from '@/lib/convex-next-server';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';

interface AutomationsPageProps {
  params: Promise<{ id: string }>;
}

async function AutomationsPageContent({ params }: AutomationsPageProps) {
  const { id: organizationId } = await params;

  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  // Check user's role in the organization
  const memberContext = await fetchQuery(
    api.member.getCurrentMemberContext,
    {
      organizationId: organizationId,
    },
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

  const automations = await fetchQuery(
    api.wf_definitions.listWorkflowsWithBestVersionPublic,
    {
      organizationId,
    },
    { token },
  );

  return (
    <AutomationsTable
      automations={automations}
      organizationId={organizationId}
    />
  );
}

export default function AutomationsPage(props: AutomationsPageProps) {
  return (
    <SuspenseLoader>
      <AutomationsPageContent {...props} />
    </SuspenseLoader>
  );
}
