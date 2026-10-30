import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderSlot,
} from '@tale/ui/adaptive-header';
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { DirtyBlockerProvider } from '@tale/ui/editor';
import { ErrorScopeProvider } from '@tale/ui/error-boundaries/error-scope';
import { FullPageCenter } from '@tale/ui/full-page-center';
import { Row, Stack, VStack } from '@tale/ui/layout';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { useIsMobile } from '@tale/ui/use-is-mobile';
import { useSwapFade } from '@tale/ui/use-swap-fade';
import { toast } from '@tale/ui/use-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Outlet,
  createFileRoute,
  useLocation,
  useNavigate,
} from '@tanstack/react-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { AccessRefreshNotice } from '@/app/components/layout/access-refresh-notice';
import { AppSidebar } from '@/app/components/layout/app-sidebar/app-sidebar';
import { AppSidebarPlaceholder } from '@/app/components/layout/app-sidebar/app-sidebar-placeholder';
import { SidebarProvider } from '@/app/components/layout/app-sidebar/sidebar-context';
import { ChatComposerPlaceholder } from '@/app/components/layout/chat-composer-placeholder';
import { HomePanelPlaceholder } from '@/app/components/layout/home-panel-placeholder';
import { MobileBottomNav } from '@/app/components/layout/mobile-bottom-nav';
import { MobileBottomNavPlaceholder } from '@/app/components/layout/mobile-bottom-nav-placeholder';
import { ShellMobileHeader } from '@/app/components/layout/shell-mobile-header';
import { ShellNotch } from '@/app/components/layout/shell-notch';
import { SessionLapseNotice } from '@/app/components/session-lapse-recovery';
import { UserButton } from '@/app/components/user-button';
import {
  AbilityContext,
  AbilityLoadingContext,
} from '@/app/context/ability-context';
import { TwoFactorGraceBanner } from '@/app/features/auth/components/two-factor-grace-banner';
import { TwoFactorLowBackupCodesBanner } from '@/app/features/auth/components/two-factor-low-backup-codes-banner';
import { usePasswordExpiryGate } from '@/app/features/auth/hooks/use-password-expiry-gate';
import { ChangelogToastTrigger } from '@/app/features/changelog/components/changelog-toast-trigger';
import { HomePanel } from '@/app/features/home/components/home-panel';
import { HomePanelProvider } from '@/app/features/home/components/home-panel-context';
import {
  hasOwnPhoneHeader,
  isHomePath,
  readHomeLocation,
} from '@/app/features/home/lib/home-paths';
import {
  OrgSwitchFailure,
  type OrgSwitchFailureCause,
} from '@/app/features/organization/components/org-switch-failure';
import { EmbeddingSetupBanner } from '@/app/features/settings/data-residency/components/embedding-setup-banner';
import { ClockOffsetProvider } from '@/app/hooks/use-clock-offset';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useAuth } from '@/app/hooks/use-session-user';
import { useSignInAgain } from '@/app/hooks/use-sign-in-again';
import { setActiveOrganizationId } from '@/app/lib/active-organization';
import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import {
  ORG_SWITCH_TIMEOUT_MS,
  setActiveOrganization,
} from '@/app/lib/auth/set-active-organization';
import {
  memberContextQuery,
  myTeamsQuery,
  recordOrgSwitch,
} from '@/app/lib/backend/org';
import { useBackendHints } from '@/app/lib/backend/use-backend-hints';
import {
  cacheMemberContext,
  clearMemberContextCache,
  readCachedMemberContextRole,
} from '@/app/lib/member-context-cache';
import { markColdLoad } from '@/app/lib/perf/cold-load-trace';
import { useT } from '@/lib/i18n/client';
import { defineAbilityFor, type AppAbility } from '@/lib/permissions/ability';

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
    // The account menu's Teams row reads the caller's teams on every
    // dashboard page; warm it alongside the gating member context.
    void context.queryClient.prefetchQuery(myTeamsQuery(params.id));
    void context.queryClient
      .ensureQueryData(memberContextQuery(params.id))
      .catch((error: unknown) => {
        console.warn('Failed to preload member context', error);
      });
  },
  component: DashboardLayout,
});

