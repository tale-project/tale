import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { fetchQuery } from '@/lib/convex-next-server';
import { getAuthToken } from '@/lib/auth/auth-server';
import { api } from '@/convex/_generated/api';
import NavigationServer from '@/components/navigation-server';
import MobileNavigationServer from '@/components/mobile-navigation-server';

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
    <div className="flex flex-col md:flex-row size-full">
      {/* Mobile header with hamburger menu - height matches side nav width (52px = 8px + 32px + 8px) */}
      <div className="md:hidden flex items-center justify-between h-[52px] px-3 py-2 border-b border-border bg-background">
        <MobileNavigationServer role={memberContext.role} />
      </div>

      {/* Desktop Navigation - hidden on mobile, width matches mobile nav height (52px) */}
      <div className="hidden md:flex md:flex-[0_0_52px] h-full px-2">
        <NavigationServer
          organizationId={organizationId}
          role={memberContext.role}
        />
      </div>

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-h-0 md:border-l border-border bg-background">
        <div className="flex-1 min-h-0 overflow-auto flex flex-col">
          {children}
        </div>
      </div>
    </div>
  );
}
