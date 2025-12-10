import { SuspenseLoader } from '@/components/suspense-loader';
import { getAuthToken } from '@/lib/auth/auth-server';
import Integrations from './integrations';
import { redirect } from 'next/navigation';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';

interface IntegrationsPageProps {
  params: Promise<{ id: string }>;
}

async function IntegrationsPageContent({ params }: IntegrationsPageProps) {
  const { id: organizationId } = await params;

  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  // Check user's role in the organization
  const memberContext = await fetchQuery(
    api.member.getCurrentMemberContext,
    {
      organizationId,
    },
    { token },
  );

  // Only Admin or Developer can access integrations settings (case-insensitive)
  const userRole = (memberContext.role ?? '').toLowerCase();
  const hasAccess = userRole === 'admin' || userRole === 'developer';

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <h1 className="text-2xl font-semibold text-foreground mb-2">
          Access Denied
        </h1>
        <p className="text-muted-foreground">
          You need Admin or Developer permissions to access integrations
          settings.
        </p>
      </div>
    );
  }

  return <Integrations organizationId={organizationId} />;
}

export default function IntegrationsPage(props: IntegrationsPageProps) {
  return (
    <SuspenseLoader>
      <IntegrationsPageContent {...props} />
    </SuspenseLoader>
  );
}
