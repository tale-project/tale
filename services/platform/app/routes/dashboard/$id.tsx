import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';
import { Navigation } from '@/app/components/ui/navigation/navigation';
import { MobileNavigation } from '@/app/components/ui/navigation/mobile-navigation';
import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderSlot,
} from '@/app/components/layout/adaptive-header';

export const Route = createFileRoute('/dashboard/$id')({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session?.data?.user) {
      throw redirect({ to: '/log-in' });
    }
    return { user: session.data.user };
  },
  component: DashboardLayout,
});

function DashboardLayout() {
  const { id: organizationId } = Route.useParams();

  const memberContext = useQuery(api.members.queries.getCurrentMemberContext, {
    organizationId,
  });
  const organization = useQuery(api.organizations.queries.getOrganization, {
    id: organizationId,
  });

  if (!memberContext || !organization) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <AdaptiveHeaderProvider>
      <div className="flex flex-col md:flex-row size-full">
        <div className="md:hidden flex items-center gap-2 h-[--nav-size] p-2 bg-background">
          <MobileNavigation
            organizationId={organizationId}
            role={memberContext.role}
          />
          <AdaptiveHeaderSlot />
        </div>

        <div className="hidden md:flex md:flex-[0_0_var(--nav-size)] h-full px-2">
          <Navigation
            organizationId={organizationId}
            role={memberContext.role}
          />
        </div>

        <div className="flex flex-col flex-1 min-h-0 md:border-l border-border bg-background">
          <div className="flex flex-col flex-1 min-h-0 overflow-auto">
            <Outlet />
          </div>
        </div>
      </div>
    </AdaptiveHeaderProvider>
  );
}
