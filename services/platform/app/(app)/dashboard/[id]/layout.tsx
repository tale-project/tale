import { ReactNode, Suspense } from 'react';
import { redirect } from 'next/navigation';
import { fetchQuery } from '@/lib/convex-next-server';
import { getAuthToken } from '@/lib/auth/auth-server';
import { api } from '@/convex/_generated/api';
import { NavigationSkeleton } from '@/components/skeletons';
import NavigationServer from '@/components/navigation-server';

export interface DashboardLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

/**
 * Navigation wrapper that handles auth and data fetching inside Suspense
 */
async function NavigationWrapper({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const { id: organizationId } = await params;
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  // Validate organization access server-side
  const [memberContext, organization] = await Promise.all([
    fetchQuery(
      api.member.getCurrentMemberContext,
      { organizationId },
      { token },
    ).catch(() => null),
    fetchQuery(
      api.organizations.getOrganization,
      { id: organizationId },
      { token },
    ).catch(() => null),
  ]);

  // Handle auth/org validation failures
  if (!memberContext?.member) {
    redirect('/log-in');
  }

  if (!organization) {
    redirect('/dashboard/create-organization');
  }

  return (
    <NavigationServer
      organizationId={organizationId}
      role={memberContext.role}
    />
  );
}

/**
 * Dashboard Layout - Server Component
 *
 * This layout is a Server Component that:
 * 1. Validates authentication and organization access server-side
 * 2. Streams the navigation independently via Suspense
 *
 * Performance benefits:
 * - No client-side auth checks (faster initial render)
 * - Navigation streams independently from page content
 * - Progressive rendering with Suspense boundaries
 */
export default function DashboardLayout({
  children,
  params,
}: DashboardLayoutProps) {
  return (
    <div className="flex justify-stretch size-full">
      {/* Navigation - streams independently */}
      <div className="flex-[0_0_52px] overflow-y-auto px-2">
        <Suspense fallback={<NavigationSkeleton items={5} />}>
          <NavigationWrapper params={params} />
        </Suspense>
      </div>

      {/* Main content area */}
      <div className="flex flex-col flex-[1_1_0] justify-stretch overflow-y-auto border-l border-border bg-background">
        <div className="flex-1 min-h-0 overflow-auto flex flex-col">
          {children}
        </div>
      </div>
    </div>
  );
}
