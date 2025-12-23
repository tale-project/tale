import { Suspense } from 'react';
import { getAuthToken } from '@/lib/auth/auth-server';
import Integrations from './integrations';
import { redirect } from 'next/navigation';
import { fetchQuery, preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { Skeleton } from '@/components/ui/skeleton';

interface IntegrationsPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Skeleton for integration card matching the actual layout.
 */
function IntegrationCardSkeleton() {
  return (
    <div className="bg-background rounded-xl border border-border shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] flex flex-col justify-between">
      {/* Main content area */}
      <div className="p-5">
        <div className="flex flex-col gap-3">
          {/* Icon */}
          <Skeleton className="w-11 h-11 rounded-md" />
          <div className="space-y-1">
            {/* Title */}
            <Skeleton className="h-5 w-20" />
            {/* Description */}
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
      {/* Footer */}
      <div className="border-t border-border px-5 py-4 flex items-center justify-between">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-5 w-9 rounded-full" />
      </div>
    </div>
  );
}

/**
 * Skeleton for the integrations page that matches the actual layout.
 */
function IntegrationsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <IntegrationCardSkeleton key={i} />
      ))}
    </div>
  );
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
    <Suspense fallback={<IntegrationsSkeleton />}>
      <IntegrationsPageContent params={params} />
    </Suspense>
  );
}