function DashboardLayout() {
  const { id: organizationId } = Route.useParams();
  usePasswordExpiryGate(organizationId);
  // A chat, a task or an open conversation carries its own header on a
  // phone — back arrow, title, actions — so the shell's bar would only stack
  // an empty row above it.
  const { pathname, search } = useLocation();
  const threadPage = hasOwnPhoneHeader(
    readHomeLocation(pathname, search, organizationId),
  );

  // Theme the app to this org's branding. BrandingProvider sits above the
  // router (it themes the pre-auth shell too) and can't read this route param
  // directly, so publish it to the active-org store it subscribes to. Reset on
  // unmount so leaving the dashboard reverts to the platform-default branding.
  useEffect(() => {
    setActiveOrganizationId(organizationId);
    return () => setActiveOrganizationId(undefined);
  }, [organizationId]);
  // The session probe, not the websocket — the member context and the
  // persisted-role hydration only need to know WHO the caller is.
  const { isLoading: isAuthLoading, isAuthenticated } = useAuth();
  // The org's /events hint stream: invalidates ['backend', orgId, entity]
  // reads when the backend's outbox announces a change (Tier-2 realtime).
  useBackendHints(organizationId);
  const {
    data: memberContext,
    isLoading: isQueryLoading,
    isError,
    isFetching,
    errorUpdateCount,
    refetch,
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
  const { t: tNav } = useT('navigation');

  // Session-active-org guard: if the session's activeOrganizationId doesn't
  // match the route, silently sync it to the route (user is already verified
  // as a member via useCurrentMemberContext above). This keeps routes,
  // queries, and Better Auth aligned without bouncing the user through the
  // picker. Audit-log the entry so it's captured even for deep-link arrivals
  // — once the session switched: a sync the server refuses, or one that gets
  // no answer, records nothing and is shown instead of the spinner below,
  // with Try again and the way back.
  const queryClient = useQueryClient();
  const { data: session } = useQuery(sessionQueryOptions);
  const activeOrganizationId = session?.data?.session?.activeOrganizationId;
  const orgSyncRef = useRef<string | null>(null);
  // Each sync counts; only the latest one reports, so a superseded one never
  // overwrites what the newer one found.
  const orgSyncCountRef = useRef(0);
  const [orgSyncAttempt, setOrgSyncAttempt] = useState(0);
  const [orgSyncFailure, setOrgSyncFailure] = useState<{
    organizationId: string;
    cause: OrgSwitchFailureCause;
  } | null>(null);
  useEffect(() => {
    if (memberContext?.status !== 'ok') return;
    if (!activeOrganizationId) return;
    if (activeOrganizationId === organizationId) return;
    // Prevent re-running for the same mismatch after a completed sync; Try
    // again clears it.
    if (orgSyncRef.current === organizationId) return;
    orgSyncRef.current = organizationId;
    const sync = ++orgSyncCountRef.current;
    void (async () => {
      try {
        await setActiveOrganization(organizationId);
        if (sync === orgSyncCountRef.current) setOrgSyncFailure(null);
        // Audit + preference persistence is off the critical path — fire in the
        // background so the guard doesn't block on it. Errors are logged.
        void recordOrgSwitch(organizationId).catch((err) => {
          console.warn('Failed to record org switch audit entry:', err);
        });
        await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
      } catch (err) {
        // The guard stays: a refusal (a rate limit among them) is not asked
        // again on its own. The page says so instead, with Try again.
        console.warn('Failed to sync active organization:', err);
        if (sync === orgSyncCountRef.current) {
          setOrgSyncFailure({ organizationId, cause: { error: err } });
        }
      }
    })();
  }, [
    activeOrganizationId,
    organizationId,
    memberContext?.status,
    queryClient,
    orgSyncAttempt,
  ]);
  const retryOrgSync = () => {
    orgSyncRef.current = null;
    setOrgSyncFailure(null);
    setOrgSyncAttempt((current) => current + 1);
  };

  const abilityRef = useRef<{ role: string | null; ability: AppAbility }>(null);

  const status = memberContext?.status;
  const resolvedRole =
    memberContext?.status === 'ok' ? memberContext.role : null;
  // Instant shell hydration (epic #2386): while the live member context is
  // still resolving on a fresh load, fall back to the persisted last-known
  // role — only once the session is authenticated (so everything the
  // hydrated shell mounts fires authorized queries) and only when the cached
  // record matches this exact user + org (the read rejects everything else).
  // The live membership query confirms or corrects the shell within one
  // round trip.
  const shellUserId = session?.data?.user?.id ?? null;
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
  const isLoading = isAuthLoading || isQueryLoading;
  // A failed read with nothing cached is the full-page error below. A failed
  // refresh keeps the last answer (react-query keeps `data`), so the role
  // above stands and every page goes on with it, under a notice that offers
  // the retry. Counting this failure as loading held Knowledge and most
  // settings pages on skeletons that nothing lifted until a later read
  // succeeded (#4859).
  const refreshFailed = isError && memberContext != null;
  // A retry that works takes the notice, and the focus on its Try again,
  // away: the page region gets the focus instead of the document body.
  const mainRef = useRef<HTMLDivElement>(null);
  const focusMain = useCallback(() => mainRef.current?.focus(), []);

  // "Switching" state: the route changed but the session/member-context is
  // still catching up. Without this, the previous org's cached Outlet would
  // flash briefly during a switch. Render the skeleton until the resolved
  // member context points at the route's org.
  const isSwitching =
    !isLoading &&
    memberContext?.status === 'ok' &&
    !!activeOrganizationId &&
    activeOrganizationId !== organizationId;
  // A switch that failed, or has not finished by the bound, is said as such
  // in place of the spinner; a late success still lands.
  const switchFailure =
    isSwitching && orgSyncFailure?.organizationId === organizationId
      ? orgSyncFailure.cause
      : null;
  useEffect(() => {
    if (!isSwitching || switchFailure) return undefined;
    const timer = setTimeout(
      () => setOrgSyncFailure({ organizationId, cause: { timedOut: true } }),
      ORG_SWITCH_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [isSwitching, switchFailure, organizationId]);

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
  // its layout-chrome subscription leak. Nor is 'session_restricted': its page
  // says what limits the session and offers to sign in to this workspace.
  const navigate = useNavigate();
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (status === 'not_found' && !redirectedRef.current) {
      redirectedRef.current = true;
      void navigate({ to: '/dashboard', replace: true });
    }
  }, [status, navigate]);

  if (isError && !memberContext) {
    return (
      <FullPageCenter>
        <VStack gap={3}>
          <Alert
            variant="destructive"
            description={tNotFound('errors.errorLoadingPage')}
          />
          <Button variant="secondary" onClick={() => void refetch()}>
            {tNotFound('actions.tryAgain')}
          </Button>
        </VStack>
      </FullPageCenter>
    );
  }

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
        ) : status === 'session_restricted' ? (
          <SessionRestricted />
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
    <ErrorScopeProvider organizationId={organizationId}>
      <AbilityContext.Provider value={ability}>
        <AbilityLoadingContext.Provider value={isLoading}>
          <DirtyBlockerProvider>
            <AdaptiveHeaderProvider>
              <SidebarProvider>
                {/* Learns the client↔server clock offset from getThreadMeta.serverNow
                  so the sidebar's chat-history relative times and the chat
                  interface's timers share one clock frame on every route. */}
                <ClockOffsetProvider>
                  <HomePanelProvider organizationId={organizationId}>
                    {/* Shell alerts sit above nav + main so page headers (chat toolbar,
                  AdaptiveHeader, etc.) stay flush with the rail — nesting them
                  inside #main-content pushed those headers down and looked broken.
                  The notch strip heads the shell, and it alone clears the notch
                  (`layout/shell-notch.tsx`): the alerts, the header and a thread
                  page's own header all start under it. */}
                    <div className="mobile-nav-shell flex h-full w-full flex-col overflow-hidden">
                      <ShellNotch />
                      <SessionLapseNotice />
                      {refreshFailed && (
                        <AccessRefreshNotice
                          retrying={isFetching}
                          onRetry={() => void refetch()}
                          failureKey={errorUpdateCount}
                          onFocusLost={focusMain}
                        />
                      )}
                      {hasRole && (
                        <TwoFactorGraceBanner organizationId={organizationId} />
                      )}
                      {hasRole && (
                        <TwoFactorLowBackupCodesBanner
                          organizationId={organizationId}
                        />
                      )}
                      {hasRole && (
                        <EmbeddingSetupBanner organizationId={organizationId} />
                      )}
                      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
                        {/* The inner fixed-height row vertically centers the
                      title and profile button so neither sits high/low in the
                      bar. */}
                        {!threadPage && (
                          <ShellMobileHeader>
                            <Row gap={2} className="min-h-12">
                              <div className="min-w-0 flex-1">
                                <AdaptiveHeaderSlot />
                              </div>
                              <UserButton align="end" />
                            </Row>
                          </ShellMobileHeader>
                        )}

                        {hasRole ? (
                          <AppSidebar organizationId={organizationId} />
                        ) : (
                          <AppSidebarPlaceholder />
                        )}

                        <Stack
                          ref={mainRef}
                          id="main-content"
                          as="main"
                          tabIndex={-1}
                          gap={0}
                          // outline-none: as the skip-link target this region is
                          // focused programmatically (tabIndex -1, never in the
                          // tab order), so the browser's focus-visible ring would
                          // outline the whole content area without conveying
                          // anything actionable.
                          className="border-border bg-background min-h-0 min-w-0 flex-1 overflow-hidden outline-none md:border-l"
                        >
                          {hasRole && <ChangelogToastTrigger />}
                          {!hasRole && (
                            // While access resolves, hold the Home layout's
                            // slots (CSS-gated to Home and chat navigations)
                            // — the Home panel and a chat's composer at the
                            // column's foot — so the real page slots in
                            // without a late pop. Mirrors the boot shell's
                            // frame exactly.
                            <div className="flex min-h-0 flex-1 flex-row">
                              <HomePanelPlaceholder />
                              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                                <ChatComposerPlaceholder />
                              </div>
                            </div>
                          )}
                          {hasRole ? (
                            switchFailure ? (
                              <OrgSwitchFailure
                                organizationId={organizationId}
                                activeOrganizationId={activeOrganizationId}
                                cause={switchFailure}
                                onRetry={retryOrgSync}
                              />
                            ) : isSwitching ? (
                              <FullPageCenter>
                                <VStack gap={3} align="center">
                                  <Spinner
                                    size="lg"
                                    label={tNav('orgSwitcher.switchingLabel')}
                                  />
                                  <Text variant="muted" className="text-sm">
                                    {tNav('orgSwitcher.switching')}
                                  </Text>
                                </VStack>
                              </FullPageCenter>
                            ) : (
                              <HomeSectionFrame organizationId={organizationId}>
                                <Outlet />
                              </HomeSectionFrame>
                            )
                          ) : null}
                        </Stack>
                        {hasRole ? (
                          <MobileBottomNav organizationId={organizationId} />
                        ) : (
                          // The boot and resolving shells share the live capsule's
                          // geometry and CSS clearance before navigation mounts.
                          <MobileBottomNavPlaceholder />
                        )}
                      </div>
                    </div>
                  </HomePanelProvider>
                </ClockOffsetProvider>
              </SidebarProvider>
            </AdaptiveHeaderProvider>
          </DirtyBlockerProvider>
        </AbilityLoadingContext.Provider>
      </AbilityContext.Provider>
    </ErrorScopeProvider>
  );
}

