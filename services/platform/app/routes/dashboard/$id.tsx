import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, createFileRoute } from '@tanstack/react-router';
import { useMutation } from 'convex/react';
import { useEffect, useRef } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderSlot,
} from '@/app/components/layout/adaptive-header';
import { Spinner } from '@/app/components/ui/feedback/spinner';
import { FullPageCenter } from '@/app/components/ui/layout/full-page-center';
import { VStack } from '@/app/components/ui/layout/layout';
import { MobileNavigation } from '@/app/components/ui/navigation/mobile-navigation';
import { Navigation } from '@/app/components/ui/navigation/navigation';
import { Text } from '@/app/components/ui/typography/text';
import {
  AbilityContext,
  AbilityLoadingContext,
} from '@/app/context/ability-context';
import { TwoFactorGraceBanner } from '@/app/features/auth/components/two-factor-grace-banner';
import { TwoFactorLowBackupCodesBanner } from '@/app/features/auth/components/two-factor-low-backup-codes-banner';
import { usePasswordExpiryGate } from '@/app/features/auth/hooks/use-password-expiry-gate';
import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { TeamFilterProvider } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { defineAbilityFor, type AppAbility } from '@/lib/permissions/ability';

export const Route = createFileRoute('/dashboard/$id')({
  component: DashboardLayout,
});

function DashboardLayout() {
  const { id: organizationId } = Route.useParams();
  usePasswordExpiryGate(organizationId);
  const { isLoading: isAuthLoading } = useConvexAuth();
  const {
    data: memberContext,
    isLoading: isQueryLoading,
    isError,
  } = useCurrentMemberContext(organizationId, isAuthLoading);
  const { t } = useT('accessDenied');
  const { t: tNotFound } = useT('common');
  const { t: tSettings } = useT('settings');

  // Session-active-org guard: if the session's activeOrganizationId doesn't
  // match the route, silently sync it to the route (user is already verified
  // as a member via useCurrentMemberContext above). This keeps routes,
  // queries, and Better Auth aligned without bouncing the user through the
  // picker. Audit-log the entry so it's captured even for deep-link arrivals.
  const queryClient = useQueryClient();
  const recordOrgSwitch = useMutation(
    api.organizations.record_org_switch.recordOrgSwitch,
  );
  const { data: session } = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: () => authClient.getSession(),
    staleTime: 5 * 60 * 1000,
  });
  const activeOrganizationId = session?.data?.session?.activeOrganizationId;
  const orgSyncRef = useRef<string | null>(null);
  useEffect(() => {
    if (memberContext?.status !== 'ok') return;
    if (!activeOrganizationId) return;
    if (activeOrganizationId === organizationId) return;
    // Prevent re-running for the same mismatch after a completed sync.
    if (orgSyncRef.current === organizationId) return;
    orgSyncRef.current = organizationId;
    void (async () => {
      try {
        await authClient.organization.setActive({ organizationId });
        await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
        await recordOrgSwitch({ organizationId });
      } catch (err) {
        console.warn('Failed to sync active organization:', err);
        orgSyncRef.current = null;
      }
    })();
  }, [
    activeOrganizationId,
    organizationId,
    memberContext?.status,
    queryClient,
    recordOrgSwitch,
  ]);

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

  // "Switching" state: the route changed but the session/member-context is
  // still catching up. Without this, the previous org's cached Outlet would
  // flash briefly during a switch. Render the skeleton until the resolved
  // member context points at the route's org.
  const isSwitching =
    !isLoading &&
    memberContext?.status === 'ok' &&
    !!activeOrganizationId &&
    activeOrganizationId !== organizationId;

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

              <main
                id="main-content"
                className="border-border bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:border-l"
              >
                {hasRole && (
                  <TwoFactorGraceBanner organizationId={organizationId} />
                )}
                {hasRole && (
                  <TwoFactorLowBackupCodesBanner
                    organizationId={organizationId}
                  />
                )}
                {isSwitching ? (
                  <FullPageCenter>
                    <VStack gap={3} align="center">
                      <Spinner
                        size="lg"
                        label={tSettings('organization.switchingLabel')}
                      />
                      <Text variant="muted" className="text-sm">
                        {tSettings('organization.switching')}
                      </Text>
                    </VStack>
                  </FullPageCenter>
                ) : hasRole || isLoading ? (
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
              </main>
            </div>
          </AdaptiveHeaderProvider>
        </TeamFilterProvider>
      </AbilityLoadingContext.Provider>
    </AbilityContext.Provider>
  );
}
