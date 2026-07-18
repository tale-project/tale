import { convexQuery } from '@convex-dev/react-query';
import { FullPageCenter } from '@tale/ui/full-page-center';
import { Row, Stack, VStack } from '@tale/ui/layout';
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
import { AppSidebar } from '@/app/components/layout/app-sidebar/app-sidebar';
import { AppSidebarPlaceholder } from '@/app/components/layout/app-sidebar/app-sidebar-placeholder';
import { SidebarProvider } from '@/app/components/layout/app-sidebar/sidebar-context';
import { MobileBottomNav } from '@/app/components/layout/mobile-bottom-nav';
import { DirtyBlockerProvider } from '@/app/components/ui/editor';
import { UserButton } from '@/app/components/user-button';
import {
  AbilityContext,
  AbilityLoadingContext,
} from '@/app/context/ability-context';
import { TwoFactorGraceBanner } from '@/app/features/auth/components/two-factor-grace-banner';
import { TwoFactorLowBackupCodesBanner } from '@/app/features/auth/components/two-factor-low-backup-codes-banner';
import { usePasswordExpiryGate } from '@/app/features/auth/hooks/use-password-expiry-gate';
import { ChangelogToastTrigger } from '@/app/features/changelog/components/changelog-toast-trigger';
import { ProvisioningBanner } from '@/app/features/organization/components/provisioning-banner';
import { configKeys } from '@/app/hooks/config-query-keys';
import { ClockOffsetProvider } from '@/app/hooks/use-clock-offset';
import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { TeamFilterProvider } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { setActiveOrganizationId } from '@/app/lib/active-organization';
import { getCachedConvexTokenUserId } from '@/app/lib/auth/convex-token-cache';
import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import { ensureConvexQuery } from '@/app/lib/loader-preload';
import {
  cacheMemberContext,
  clearMemberContextCache,
  readCachedMemberContextRole,
} from '@/app/lib/member-context-cache';
import { markColdLoad } from '@/app/lib/perf/cold-load-trace';
import type { RouterContext } from '@/app/router';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { defineAbilityFor, type AppAbility } from '@/lib/permissions/ability';
// Fire-and-forget warm of an action-backed config catalog into the SAME
// TanStack Query cache entry the `useActionQuery` hooks read (matching key +
// `staleTime: Infinity` + the `action(args)` queryFn), so the catalog loads
// DURING the auth/WS handshake instead of after the consuming component mounts.
// On mount the hook reads the warm cache and skips its own fetch; the result
// shape, key, and access checks are identical to the hook's path, so behavior
// is unchanged — this only moves the request earlier. Never awaited so a slow
// catalog can't stall the navigation, and `.catch` keeps a transient/auth
// failure from surfacing as an unhandled rejection (the hook refetches on
// mount as before in that case).
function prewarmConfigCatalog(
  context: RouterContext,
  queryKey: readonly unknown[],
  organizationId: string,
  action:
    | typeof api.agents.file_actions.listAgents
    | typeof api.providers.file_actions.listProviders,
): void {
  // `fetchQuery` (not `prefetchQuery`) so a failure reaches our `.catch` and is
  // logged rather than silently swallowed — `prefetchQuery` does `.catch(noop)`
  // internally. It populates the exact same cache entry either way.
  void context.queryClient
    .fetchQuery({
      queryKey,
      queryFn: () =>
        context.convexQueryClient.convexClient.action(action, {
          organizationId,
        }),
      staleTime: Infinity,
    })
    .catch((error: unknown) => {
      console.warn('Failed to prewarm config catalog', error);
    });
}

