import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { fetchQuery } from '@/lib/convex-next-server';
import { getAuthToken } from '@/lib/auth/auth-server';
import { api } from '@/convex/_generated/api';
import NavigationServer from '@/components/navigation-server';

export interface DashboardLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

/**
 * Dashboard Layout - Server Component
 *
 * This layout is a Server Component that:
 * 1. Validates authentication and organization access server-side
 * 2. Renders navigation directly without Suspense (fast server-side render)
 *
 * Performance benefits:
 * - No client-side auth checks (faster initial render)
 * - Navigation renders immediately with SSR (no skeleton flash)
 * - Auth validation happens once at layout level
 */
export default async function DashboardLayout({
  children,
  params,
}: DashboardLayoutProps) {
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
    <div className="flex justify-stretch size-full">
      {/* Navigation - rendered directly with SSR, no skeleton needed */}
      <div className="flex-[0_0_52px] overflow-y-auto px-2">
        <NavigationServer
          organizationId={organizationId}
          role={memberContext.role}
        />
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
