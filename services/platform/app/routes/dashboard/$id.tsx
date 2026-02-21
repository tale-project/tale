import { convexQuery } from '@convex-dev/react-query';
import { Outlet, createFileRoute } from '@tanstack/react-router';
import { useRef } from 'react';

import { BrandingProvider } from '@/app/components/branding/branding-provider';
import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderSlot,
} from '@/app/components/layout/adaptive-header';
import { MobileNavigation } from '@/app/components/ui/navigation/mobile-navigation';
import { Navigation } from '@/app/components/ui/navigation/navigation';
import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { TeamFilterProvider } from '@/app/hooks/use-team-filter';
import { api } from '@/convex/_generated/api';

export const Route = createFileRoute('/dashboard/$id')({
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.members.queries.getCurrentMemberContext, {
        organizationId: params.id,
      }),
    );
  },
  component: DashboardLayout,
});

function DashboardLayout() {
  const { id: organizationId } = Route.useParams();
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();

  const { data: memberContext } = useCurrentMemberContext(
    organizationId,
    isAuthLoading || !isAuthenticated,
  );

  // Preserve the last known role across auth token refreshes / WebSocket reconnections.
  // When convexQuery args change to 'skip', the queryKey changes and data becomes undefined,
  // which would cause role-gated nav items to briefly disappear.
  const roleRef = useRef(memberContext?.role);
  if (memberContext?.role) {
    roleRef.current = memberContext.role;
  }

  return (
    <BrandingProvider
      organizationId={organizationId}
      skip={isAuthLoading || !isAuthenticated}
    >
      <TeamFilterProvider organizationId={organizationId}>
        <AdaptiveHeaderProvider>
          <div className="flex size-full flex-col overflow-hidden md:flex-row">
            <div className="bg-background flex h-[--nav-size] items-center gap-2 p-2 md:hidden">
              <MobileNavigation
                organizationId={organizationId}
                role={roleRef.current}
              />
              <AdaptiveHeaderSlot />
            </div>

            <div className="hidden h-full px-2 md:flex md:flex-[0_0_var(--nav-size)]">
              <Navigation
                organizationId={organizationId}
                role={roleRef.current}
              />
            </div>

            <div className="border-border bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:border-l">
              {isAuthLoading ? null : <Outlet />}
            </div>
          </div>
        </AdaptiveHeaderProvider>
      </TeamFilterProvider>
    </BrandingProvider>
  );
}
