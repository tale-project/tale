'use client';

import * as ToastPrimitives from '@radix-ui/react-toast';
import { useEffect, useMemo, useRef } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useSessionUser } from '@/app/hooks/use-session-user';
import { toast } from '@/app/hooks/use-toast';
import { clearTitleSuffix } from '@/app/lib/title-suffix';
import { authClient } from '@/lib/auth-client';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';
import { sessionIdleTimeoutConfigSchema } from '@/lib/shared/schemas/governance';
import { resolveEffectiveIdleMinutes } from '@/lib/shared/session-idle';

// Cross-tab shared "last activity" timestamp (ms). Activity in any tab keeps
// every tab alive, mirroring the server's sliding window — otherwise an idle
// background tab would sign you out while you work in another.
const ACTIVITY_STORAGE_KEY = 'tale:session-idle:last-activity';

// Genuine user input. mousemove is chatty, so the localStorage write is
// throttled; the in-memory timestamp updates on every event.
const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'wheel',
] as const;

const WARNING_LEAD_MS = 60_000; // warn this long before the hard cut-off
const ACTIVITY_WRITE_THROTTLE_MS = 10_000;
const CHECK_INTERVAL_MS = 5_000;

/**
 * Session idle watchdog (#1502, client side).
 *
 * The server backstop is the control: Better Auth rejects an over-idle
 * session on the next request when `SESSION_IDLE_TIMEOUT_MINUTES` is set (see
 * `lib/shared/session-idle.ts`). This hook is the matching UX — it watches
 * local input, warns shortly before the window elapses, and signs the user
 * out proactively instead of letting their next action 401.
 *
 * The effective window is the per-org `session_idle_timeout` governance
 * policy (#1502) tightened against the deployment backstop, resolved by
 * `resolveEffectiveIdleMinutes`. No-op when neither is configured.
 *
 * Mount once inside the authenticated layout.
 */