export const Route = createFileRoute('/dashboard/$id')({
  // Warm the membership/ability context and team filter, but DO NOT block the
  // transition on them. The layout shell + side-nav rail paint immediately
  // (NavRailPlaceholder) and the live getCurrentMemberContext subscription
  // upgrades the rail to the real Navigation the moment access resolves — so
  // the sidebar loads independently of the page content instead of the whole
  // shell waiting on a (potentially slow) membership round-trip. On warm entry
  // the prefetched cache resolves synchronously on first render, so there's no
  // placeholder flash; on cold entry the rail's masked placeholder stands in
  // while access catches up. The component's gating logic surfaces
  // denied/not-found states, so an access error here is non-fatal.
  loader: ({ context, params }) => {
    // The team filter (TeamFilterProvider) reads getMyTeams on every dashboard
    // page; warm it alongside the gating member context.
    void context.queryClient.prefetchQuery(
      convexQuery(api.members.queries.getMyTeams, {
        organizationId: params.id,
      }),
    );
    void ensureConvexQuery(
      context,
      api.members.queries.getCurrentMemberContext,
      { organizationId: params.id },
    ).catch((error: unknown) => {
      console.warn('Failed to preload member context', error);
    });
    // NOTE: the chat agent/provider catalog prewarm is intentionally NOT done
    // here. Firing it in the loader raced the WS auth handshake, so on every
    // cold load the action ran unauthenticated → `UNAUTHENTICATED` (logged by
    // the Convex client) + a failed/wasted query. It now runs in DashboardLayout
    // gated on `isAuthenticated` (see the effect there), which still warms the
    // cache before the chat composer mounts but never before auth is ready.
  },
  component: DashboardLayout,
});

