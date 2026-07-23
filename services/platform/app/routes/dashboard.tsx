import { convexQuery } from '@convex-dev/react-query';
import {
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { DashboardShellFrame } from '@/app/components/layout/dashboard-shell-frame';
import { useTwoFactorStatus } from '@/app/context/account-bootstrap-context';
import { AccountBootstrapProvider } from '@/app/context/account-bootstrap-provider';
import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useSessionIdleWatchdog } from '@/app/hooks/use-session-idle-watchdog';
import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';
import { getEnv } from '@/lib/env';

// sessionStorage key arming the one-shot "stuck websocket auth" recovery
// reload (see the effect in DashboardRedirect).
const CONVEX_AUTH_RELOAD_GUARD = 'convex-auth-recovery-reloaded';

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async ({ context }) => {
    // Use TanStack Query for caching and deduplication. fetchQuery rejects on
    // transport failures (after retries) — fall back to the signed-out path
    // rather than surfacing a route error.
    const session = await context.queryClient
      .fetchQuery(sessionQueryOptions)
      .catch(() => null);
    if (!session?.data?.user) {
      throw redirect({ to: '/log-in' });
    }
    return { user: session.data.user };
  },
  loader: ({ context }) => {
    // Warm the 2FA / password-expiry gate during the navigation phase so the
    // queries overlap the websocket auth handshake instead of running only
    // after the provider mounts. Without this the 2FA overlay holds content
    // for one extra round-trip past auth; with it the overlay lifts as soon as
    // auth completes (the provider reads the warm cache). Fire-and-forget so a
    // slow gate can't stall the transition.
    void context.queryClient.prefetchQuery(
      convexQuery(api.two_factor.queries.getStatus, {}),
    );
    void context.queryClient.prefetchQuery(
      convexQuery(api.users.queries.getPasswordExpiryStatus, {}),
    );
  },
  component: DashboardRedirect,
});

function DashboardRedirect() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  // Idle-timeout UX: warn and sign out proactively when the deployment sets
  // SESSION_IDLE_TIMEOUT_MINUTES. The authenticated layout is the right mount
  // point — it wraps every signed-in page and is gated on a live session.
  useSessionIdleWatchdog();

  const [sessionVerified, setSessionVerified] = useState(false);
  const [hasValidSession, setHasValidSession] = useState(true);

  useEffect(() => {
    if (isLoading) return undefined;
    if (isAuthenticated) {
      // Healthy (or recovered) — re-arm the one-shot recovery reload below.
      sessionStorage.removeItem(CONVEX_AUTH_RELOAD_GUARD);
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
          // Better Auth has a live session but the Convex websocket never
          // authenticated. Poke the session signal so the provider refetches
          // its session atom and rebuilds the token fetch → ws auth chain.
          authClient.$store.notify('$sessionSignal');
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
          }
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
  }, [isLoading, isAuthenticated]);

  useEffect(() => {
    if (sessionVerified && !hasValidSession) {
      const basePath = getEnv('BASE_PATH');
      const pathname = window.location.pathname;
      const routePath = basePath
        ? pathname.replace(new RegExp(`^${basePath}`), '')
        : pathname;
      const returnTo = routePath + window.location.search;
      window.location.href = `${basePath}/log-in?redirectTo=${encodeURIComponent(returnTo)}`;
    }
  }, [sessionVerified, hasValidSession]);

  // Paint the dashboard shell immediately while the Convex websocket
  // authenticates (was a blank `null` — the main cause of the cold-load
  // "nothing on screen for seconds" feel).
  if (isLoading || (!isAuthenticated && !sessionVerified)) {
    return <DashboardShellFrame />;
  }

  // Hard-redirecting to /log-in (effect above) — keep the shell up so the
  // transition doesn't flash blank.
  if (sessionVerified && !hasValidSession) {
    return <DashboardShellFrame />;
  }

  // Authenticated: mount the shared account-bootstrap queries (2FA +
  // password-expiry) for the whole dashboard subtree and let the 2FA gate
  // read them.
  return (
    <AccountBootstrapProvider>
      <DashboardTwoFactorGate />
    </AccountBootstrapProvider>
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
