import { Outlet, createFileRoute } from '@tanstack/react-router';
import { useQuery, useConvexAuth } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Navigation } from '@/app/components/ui/navigation/navigation';
import { MobileNavigation } from '@/app/components/ui/navigation/mobile-navigation';
import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderSlot,
} from '@/app/components/layout/adaptive-header';

export const Route = createFileRoute('/dashboard/$id')({
  component: DashboardLayout,
});

function DashboardLayout() {
  const { id: organizationId } = Route.useParams();
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();

  const memberContext = useQuery(
    api.members.queries.getCurrentMemberContext,
    isAuthLoading || !isAuthenticated ? 'skip' : { organizationId },
  );

  return (
    <AdaptiveHeaderProvider>
      <div className="flex flex-col md:flex-row size-full overflow-hidden">
        <div className="md:hidden flex items-center gap-2 h-[--nav-size] p-2 bg-background">
          <MobileNavigation
            organizationId={organizationId}
            role={memberContext?.role}
          />
          <AdaptiveHeaderSlot />
        </div>

        <div className="hidden md:flex md:flex-[0_0_var(--nav-size)] h-full px-2">
          <Navigation
            organizationId={organizationId}
            role={memberContext?.role}
          />
        </div>

        <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden md:border-l border-border bg-background">
          {isAuthLoading ? null : <Outlet />}
        </div>
      </div>
    </AdaptiveHeaderProvider>
  );
}