/**
 * A session single sign-on or an authenticating proxy bound to another
 * organization, opened on this one. The person may well be a member here, so
 * the page names the session as what stops them, not their membership, and
 * offers to sign in to this workspace: sign-in brings them back to this page.
 */
function SessionRestricted() {
  const { t } = useT('accessDenied');
  const { t: tCommon } = useT('common');
  const { offered, leaving, signInAgain } = useSignInAgain();
  return (
    <AccessDenied
      message={tCommon('errors.organizationSessionRestricted')}
      action={
        offered && (
          <Button isLoading={leaving} onClick={() => void signInAgain()}>
            {t('signInToWorkspace')}
          </Button>
        )
      }
    />
  );
}

/**
 * The Home section's frame: on every Home route (chats, tasks, projects, the
 * inbox) the Home panel sits beside the page, mounted ONCE here so moving
 * between those routes keeps it — scroll position, open groups and all —
 * instead of each page bringing its own navigation. Other sections render
 * their page alone, an automation opened inside a project among them.
 */
function HomeSectionFrame({
  organizationId,
  children,
}: {
  organizationId: string;
  children: ReactNode;
}) {
  const { pathname, search } = useLocation();
  // A phone has no panel beside the page (its Home list is a screen of its
  // own), so the panel — and every read it makes — mounts on desktop only.
  const isMobile = useIsMobile();
  // Moving between kinds of page — a chat, a task, a conversation, a
  // project — fades the page in; each page fades its own swaps of item.
  const location = readHomeLocation(pathname, search, organizationId);
  const pageRef = useSwapFade<HTMLDivElement>(
    location.kind === 'project'
      ? `project:${location.projectId ?? ''}`
      : location.kind,
  );
  if (!isHomePath(pathname, organizationId)) return <>{children}</>;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-row">
      {!isMobile && <HomePanel organizationId={organizationId} />}
      <div ref={pageRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  );
}
