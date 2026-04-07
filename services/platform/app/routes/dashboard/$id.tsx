import { Outlet, createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderSlot,
} from '@/app/components/layout/adaptive-header';
import { MobileNavigation } from '@/app/components/ui/navigation/mobile-navigation';
import { Navigation } from '@/app/components/ui/navigation/navigation';
import {
  AbilityContext,
  AbilityLoadingContext,
} from '@/app/context/ability-context';
import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { TeamFilterProvider } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { defineAbilityFor, type AppAbility } from '@/lib/permissions/ability';

export const Route = createFileRoute('/dashboard/$id')({
  component: DashboardLayout,
});

function DashboardLayout() {
  const { id: organizationId } = Route.useParams();
  const { isLoading: isAuthLoading } = useConvexAuth();
  const {
    data: memberContext,
    isLoading: isQueryLoading,
    isError,
  } = useCurrentMemberContext(organizationId, isAuthLoading);
  const { t } = useT('accessDenied');
  const { t: tNotFound } = useT('common');

  const abilityRef = useRef<{ role: string | null; ability: AppAbility }>(null);

  const status = memberContext?.status;
  const currentRole =
    memberContext?.status === 'ok' ? memberContext.role : null;

  if (!abilityRef.current || abilityRef.current.role !== currentRole) {
    abilityRef.current = {
      role: currentRole,
      ability: defineAbilityFor(currentRole),
    };
  }

  const { role, ability } = abilityRef.current;
  const isDisabled = role === 'disabled';
  const hasRole = role !== null && !isDisabled;
  const isLoading = isAuthLoading || isQueryLoading || isError;

  useEffect(() => {
    if (isDisabled) {
      toast({
        title: t('disabled'),
        variant: 'destructive',
      });
    }
  }, [isDisabled, t]);

  return (
    <AbilityContext.Provider value={ability}>
      <AbilityLoadingContext.Provider value={isLoading}>
        <TeamFilterProvider organizationId={organizationId}>
          <AdaptiveHeaderProvider>
            <div className="flex size-full flex-col overflow-hidden md:flex-row">
              <div className="bg-sidebar flex h-[--nav-size] items-center gap-2 p-2 md:hidden">
                <MobileNavigation organizationId={organizationId} />
                <AdaptiveHeaderSlot />
              </div>

              <div className="bg-sidebar hidden h-full px-2 md:flex md:flex-[0_0_var(--nav-size)]">
                <Navigation organizationId={organizationId} />
              </div>

              <div className="border-border bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:border-l">
                {hasRole || isLoading ? (
                  <Outlet />
                ) : status === 'not_found' ? (
                  <AccessDenied
                    title={tNotFound('notFound.title')}
                    message={t('workspaceNotFound')}
                  />
                ) : (
                  <AccessDenied
                    message={t(isDisabled ? 'disabled' : 'noMembership')}
                  />
                )}
              </div>
            </div>
          </AdaptiveHeaderProvider>
        </TeamFilterProvider>
      </AbilityLoadingContext.Provider>
    </AbilityContext.Provider>
  );
}
