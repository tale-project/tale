import { Outlet, createFileRoute } from '@tanstack/react-router';

import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderSlot,
} from '@/app/components/layout/adaptive-header';
import { MobileNavigation } from '@/app/components/ui/navigation/mobile-navigation';
import { Navigation } from '@/app/components/ui/navigation/navigation';
import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { TeamFilterProvider } from '@/app/hooks/use-team-filter';

export const Route = createFileRoute('/dashboard/$id')({
  component: DashboardLayout,
});

function DashboardLayout() {
  const { id: organizationId } = Route.useParams();
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();

  const { data: memberContext } = useCurrentMemberContext(
    organizationId,
    isAuthLoading || !isAuthenticated,
  );

  return (
    <TeamFilterProvider organizationId={organizationId}>
      <AdaptiveHeaderProvider>
        <div className="flex size-full flex-col overflow-hidden md:flex-row">
          <div className="bg-background flex h-[--nav-size] items-center gap-2 p-2 md:hidden">
            <MobileNavigation
              organizationId={organizationId}
              role={memberContext?.role}
            />
            <AdaptiveHeaderSlot />
          </div>

          <div className="hidden h-full px-2 md:flex md:flex-[0_0_var(--nav-size)]">
            <Navigation
              organizationId={organizationId}
              role={memberContext?.role}
            />
          </div>

          <div className="border-border bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:border-l">
            {isAuthLoading ? null : <Outlet />}
          </div>
        </div>
      </AdaptiveHeaderProvider>
    </TeamFilterProvider>
  );
}
