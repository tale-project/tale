'use client';

import { Button } from '@tale/ui/button';
import { StatusIndicator } from '@tale/ui/status-indicator';
import { WifiOff } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useConvexConnectionState } from '@/app/hooks/use-convex-connection-state';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

const DISCONNECT_GRACE_MS = 3_000;

interface OnlineGateProps {
  children: ReactNode;
}

/**
 * Full-screen overlay that appears when the browser is offline or Convex has
 * been disconnected for longer than the grace window. Mounted once near the
 * router root. The overlay is additive — children continue to render
 * underneath so transient blips don't unmount the app.
 */
export function OnlineGate({ children }: OnlineGateProps) {
  const offline = useOfflineState();

  return (
    <>
      {children}
      {offline.state !== 'online' && <OfflineOverlay state={offline.state} />}
    </>
  );
}

type OfflineState = 'online' | 'browser-offline' | 'convex-disconnected';

function useOfflineState(): { state: OfflineState } {
  const connection = useConvexConnectionState();
  const [browserOnline, setBrowserOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [convexStale, setConvexStale] = useState(false);
  const graceTimer = useRef<number | null>(null);

  useEffect(() => {
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (connection.isWebSocketConnected) {
      setConvexStale(false);
      if (graceTimer.current !== null) {
        window.clearTimeout(graceTimer.current);
        graceTimer.current = null;
      }
      return undefined;
    }
    if (graceTimer.current !== null) return undefined;
    graceTimer.current = window.setTimeout(() => {
      setConvexStale(true);
      graceTimer.current = null;
    }, DISCONNECT_GRACE_MS);
    return () => {
      if (graceTimer.current !== null) {
        window.clearTimeout(graceTimer.current);
        graceTimer.current = null;
      }
    };
  }, [connection.isWebSocketConnected]);

  if (!browserOnline) return { state: 'browser-offline' };
  if (convexStale) return { state: 'convex-disconnected' };
  return { state: 'online' };
}

interface OfflineOverlayProps {
  state: Exclude<OfflineState, 'online'>;
}

function OfflineOverlay({ state }: OfflineOverlayProps) {
  const { t } = useT('connectivity');
  const isReconnecting = state === 'convex-disconnected';

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
        <div
          aria-hidden="true"
          className="bg-muted text-muted-foreground mb-6 flex size-16 items-center justify-center rounded-full"
        >
          <WifiOff className="size-7" />
        </div>
        <h2
          id="online-gate-title"
          className="text-foreground text-2xl leading-tight font-semibold tracking-tight"
        >
          {isReconnecting ? t('reconnectingTitle') : t('offlineTitle')}
        </h2>
        <p
          id="online-gate-description"
          className="text-muted-foreground mt-3 text-base leading-relaxed"
        >
          {isReconnecting
            ? t('reconnectingDescription')
            : t('offlineDescription')}
        </p>
        <div className="mt-6">
          <StatusIndicator
            variant={isReconnecting ? 'warning' : 'error'}
            pulse
            size="md"
          >
            {isReconnecting ? t('statusReconnecting') : t('statusOffline')}
          </StatusIndicator>
        </div>
        <Button
          type="button"
          variant="primary"
          className="mt-8 min-h-11 px-5"
          onClick={() => {
            window.location.reload();
          }}
        >
          {t('retry')}
        </Button>
      </div>
    </div>
  );
}
