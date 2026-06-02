import { FullPageCenter } from '@tale/ui/full-page-center';
import { VStack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonCircle } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation } from 'convex/react';
import { useEffect, useRef } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderSlot,
} from '@/app/components/layout/adaptive-header';
import { MobileBackButton } from '@/app/components/layout/mobile-back-button';
import { MobileBottomNav } from '@/app/components/layout/mobile-bottom-nav';
import { DirtyBlockerProvider } from '@/app/components/ui/editor';
import { Navigation } from '@/app/components/ui/navigation/navigation';
import { UserButton } from '@/app/components/user-button';
import {
  AbilityContext,
  AbilityLoadingContext,
} from '@/app/context/ability-context';
import { TwoFactorGraceBanner } from '@/app/features/auth/components/two-factor-grace-banner';
import { TwoFactorLowBackupCodesBanner } from '@/app/features/auth/components/two-factor-low-backup-codes-banner';
import { usePasswordExpiryGate } from '@/app/features/auth/hooks/use-password-expiry-gate';
import { ChangelogToastTrigger } from '@/app/features/changelog/components/changelog-toast-trigger';
import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { TeamFilterProvider } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { ensureConvexQuery } from '@/app/lib/loader-preload';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { defineAbilityFor, type AppAbility } from '@/lib/permissions/ability';

export const Route = createFileRoute('/dashboard/$id')({
  // Warm the membership/ability context before the layout renders so children
  // mount with access resolved (no shell-skeleton flash on warm org entry).
  // The component's gating logic surfaces denied/not-found states, so an
  // access error here must not fail the transition. Cap the wait at 2s so a
  // slow membership round-trip (e.g. during an org switch) can't hang the
  // transition — the component renders a skeleton while the live subscription
  // catches up.
  loader: ({ context, params }) => {
    const preload = ensureConvexQuery(
      context,
      api.members.queries.getCurrentMemberContext,
      { organizationId: params.id },
    ).catch((error: unknown) => {
      console.warn('Failed to preload member context', error);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 2000);
    });
    return Promise.race([preload, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  },
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
        // Audit + preference persistence is off the critical path — fire in the
        // background so the guard doesn't block on it. Errors are logged.
        void recordOrgSwitch({ organizationId }).catch((err) => {
          console.warn('Failed to record org switch audit entry:', err);
        });
        await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
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

  // Bounce away from a deleted-org URL. Handles cross-tab live deletion (tab A
  // deletes the org; tab B's getCurrentMemberContext subscription pushes
  // 'not_found' via Convex reactivity), bookmarks/history into deleted orgs,
  // and racy fallthrough during deletion. /dashboard/ index has fallback logic
  // (persistedStillMember) that prevents looping back to the deleted org.
  // 'not_member' intentionally not redirected — preserve the AccessDenied
  // "you've been removed" message; the early-bailout below already prevents
  // its layout-chrome subscription leak.
  const navigate = useNavigate();
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (status === 'not_found' && !redirectedRef.current) {
      redirectedRef.current = true;
      void navigate({ to: '/dashboard', replace: true });
    }
  }, [status, navigate]);

  // Access resolved but denied → full-page message. Don't mount layout chrome
  // that would leak Convex subscriptions.
  if (!hasRole && memberContext && status !== 'ok') {
    return (
      <FullPageCenter>
        {status === 'not_found' ? (
          <AccessDenied
            title={tNotFound('notFound.title')}
            message={t('workspaceNotFound')}
          />
        ) : (
          <AccessDenied message={t(isDisabled ? 'disabled' : 'noMembership')} />
        )}
      </FullPageCenter>
    );
  }

  // One real shell. The static frame renders immediately; the access-dependent
  // regions (side nav, mobile nav, banners, Outlet) each gate on `hasRole`
  // individually so they load in independently once access resolves. Until
  // then we must NOT mount the Convex-subscribing children — chat/agents/… use
  // convex/react's useQuery, which *throws* UnauthorizedError on mount — so
  // each region shows a masked placeholder in place of its real component.
  return (
    <AbilityContext.Provider value={ability}>
      <AbilityLoadingContext.Provider value={isLoading}>
        <TeamFilterProvider organizationId={organizationId}>
          <DirtyBlockerProvider>
            <AdaptiveHeaderProvider>
              <div className="flex h-full w-full flex-col overflow-hidden md:flex-row">
                <header className="bg-background border-border flex items-center gap-2 border-b px-4 pt-(--safe-top) pb-2 md:hidden">
                  <MobileBackButton organizationId={organizationId} />
                  <div className="min-w-0 flex-1">
                    <AdaptiveHeaderSlot />
                  </div>
                  <UserButton align="end" />
                </header>

                <div className="bg-background hidden h-full px-2 md:flex md:flex-[0_0_var(--nav-size)]">
                  {hasRole ? (
                    <Navigation organizationId={organizationId} />
                  ) : (
                    <NavRailPlaceholder />
                  )}
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
                  {hasRole && <ChangelogToastTrigger />}
                  {hasRole ? (
                    isSwitching ? (
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
                    ) : (
                      <Outlet />
                    )
                  ) : null}
                </main>
                {hasRole && <MobileBottomNav organizationId={organizationId} />}
              </div>
            </AdaptiveHeaderProvider>
          </DirtyBlockerProvider>
        </TeamFilterProvider>
      </AbilityLoadingContext.Provider>
    </AbilityContext.Provider>
  );
}

// Masked desktop side-nav rail shown while access resolves (the CASL-gated item
// count isn't known yet, so the middle is an empty spacer). Mirrors the real
// Navigation rail geometry so it slots in without reflow.
function NavRailPlaceholder() {
  return (
    <Skeletonize loading>
      <div className="border-border flex h-full flex-col">
        <div className="flex flex-shrink-0 items-center justify-center py-3">
          <SkeletonBox>
            <div className="size-8" />
          </SkeletonBox>
        </div>
        <div className="mx-1 min-h-0 flex-1 overflow-y-auto py-4" />
        <div className="flex flex-shrink-0 flex-col items-center gap-2 py-3">
          <SkeletonCircle>
            <div className="size-9" />
          </SkeletonCircle>
          <SkeletonCircle>
            <div className="size-9" />
          </SkeletonCircle>
          <SkeletonCircle>
            <div className="size-9" />
          </SkeletonCircle>
        </div>
      </div>
    </Skeletonize>
  );
}

// Full-frame dashboard chrome for the redirect routes (`/dashboard`,
// `/dashboard/create-organization`) that have no Outlet/nav of their own and
// just need the shell to show while they resolve which org to route to.
// Mirrors the resolved layout's outer frame so the real chrome slots in without
// reflow.
export function DashboardShellFrame() {
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden md:flex-row">
      {/* Mobile top bar */}
      <div className="bg-background border-border flex items-center gap-2 border-b p-2 pt-[calc(var(--safe-top)+0.75rem)] md:hidden">
        <Skeletonize loading>
          <SkeletonBox>
            <div className="size-8" />
          </SkeletonBox>
          <SkeletonBox>
            <div className="h-4 w-32" />
          </SkeletonBox>
        </Skeletonize>
      </div>

      {/* Desktop side nav */}
      <div className="bg-background hidden h-full px-2 md:flex md:flex-[0_0_var(--nav-size)]">
        <NavRailPlaceholder />
      </div>

      <main className="border-border bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:border-l" />

      {/* Mobile bottom-nav placeholder */}
      <div className="bg-background border-border flex min-h-12 border-t pb-(--safe-bottom) md:hidden" />
    </div>
  );
}
