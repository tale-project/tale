'use client';

import { Button } from '@tale/ui/button';
import { useInstallPrompt } from '@tale/ui/pwa/use-install-prompt';
import { Download, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { useBackendConnectionState } from '@/app/hooks/use-backend-connection-state';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

const DISCONNECT_GRACE_MS = 3_000;

interface OnlineGateProps {
  children: ReactNode;
}

type OfflineReason = 'device' | 'backend';

/**
 * Full-screen overlay that appears when the app can't talk to its backend.
 * Mounted once near the router root; children continue to render underneath
 * so a transient blip doesn't unmount the app.
 *
 * Two distinct reasons drive the overlay, each with its own copy:
 *   - `'device'`  — `navigator.onLine === false`. The user's device is
 *                   offline. We surface this even when the Convex WS is
 *                   still nominally connected, because nothing the user
 *                   does will round-trip until the network returns.
 *   - `'backend'` — device thinks it's online but Convex's websocket has
 *                   been stale longer than the grace window. Tale's server
 *                   is unreachable from here.
 *
 * The grace window prevents the overlay from flashing on benign blips
 * (HMR push, tab waking from sleep, brief WS reconnect on auth refresh).
 */
export function OnlineGate({ children }: OnlineGateProps) {
  const reason = useOfflineReason();
  return (
    <>
      {children}
      {reason !== null && <OfflineOverlay reason={reason} />}
    </>
  );
}

function useOfflineReason(): OfflineReason | null {
  const connection = useBackendConnectionState();
  const [isDeviceOffline, setIsDeviceOffline] = useState(
    () => typeof navigator !== 'undefined' && !navigator.onLine,
  );
  const [isWsStale, setIsWsStale] = useState(false);
  const graceTimer = useRef<number | null>(null);

  useEffect(() => {
    const sync = () => setIsDeviceOffline(!navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  useEffect(() => {
    if (connection.isWebSocketConnected) {
      setIsWsStale(false);
      if (graceTimer.current !== null) {
        window.clearTimeout(graceTimer.current);
        graceTimer.current = null;
      }
      return undefined;
    }
    if (graceTimer.current !== null) return undefined;
    graceTimer.current = window.setTimeout(() => {
      setIsWsStale(true);
      graceTimer.current = null;
    }, DISCONNECT_GRACE_MS);
    return () => {
      if (graceTimer.current !== null) {
        window.clearTimeout(graceTimer.current);
        graceTimer.current = null;
      }
    };
  }, [connection.isWebSocketConnected]);

  // The overlay only appears when Convex's WS is actually unreachable —
  // `navigator.onLine` is unreliable on its own (a laptop with no WAN can
  // still talk to a local self-hosted backend, the common `bun run dev`
  // shape). Once the WS is stale, we use `navigator.onLine` purely to
  // *classify* the cause so the copy matches reality: device-offline vs
  // server-unreachable.
  if (!isWsStale) return null;
  return isDeviceOffline ? 'device' : 'backend';
}

interface OfflineOverlayProps {
  reason: OfflineReason;
}

function OfflineOverlay({ reason }: OfflineOverlayProps) {
  const { t } = useT('connectivity');
  const { appName } = useBrandingContext();
  const { canInstall, promptInstall } = useInstallPrompt();
  // Bumping the nonce remounts the indicator so the pulse animation restarts
  // on "Try again" — a small visual ack that the gesture registered, without
  // any disabled/loading "Checking…" intermediate state.
  const [retryNonce, setRetryNonce] = useState(0);

  // Surface the reconnect state in the tab title so a glance at a window
  // chooser / tab strip shows which tab dropped — and so the org name (or the
  // platform default pre-auth) stays in the title even on routes whose own
  // title strips the suffix. Restore the prior title on dismiss so we don't
  // permanently overwrite it.
  useEffect(() => {
    const previous = document.title;
    document.title = `${t('tabTitle')} — ${appName ?? 'Tale'}`;
    return () => {
      document.title = previous;
    };
  }, [t, appName]);

  const heading = reason === 'device' ? t('deviceTitle') : t('backendTitle');
  const description =
    reason === 'device' ? t('deviceDescription') : t('backendDescription');

  const handleRetry = () => {
    // Convex's client already auto-reconnects continuously, so we don't need
    // to wire a manual reconnect call — bumping the nonce just restarts the
    // ring animation so the user sees the gesture register. The overlay
    // dismisses on its own once the WS handshake completes.
    setRetryNonce((n) => n + 1);
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-live="polite"
      aria-labelledby="online-gate-title"
      aria-describedby="online-gate-description"
      className={cn(
        'bg-background fixed inset-0 z-200 flex flex-col items-center justify-center px-6',
        'pt-(--safe-top) pr-(--safe-right) pb-(--safe-bottom) pl-(--safe-left)',
      )}
    >
      <div className="mx-auto flex w-full max-w-sm flex-col items-center text-center">
        <ReachingServerIndicator key={retryNonce} label={t('reachingServer')} />
        <h2
          id="online-gate-title"
          className="text-foreground mt-8 text-2xl leading-tight font-semibold tracking-tight"
        >
          {heading}
        </h2>
        <p
          id="online-gate-description"
          className="text-muted-foreground mt-3 text-base leading-relaxed"
        >
          {description}
        </p>
        <div className="mt-8 flex flex-col items-center gap-3">
          <Button
            type="button"
            variant="primary"
            className="min-h-11 px-5"
            onClick={handleRetry}
          >
            {t('retry')}
          </Button>
          {canInstall && (
            <Button
              type="button"
              variant="secondary"
              icon={Download}
              className="min-h-11 px-5"
              onClick={() => {
                void promptInstall();
              }}
            >
              {t('getApp')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface ReachingServerIndicatorProps {
  label: string;
}

/**
 * The "we're actively trying" visual. Two concentric `animate-ping` rings
 * pulse outward from a static wifi-off badge — a familiar "radar reach"
 * pattern. The staggered animation delay keeps a ring in flight at all
 * times instead of synchronizing into a single throb.
 *
 * `motion-safe:` gates the rings so users with `prefers-reduced-motion`
 * see a static icon, with the `aria-label` carrying the meaning instead.
 */
function ReachingServerIndicator({ label }: ReachingServerIndicatorProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className="relative flex size-24 items-center justify-center"
    >
      <span
        aria-hidden="true"
        className="bg-muted-foreground/20 absolute inline-flex size-16 rounded-full motion-safe:animate-ping"
      />
      <span
        aria-hidden="true"
        className="bg-muted-foreground/15 absolute inline-flex size-12 rounded-full [animation-delay:700ms] motion-safe:animate-ping"
      />
      <div
        aria-hidden="true"
        className="bg-muted text-muted-foreground relative flex size-16 items-center justify-center rounded-full"
      >
        <WifiOff className="size-7" />
      </div>
    </div>
  );
}
