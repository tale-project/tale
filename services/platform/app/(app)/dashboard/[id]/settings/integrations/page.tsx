import { SuspenseLoader } from '@/components/suspense-loader';
import { getAuthToken } from '@/lib/auth/auth-server';
import Integrations from './integrations';
import { redirect } from 'next/navigation';
import { fetchQuery, preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { CardGridSkeleton } from '@/components/skeletons';

interface IntegrationsPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Skeleton for the integrations page that matches the actual layout.
 */
function IntegrationsSkeleton() {
  return <CardGridSkeleton count={6} columns={3} />;
}

interface IntegrationsContentProps {
  params: Promise<{ id: string }>;
}

async function IntegrationsPageContent({ params }: IntegrationsContentProps) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const token = await getAuthToken();
  const { id: organizationId } = await params;
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

  // Preload integrations data for SSR + real-time reactivity on client
  const [preloadedShopify, preloadedCirculy, preloadedEmailProviders] =
    await Promise.all([
      preloadQuery(
        api.integrations.getByName,
        { organizationId, name: 'shopify' },
        { token },
      ),
      preloadQuery(
        api.integrations.getByName,
        { organizationId, name: 'circuly' },
        { token },
      ),
      preloadQuery(api.email_providers.list, { organizationId }, { token }),
    ]);

  return (
    <Integrations
      organizationId={organizationId}
      preloadedShopify={preloadedShopify}
      preloadedCirculy={preloadedCirculy}
      preloadedEmailProviders={preloadedEmailProviders}
    />
  );
}

export default function IntegrationsPage({ params }: IntegrationsPageProps) {
  return (
    <SuspenseLoader fallback={<IntegrationsSkeleton />}>
      <IntegrationsPageContent params={params} />
    </SuspenseLoader>
  );
}
