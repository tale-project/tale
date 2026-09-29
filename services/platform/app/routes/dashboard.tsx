import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { FullPageCenter } from '@tale/ui/full-page-center';
import { VStack } from '@tale/ui/layout';
import { toast } from '@tale/ui/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import {
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { DashboardShellFrame } from '@/app/components/layout/dashboard-shell-frame';
import { SessionLapseRecovery } from '@/app/components/session-lapse-recovery';
import { useTwoFactorStatus } from '@/app/context/account-bootstrap-context';
import { AccountBootstrapProvider } from '@/app/context/account-bootstrap-provider';
import { useSessionIdleWatchdog } from '@/app/hooks/use-session-idle-watchdog';
import { useSessionLapseRedirect } from '@/app/hooks/use-session-lapse-redirect';
import { useAuth, useSessionUser } from '@/app/hooks/use-session-user';
import { redirectToLogIn } from '@/app/lib/auth/log-in-redirect';
import { reportSessionLapsed } from '@/app/lib/auth/session-lapse';
import {
  invalidateAuthState,
  sessionQueryOptions,
} from '@/app/lib/auth/session-query';
import {
  currentUserQuery,
  passwordExpiryQuery,
  twoFactorStatusQuery,
} from '@/app/lib/backend/account';
import { authClient } from '@/lib/auth-client';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';

// sessionStorage key arming the one-shot "stuck websocket auth" recovery
// reload (see the effect in DashboardRedirect).
const CONVEX_AUTH_RELOAD_GUARD = 'convex-auth-recovery-reloaded';

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async ({ context, location }) => {
    // Use TanStack Query for caching and deduplication. fetchQuery rejects on
    // transport failures (after retries) — fall back to the signed-out path
    // rather than surfacing a route error.
    const session = await context.queryClient
      .fetchQuery(sessionQueryOptions)
      .catch(() => null);
    if (!session?.data?.user) {
      throw redirect({
        to: '/log-in',
        search: { redirectTo: location.href },
      });
    }
    return { user: session.data.user };
  },
  loader: ({ context }) => {
    // Warm the 2FA / password-expiry gate during the navigation phase — the
    // 0.5 backend serves both on the session cookie, so the reads overlap
    // route-chunk loading and the provider mounts onto a warm cache.
    // Fire-and-forget so a slow gate can't stall the transition.
    void context.queryClient.prefetchQuery(twoFactorStatusQuery());
    void context.queryClient.prefetchQuery(passwordExpiryQuery());
  },
  component: DashboardRedirect,
});