function DashboardLayout() {
  const { id: organizationId } = Route.useParams();
  usePasswordExpiryGate(organizationId);

  // Theme the app to this org's branding. BrandingProvider sits above the
  // router (it themes the pre-auth shell too) and can't read this route param
  // directly, so publish it to the active-org store it subscribes to. Reset on
  // unmount so leaving the dashboard reverts to the platform-default branding.
  useEffect(() => {
    setActiveOrganizationId(organizationId);
    return () => setActiveOrganizationId(undefined);
  }, [organizationId]);
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  // Warm the chat composer's agent + provider catalogs ONCE auth is ready (the
  // chat page is the dashboard's default landing). Done here rather than in the
  // route loader because the loader raced the WS auth handshake — the catalog
  // actions ran unauthenticated and failed on every cold load. DashboardLayout
  // is the parent of the chat route, so this still populates the cache before
  // the composer mounts; on a warm navigation `isAuthenticated` is already true
  // so it fires immediately. Once per org.
  const routeContext = Route.useRouteContext();
  const catalogPrewarmedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isAuthenticated) return;
    if (catalogPrewarmedRef.current === organizationId) return;
    catalogPrewarmedRef.current = organizationId;
    prewarmConfigCatalog(
      routeContext,
      configKeys.list('agents', organizationId),
      organizationId,
      api.agents.file_actions.listAgents,
    );
    prewarmConfigCatalog(
      routeContext,
      configKeys.list('providers', organizationId),
      organizationId,
      api.providers.file_actions.listProviders,
    );
  }, [isAuthenticated, organizationId, routeContext]);
  const {
    data: memberContext,
    isLoading: isQueryLoading,
    isError,
  } = useCurrentMemberContext(organizationId, isAuthLoading);
  useEffect(() => {
    if (memberContext) markColdLoad('member-context');
  }, [memberContext]);
  // Persist the resolved shell identity so the NEXT load of this dashboard can
  // hydrate the nav shell instantly (member-context-cache, epic #2386). A
  // not-ok result clears the hint so it can never outlive a removal.
  useEffect(() => {
    if (!memberContext) return;
    if (memberContext.status === 'ok') {
      cacheMemberContext({
        userId: memberContext.userId,
        organizationId: memberContext.organizationId,
        role: memberContext.role,
      });
    } else {
      clearMemberContextCache();
    }
  }, [memberContext]);
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
  const { data: session } = useQuery(sessionQueryOptions);
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
  const resolvedRole =
    memberContext?.status === 'ok' ? memberContext.role : null;
  // Instant shell hydration (epic #2386): while the live member context is
  // still resolving on a fresh load, fall back to the persisted last-known
  // role — only once the websocket is backend-authenticated (so everything the
  // hydrated shell mounts fires authorized queries) and only when the cached
  // record matches this exact user + org (the read rejects everything else;
  // the identity hint is the resolved session's user, or before it resolves,
  // the user the pre-auth token authenticated as). The live subscription
  // confirms or corrects the shell within one round trip.
  const shellUserId = session?.data?.user?.id ?? getCachedConvexTokenUserId();
  const persistedRole =
    isAuthenticated && memberContext === undefined && shellUserId
      ? readCachedMemberContextRole(shellUserId, organizationId)
      : null;
  // Keep the last known role while the membership query refetches after a cache
  // invalidation — otherwise hasRole drops to false for a frame and the rail
  // swaps Navigation ↔ NavRailPlaceholder (visible flash on every click).
  const currentRole =
    resolvedRole ??
    (isQueryLoading &&
    memberContext === undefined &&
    abilityRef.current?.role != null
      ? abilityRef.current.role
      : persistedRole);

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
              <SidebarProvider organizationId={organizationId}>
                {/* Learns the client↔server clock offset from getThreadMeta.serverNow
                  so the sidebar's chat-history relative times and the chat
                  interface's timers share one clock frame on every route. */}
                <ClockOffsetProvider>
                  {/* Shell alerts sit above nav + main so page headers (chat toolbar,
                  AdaptiveHeader, etc.) stay flush with the rail — nesting them
                  inside #main-content pushed those headers down and looked broken. */}
                  <div className="flex h-full w-full flex-col overflow-hidden">
                    {hasRole && (
                      <TwoFactorGraceBanner organizationId={organizationId} />
                    )}
                    {hasRole && (
                      <TwoFactorLowBackupCodesBanner
                        organizationId={organizationId}
                      />
                    )}
                    {hasRole && (
                      <ProvisioningBanner organizationId={organizationId} />
                    )}
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
                      {/* Safe-area inset clears the notch; the inner fixed-height row
                      vertically centers the title and profile button so neither
                      sits high/low in the bar on notch devices. */}
                      <header className="bg-background border-border border-b px-4 pt-(--safe-top) md:hidden">
                        <Row gap={2} className="min-h-12">
                          <div className="min-w-0 flex-1">
                            <AdaptiveHeaderSlot />
                          </div>
                          <UserButton align="end" />
                        </Row>
                      </header>

                      {hasRole ? (
                        <AppSidebar organizationId={organizationId} />
                      ) : (
                        <AppSidebarPlaceholder
                          organizationId={organizationId}
                        />
                      )}

                      <Stack
                        id="main-content"
                        as="main"
                        tabIndex={-1}
                        gap={0}
                        className="border-border bg-background min-h-0 min-w-0 flex-1 overflow-hidden md:border-l"
                      >
                        {hasRole && <ChangelogToastTrigger />}
                        {hasRole ? (
                          isSwitching ? (
                            <FullPageCenter>
                              <VStack gap={3} align="center">
                                <Spinner
                                  size="lg"
                                  label={tSettings(
                                    'organization.switchingLabel',
                                  )}
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
                      </Stack>
                      {hasRole && (
                        <MobileBottomNav organizationId={organizationId} />
                      )}
                    </div>
                  </div>
                </ClockOffsetProvider>
              </SidebarProvider>
            </AdaptiveHeaderProvider>
          </DirtyBlockerProvider>
        </TeamFilterProvider>
      </AbilityLoadingContext.Provider>
    </AbilityContext.Provider>
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
      {/* Mobile top bar — mirrors the resolved chat header (the default
          landing): a leading cluster of action icons + the trailing account
          avatar, so the real header slots in without reflow. Matches the
          DashboardLayout header geometry above (px-4, min-h-12). */}
      <div className="bg-background border-border border-b px-4 pt-(--safe-top) md:hidden">
        <Skeletonize loading>
          <Row gap={2} className="min-h-12">
            {/* Leading action icons (sidebar menu / search). */}
            <Row gap={0} align="stretch" className="flex-1">
              {Array.from({ length: 2 }, (_, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <Row key={i} gap={0} justify="center" className="p-2">
                  <SkeletonBox>
                    <div className="size-5" />
                  </SkeletonBox>
                </Row>
              ))}
            </Row>
            {/* Trailing account avatar (UserButton). */}
            <Row gap={0} justify="center" className="p-2">
              <SkeletonCircle>
                <div className="size-5" />
              </SkeletonCircle>
            </Row>
          </Row>
        </Skeletonize>
      </div>

      {/* Desktop sidebar */}
      <AppSidebarPlaceholder />

      <Stack
        as="main"
        gap={0}
        className="border-border bg-background min-h-0 min-w-0 flex-1 overflow-hidden md:border-l"
      />

      {/* Mobile bottom-nav placeholder */}
      <Row
        gap={0}
        align="stretch"
        className="bg-background border-border min-h-12 border-t pb-(--safe-bottom) md:hidden"
      />
    </div>
  );
}