export function useSessionIdleWatchdog(): void {
  const { t } = useT('common');
  // Read translations fresh at toast time without re-running the effect (and
  // resetting the idle timer) on every render or locale change.
  const tRef = useRef(t);
  tRef.current = t;

  // Per-org window (member-readable). `skip` outside an org route — the
  // effective window then falls back to the deployment backstop alone. Also
  // skip until the Convex WebSocket is authenticated: on a cold load the route
  // (and this watchdog) mount with an `organizationId` from the URL before auth
  // lands, and `getPolicy` throws `Unauthenticated` server-side if it runs
  // first. Gating in the args (not the options) is required — a `'skip'` arg
  // sets `enabled: false`, which an `{ enabled }` option would override.
  const { isAuthenticated } = useSessionUser();
  const organizationId = useOrganizationId();
  const { data: policyRow } = useBackendQuery(
    'governance/queries:getPolicy',
    organizationId && isAuthenticated
      ? { organizationId, policyType: 'session_idle_timeout' as const }
      : 'skip',
  );

  // Effective minutes drive a primitive effect dep, so the listeners/timer are
  // rebuilt only when the resolved window actually changes (e.g. an admin
  // edits the policy live) — not on every render.
  const minutes = useMemo(() => {
    // Don't arm on the env (looser) window while the org policy is still
    // loading — otherwise a member already past the org's tighter timeout
    // would stay signed in until the query resolves. `policyRow === undefined`
    // is the in-flight state (`null` = loaded, no policy row); wait for it.
    if (organizationId && policyRow === undefined) return null;

    const envRaw = getEnv('SESSION_IDLE_TIMEOUT_MINUTES');
    const envMinutes =
      typeof envRaw === 'number' && Number.isFinite(envRaw) && envRaw > 0
        ? envRaw
        : null;
    const parsed = policyRow?.config
      ? sessionIdleTimeoutConfigSchema.safeParse(policyRow.config)
      : null;
    const policy = parsed?.success ? parsed.data : null;
    return resolveEffectiveIdleMinutes({ policy, envMinutes });
  }, [organizationId, policyRow]);

  useEffect(() => {
    if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) {
      return undefined;
    }

    const idleMs = minutes * 60_000;
    const warnMs = Math.min(WARNING_LEAD_MS, Math.floor(idleMs / 2));

    let lastActivity = Date.now();
    let lastWrite = 0;
    let dismissWarning: (() => void) | null = null;

    const readShared = (): number => {
      try {
        const raw = localStorage.getItem(ACTIVITY_STORAGE_KEY);
        const parsed = raw === null ? NaN : Number(raw);
        return Number.isFinite(parsed) ? parsed : 0;
      } catch {
        return 0;
      }
    };

    const writeShared = (ts: number): void => {
      try {
        localStorage.setItem(ACTIVITY_STORAGE_KEY, String(ts));
      } catch (err) {
        // Storage can throw in private mode / when full; the in-memory
        // timestamp still drives this tab, only cross-tab sync is lost.
        console.warn('[session-idle] could not persist activity', err);
      }
    };

    const clearWarning = (): void => {
      if (dismissWarning) {
        dismissWarning();
        dismissWarning = null;
      }
    };

    const recordActivity = (persist: boolean): void => {
      const now = Date.now();
      lastActivity = now;
      clearWarning();
      if (persist && now - lastWrite > ACTIVITY_WRITE_THROTTLE_MS) {
        lastWrite = now;
        writeShared(now);
      }
    };

    // Seed from any tab that was already active.
    lastActivity = Math.max(lastActivity, readShared());
    writeShared(lastActivity);

    const onActivity = (): void => recordActivity(true);
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') recordActivity(true);
    };
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== ACTIVITY_STORAGE_KEY || !event.newValue) return;
      const ts = Number(event.newValue);
      if (Number.isFinite(ts) && ts > lastActivity) {
        lastActivity = ts;
        clearWarning();
      }
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('storage', onStorage);

    let signingOut = false;
    const signOutForIdle = async (): Promise<void> => {
      if (signingOut) return;
      signingOut = true;
      try {
        await authClient.signOut();
      } catch (err) {
        console.error('[session-idle] sign-out failed', err);
      }
      // Forget the cached org name so the login page renders "Tale", not the
      // previous org's title suffix.
      clearTitleSuffix();
      // Intentional hard navigation (not the router): a full reload tears
      // down the Convex client, React Query cache, and any in-memory auth
      // state on sign-out. Same precedent as user-button and dashboard.tsx.
      const basePath = getEnv('BASE_PATH');
      window.location.href = `${basePath}/log-in?reason=idle`;
    };

    const interval = window.setInterval(() => {
      // The storage event never fires in the tab that wrote it and can be
      // missed under throttling, so re-read the shared value each tick.
      lastActivity = Math.max(lastActivity, readShared());
      const idleFor = Date.now() - lastActivity;

      if (idleFor >= idleMs) {
        window.clearInterval(interval);
        clearWarning();
        void signOutForIdle();
        return;
      }

      if (idleFor >= idleMs - warnMs && !dismissWarning) {
        const handle = toast({
          duration: warnMs + CHECK_INTERVAL_MS * 2,
          title: tRef.current('sessionIdle.warningTitle'),
          description: tRef.current('sessionIdle.warningDescription'),
          action: (
            <ToastPrimitives.Action
              altText={tRef.current('sessionIdle.staySignedIn')}
              asChild
              onClick={() => recordActivity(true)}
            >
              <button
                type="button"
                className="bg-foreground text-background focus-visible:ring-ring inline-flex h-8 shrink-0 items-center rounded-md px-3 text-xs font-medium transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none"
              >
                {tRef.current('sessionIdle.staySignedIn')}
              </button>
            </ToastPrimitives.Action>
          ),
        });
        dismissWarning = handle.dismiss;
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      clearWarning();
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity);
      }
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('storage', onStorage);
    };
  }, [minutes]);
}