function DashboardRedirect() {
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading } = useSessionUser();
  const [hasAuthenticated, setHasAuthenticated] = useState(isAuthenticated);
  // Whether the probe has answered at all. A probe that holds no answer (its
  // reads refused with a 401) goes back to loading on every refetch. Keyed on
  // that, a verified session swapped its page for the frame and back, each
  // remount refetched the probe, and every refetch restarted the check below
  // and cancelled its one reload: a request loop behind a frame that never
  // left.
  const [probeAnswered, setProbeAnswered] = useState(!isLoading);
  if (!probeAnswered && !isLoading) setProbeAnswered(true);

  // Idle-timeout UX: warn and sign out proactively when the deployment sets
  // SESSION_IDLE_TIMEOUT_MINUTES. The authenticated layout is the right mount
  // point — it wraps every signed-in page and is gated on a live session.
  useSessionIdleWatchdog();
  // Once content has mounted, preserve its drafts through any later session
  // lapse. The initial signed-out probe below still owns cold entry.
  const recovery = useSessionLapseRedirect(isAuthenticated || hasAuthenticated);
  const wasLapsed = useRef(false);
  const consumedLiveVersion = useRef(0);
  const refreshedSignedOutProbe = useRef(false);
  useEffect(() => {
    if (isAuthenticated || (!wasLapsed.current && recovery.isLapsed)) {
      refreshedSignedOutProbe.current = false;
    }
    if (consumedLiveVersion.current !== recovery.liveSessionVersion) {
      consumedLiveVersion.current = recovery.liveSessionVersion;
      if (
        (wasLapsed.current || !isAuthenticated) &&
        !refreshedSignedOutProbe.current
      ) {
        // Refresh a stale null probe even if the session was restored before
        // our first check. A still-refused /users/me can itself emit a lapse:
        // allow only one refresh until this unauthenticated episode ends.
        refreshedSignedOutProbe.current = true;
        void invalidateAuthState(queryClient).catch(() => undefined);
      }
    }
    wasLapsed.current = recovery.isLapsed;
  }, [
    queryClient,
    isAuthenticated,
    recovery.isLapsed,
    recovery.liveSessionVersion,
  ]);

  const [sessionVerified, setSessionVerified] = useState(false);
  const [hasValidSession, setHasValidSession] = useState(true);
  // Better Auth calls the session live, the one reload is spent, and the
  // refreshed probe still names nobody (see verify below).
  const [accountUnavailable, setAccountUnavailable] = useState(false);

  useEffect(() => {
    if (!probeAnswered) return undefined;
    if (isAuthenticated) {
      setHasAuthenticated(true);
      // Healthy (or recovered) — re-arm the one-shot recovery reload below.
      sessionStorage.removeItem(CONVEX_AUTH_RELOAD_GUARD);
      return undefined;
    }

    if (hasAuthenticated) {
      reportSessionLapsed();
      return undefined;
    }

    // Convex reports unauthenticated. That's either a genuinely signed-out
    // user, Convex auth lagging behind Better Auth after sign-up, or a STUCK
    // handshake: the auth provider latches the first session/token fetch
    // result, so a transient cold-start failure (backend still warming,
    // first-run JWKS bootstrap) strands the websocket unauthenticated and
    // every auth-gated query disabled — endless skeletons until a manual
    // reload. Re-check Better Auth directly before doing a hard redirect, and
    // un-stick the provider when the session is actually alive.
    let cancelled = false;
    // At most one timer is ever pending: a verify() run finishes before it
    // schedules anything, and it arms exactly one of the two timers (the
    // re-check backoff in scheduleRecheck or the one-shot reload below) — never
    // both — overwriting this single handle. Cleanup clears whichever is set.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const MAX_RECHECKS = 8;

    const scheduleRecheck = (attempt: number) => {
      // Backend unreachable — keep the shell up instead of bouncing a
      // possibly-valid session to /log-in on a blip, and re-check until the
      // backend answers (the fetch layer's own retries cover ~8s; this
      // extends coverage to ~40s of outage). Only a CLEAN signed-out answer
      // ever triggers the redirect.
      if (attempt + 1 < MAX_RECHECKS) {
        timer = setTimeout(() => verify(attempt + 1), 4_000);
      }
    };

    const verify = (attempt: number) => {
      void authClient
        .getSession()
        .then((session) => {
          if (cancelled) return;
          const status = session?.error?.status;
          if (status !== undefined && (status === 0 || status >= 500)) {
            console.warn(
              `[auth] Session re-check failed with ${status} (attempt ${attempt + 1})`,
            );
            scheduleRecheck(attempt);
            return;
          }
          const valid = !!session?.data?.user;
          setHasValidSession(valid);
          setSessionVerified(true);
          if (!valid) return;
          // The session is live but the backend probe may still cache null
          // from before sign-in. Refresh the same auth-scoped reads as login.
          const refreshed = invalidateAuthState(queryClient).catch(
            (error: unknown) => {
              console.warn(
                '[auth] Refreshing the signed-in reads failed',
                error,
              );
            },
          );
          // Last resort: if the kick doesn't authenticate within 8s, reload
          // once (what this state otherwise forces the user to do manually).
          // Guarded per tab so it can never loop; cleared on success above.
          if (!sessionStorage.getItem(CONVEX_AUTH_RELOAD_GUARD)) {
            timer = setTimeout(() => {
              sessionStorage.setItem(CONVEX_AUTH_RELOAD_GUARD, '1');
              console.warn(
                '[auth] Convex websocket auth is stuck with a valid session — reloading once to recover.',
              );
              window.location.reload();
            }, 8_000);
            return;
          }
          // The reload is spent. If the refreshed probe still names nobody,
          // the backend does not know the account Better Auth signed in, and
          // every page below would wait on that user with no word and no way
          // out: say so instead.
          void refreshed.then(() => {
            if (cancelled) return;
            if (!queryClient.getQueryData(currentUserQuery().queryKey)) {
              setAccountUnavailable(true);
            }
          });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // Thrown fetch = transport failure too (offline, refused) — same
          // treatment as 5xx: hold the shell and re-check.
          console.warn('[auth] Session re-check failed', err);
          scheduleRecheck(attempt);
        });
    };

    verify(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [probeAnswered, isAuthenticated, hasAuthenticated, queryClient]);

  useEffect(() => {
    if (!hasAuthenticated && sessionVerified && !hasValidSession) {
      redirectToLogIn();
    }
  }, [sessionVerified, hasValidSession, hasAuthenticated]);

  // Paint the dashboard shell immediately while the Convex websocket
  // authenticates (was a blank `null` — the main cause of the cold-load
  // "nothing on screen for seconds" feel).
  if (
    !hasAuthenticated &&
    (!probeAnswered || (!isAuthenticated && !sessionVerified))
  ) {
    return <DashboardShellFrame />;
  }

  // Hard-redirecting to /log-in (effect above) — keep the shell up so the
  // transition doesn't flash blank.
  if (!hasAuthenticated && sessionVerified && !hasValidSession) {
    return <DashboardShellFrame />;
  }

  if (!hasAuthenticated && !isAuthenticated && accountUnavailable) {
    return <AccountUnavailable />;
  }

  // Authenticated: mount the shared account-bootstrap queries (2FA +
  // password-expiry) for the whole dashboard subtree and let the 2FA gate
  // read them.
  return (
    <SessionLapseRecovery recovery={recovery}>
      <AccountBootstrapProvider>
        <DashboardTwoFactorGate />
      </AccountBootstrapProvider>
    </SessionLapseRecovery>
  );
}

/**
 * A session Better Auth still calls live while the backend's `/users/me`
 * names nobody, after the one recovery reload. The pages under the layout
 * wait on that user — the create-organization page held its frame forever —
 * so the layout says what happened and offers the ways on. Signing in again
 * ends the session first: the sign-in page sends a live session straight
 * back to the dashboard. A session an authenticating proxy asserted is the
 * proxy's to end, as the account menu has it, so it is offered Try again
 * alone.
 */
function AccountUnavailable() {
  const queryClient = useQueryClient();
  const { signOut, proxied } = useAuth();
  const { t } = useT('auth');
  const { t: tCommon } = useT('common');
  const [retrying, setRetrying] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const retry = () => {
    setRetrying(true);
    void invalidateAuthState(queryClient)
      .catch((error: unknown) => {
        console.warn('[auth] Refreshing the account failed', error);
      })
      .finally(() => setRetrying(false));
  };

  const signInAgain = async () => {
    setLeaving(true);
    try {
      await signOut();
    } catch (error) {
      console.warn('[auth] Ending the session to sign in again failed', error);
      setLeaving(false);
      toast({
        title: t('userButton.toast.signOutFailed'),
        variant: 'destructive',
      });
      return;
    }
    redirectToLogIn();
  };

  return (
    <FullPageCenter>
      <VStack gap={3}>
        <Alert
          variant="destructive"
          description={t('accountUnavailable.description')}
        />
        <Button variant="secondary" isLoading={retrying} onClick={retry}>
          {tCommon('actions.tryAgain')}
        </Button>
        {!proxied && (
          <Button
            variant="secondary"
            isLoading={leaving}
            onClick={() => void signInAgain()}
          >
            {t('accountUnavailable.signInAgain')}
          </Button>
        )}
      </VStack>
    </FullPageCenter>
  );
}

/**
 * Client-side 2FA enforcement gate.
 *
 * Renders the dashboard content immediately so its Convex subscriptions start
 * in parallel with the 2FA check (no longer serialized behind it), but covers
 * it with an opaque, non-interactive shell overlay until the 2FA status query
 * confirms the user is not `blocked`. A `blocked` user is routed to
 * `/2fa-enroll` (client-side navigation, so nested editors' `beforeunload`
 * handlers don't fire a "leave site?" dialog); the overlay stays up until the
 * navigation lands, so protected content is never interactive for them.
 *
 * Fail-closed: while the status is still `undefined` (or errored) the overlay
 * stays up — a transient failure can't silently let a `blocked` user through.
 * RLS still authorizes every underlying query server-side regardless of 2FA.
 */
function DashboardTwoFactorGate() {
  const navigate = useNavigate();
  const twoFactorStatus = useTwoFactorStatus();

  const isBlocked =
    twoFactorStatus?.authenticated === true &&
    twoFactorStatus.decision === 'blocked';

  useEffect(() => {
    if (!isBlocked) return;
    const basePath = getEnv('BASE_PATH');
    const pathname = window.location.pathname;
    const routePath = basePath
      ? pathname.replace(new RegExp(`^${basePath}`), '')
      : pathname;
    const redirectTo = routePath + window.location.search;
    void navigate({
      to: '/2fa-enroll',
      search: { redirectTo },
      replace: true,
    });
  }, [isBlocked, navigate]);

  // Cover content while the 2FA decision is unknown or blocked.
  const gateActive = twoFactorStatus === undefined || isBlocked;

  return (
    <>
      <Outlet />
      {gateActive && (
        <div aria-hidden className="bg-background fixed inset-0 z-200">
          <DashboardShellFrame />
        </div>
      )}
    </>
  );
}
