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
import { AbilityContext } from '@/app/context/ability-context';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { TeamFilterProvider } from '@/app/hooks/use-team-filter';
import { api } from '@/convex/_generated/api';
import { defineAbilityFor, type AppAbility } from '@/lib/permissions/ability';

export const Route = createFileRoute('/dashboard/$id')({
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      convexQuery(api.members.queries.getCurrentMemberContext, {
        organizationId: params.id,
      }),
    );
  },
  component: DashboardLayout,
});

function DashboardLayout() {
  const { id: organizationId } = Route.useParams();

  const { data: memberContext } = useCurrentMemberContext(organizationId);

  const abilityRef = useRef<AppAbility>(defineAbilityFor(memberContext?.role));
  const lastRoleRef = useRef<string | undefined>(memberContext?.role);

  if (
    memberContext &&
    memberContext.role !== undefined &&
    memberContext.role !== lastRoleRef.current
  ) {
    lastRoleRef.current = memberContext.role;
    abilityRef.current = defineAbilityFor(memberContext.role);
  }

  return (
    <AbilityContext.Provider value={abilityRef.current}>
      <BrandingProvider organizationId={organizationId}>
        <TeamFilterProvider organizationId={organizationId}>
          <AdaptiveHeaderProvider>
            <div className="flex size-full flex-col overflow-hidden md:flex-row">
              <div className="bg-background flex h-[--nav-size] items-center gap-2 p-2 md:hidden">
                <MobileNavigation organizationId={organizationId} />
                <AdaptiveHeaderSlot />
              </div>

              <div className="hidden h-full px-2 md:flex md:flex-[0_0_var(--nav-size)]">
                <Navigation organizationId={organizationId} />
              </div>

              <div className="border-border bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:border-l">
                <Outlet />
              </div>
            </div>
          </AdaptiveHeaderProvider>
        </TeamFilterProvider>
      </BrandingProvider>
    </AbilityContext.Provider>
  );
}
