'use client';

import RFB from '@novnc/novnc';
import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { useMatch } from '@tanstack/react-router';
import { MonitorPlay, MonitorOff, RefreshCw, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useT } from '@/lib/i18n/client';

import {
  useSessionProgress,
  useThreadSandboxState,
} from '../../chat/hooks/queries';
import { useLiveBrowser } from './live-browser-context';

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 480;
const STRIP_WIDTH = 48;

/** RFB connection lifecycle, driven by the noVNC `RFB` events. */
type StreamStatus = 'connecting' | 'streaming' | 'disconnected' | 'error';

/**
 * Build the same-origin RFB-over-WebSocket URL for a thread's screencast. The
 * backend serves websockify-framed raw RFB bytes at `/screencast/<threadId>`;
 * `@novnc/novnc`'s `RFB` consumes exactly that. Scheme follows the page (wss on
 * https, ws on http). Browser-only — reads `window.location`.
 */
function buildScreencastUrl(threadId: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  return `${scheme}${window.location.host}/screencast/${encodeURIComponent(
    threadId,
  )}`;
}

interface ScreencastViewportProps {
  threadId: string;
  /** Whether the agent's session is actively running a turn / warm. */
  sessionActive: boolean;
}

/**
 * The live RFB stream surface. Hosts a single `RFB` instance over the
 * `/screencast/<threadId>` WebSocket, rendered into a full-size container the
 * RFB canvas attaches to. Read-only on three levels: the source enforces it
 * (x11vnc `-viewonly`), the client sets `rfb.viewOnly = true`, and the canvas
 * host carries `pointer-events-none` (defense-in-depth).
 *
 * The RFB instance is constructed ONLY in a browser effect keyed on
 * `(threadId, connectNonce)` and torn down (`rfb.disconnect()`) on cleanup /
 * thread change / unmount, so exactly one WebSocket is ever open.
 */
function ScreencastViewport({
  threadId,
  sessionActive,
}: ScreencastViewportProps) {
  const { t } = useT('chat');
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  // Bumping this re-runs the connect effect (Reconnect / Retry).
  const [connectNonce, setConnectNonce] = useState(0);

  const reconnect = useCallback(() => {
    setStatus('connecting');
    setConnectNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    // Never construct RFB during SSR or before the host node mounts.
    const container = containerRef.current;
    if (!container || typeof window === 'undefined') return undefined;

    setStatus('connecting');

    let rfb: RFB | null = null;
    try {
      rfb = new RFB(container, buildScreencastUrl(threadId), {});
      // Read-only viewer knobs (set as instance props per noVNC docs).
      rfb.viewOnly = true;
      rfb.scaleViewport = true;
      rfb.clipViewport = true;
      rfb.focusOnClick = false;
      rfb.background = '#000';
      rfbRef.current = rfb;
    } catch (err) {
      console.error('[live-browser] RFB construction failed', err);
      setStatus('error');
      return undefined;
    }

    const handleConnect = () => setStatus('streaming');
    const handleDisconnect = (event: CustomEvent<{ clean?: boolean }>) => {
      // `detail.clean` true = the server (or our own disconnect) closed
      // cleanly; false = a transport/protocol failure.
      setStatus(event.detail?.clean ? 'disconnected' : 'error');
    };
    const handleSecurityFailure = (event: CustomEvent) => {
      // Auth / org-scope rejection at the WS handshake (cookie failed, or the
      // thread isn't the user's). Surface as a generic error — never as
      // "disconnected", so the empty/retry copy stays honest.
      console.warn('[live-browser] RFB security failure', event.detail);
      setStatus('error');
    };

    rfb.addEventListener('connect', handleConnect);
    rfb.addEventListener('disconnect', handleDisconnect);
    rfb.addEventListener('securityfailure', handleSecurityFailure);

    return () => {
      rfb?.removeEventListener('connect', handleConnect);
      rfb?.removeEventListener('disconnect', handleDisconnect);
      rfb?.removeEventListener('securityfailure', handleSecurityFailure);
      try {
        rfb?.disconnect();
      } catch (err) {
        // disconnect() can throw if the socket never opened — log, don't mask
        // the unmount.
        console.warn('[live-browser] RFB disconnect during cleanup', err);
      }
      rfbRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, connectNonce]);

  // Gated empty state: nothing is being driven, so don't even open a socket —
  // tell the user to start a turn.
  if (!sessionActive) {
    return (
      <Stack
        gap={3}
        className="h-full items-center justify-center p-8 text-center"
      >
        <MonitorOff className="text-muted-foreground size-6" aria-hidden />
        <Text variant="label" className="text-sm">
          {t('liveBrowser.emptyTitle', {
            defaultValue: 'The agent isn’t browsing right now',
          })}
        </Text>
        <Text variant="muted" className="max-w-xs text-sm">
          {t('liveBrowser.emptyHint', {
            defaultValue:
              'Start a turn — when the agent opens a browser you’ll see it here, live.',
          })}
        </Text>
      </Stack>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 bg-black">
      {/* The RFB canvas mounts inside here. `pointer-events-none` is
          defense-in-depth on top of `rfb.viewOnly = true` — the stream is
          strictly view-only. */}
      <div
        ref={containerRef}
        className="pointer-events-none absolute inset-0 size-full"
        aria-label={t('liveBrowser.ariaLabel', {
          defaultValue: 'Live view of the agent’s browser (read-only)',
        })}
      />

      {/* Screen-reader status while the live frames are flowing (the canvas
          itself conveys nothing to AT). */}
      {status === 'streaming' && (
        <span className="sr-only" role="status" aria-live="polite">
          {t('liveBrowser.streaming', { defaultValue: 'Live' })}
        </span>
      )}

      {status === 'connecting' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Stack gap={2} className="items-center">
            <Spinner
              label={t('liveBrowser.connecting', {
                defaultValue: 'Connecting',
              })}
            />
            <Text variant="caption" className="text-white/70">
              {t('liveBrowser.connecting', { defaultValue: 'Connecting…' })}
            </Text>
          </Stack>
        </div>
      )}

      {status === 'disconnected' && (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <Stack gap={3} className="items-center text-center">
            <Text variant="label" className="text-sm text-white">
              {t('liveBrowser.disconnected', {
                defaultValue: 'Stream ended',
              })}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={reconnect}
            >
              {t('liveBrowser.reconnect', { defaultValue: 'Reconnect' })}
            </Button>
          </Stack>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <Stack gap={3} className="items-center text-center">
            <Text variant="label" className="text-sm text-white">
              {t('liveBrowser.error', {
                defaultValue: 'Couldn’t connect to the live view.',
              })}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={reconnect}
            >
              {t('liveBrowser.retry', { defaultValue: 'Retry' })}
            </Button>
          </Stack>
        </div>
      )}
    </div>
  );
}

/** The full open-pane body: header (with the "View only" badge) + the live
 *  stream surface. Shared by the desktop resizable pane and the mobile sheet. */
function LiveBrowserBody({
  threadId,
  embedded,
}: {
  threadId: string;
  embedded?: boolean;
}) {
  const { t } = useT('chat');
  const { close } = useLiveBrowser();

  // "Active" = there's something worth streaming: a turn is actively running,
  // or the sandbox is warm (`active`). A `stopped`/`creating`/`degraded`
  // session (or no live op) shows the gated empty state instead of opening a
  // socket that would only stare at a black frame.
  const state = useThreadSandboxState(threadId);
  const progress = useSessionProgress(threadId);
  const running =
    progress?.status === 'running' && progress?.agentIdleAt == null;
  const sessionActive = running || state?.status === 'active';

  return (
    <>
      <div className="border-border flex items-center justify-between gap-2 border-b p-3">
        <div className="flex min-w-0 items-center gap-2">
          <MonitorPlay
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
          <span className="truncate text-sm font-medium">
            {t('liveBrowser.title', { defaultValue: 'Live browser' })}
          </span>
          <span className="border-border text-muted-foreground bg-muted/60 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
            {t('liveBrowser.viewOnly', { defaultValue: 'View only' })}
          </span>
        </div>
        {!embedded && (
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip
              content={t('liveBrowser.paneClose', {
                defaultValue: 'Close live browser',
              })}
              side="bottom"
            >
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={close}
                aria-label={t('liveBrowser.paneClose', {
                  defaultValue: 'Close live browser',
                })}
              >
                <X className="size-3.5" />
              </Button>
            </Tooltip>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <ScreencastViewport threadId={threadId} sessionActive={sessionActive} />
      </div>
    </>
  );
}

/** Mobile/embedded variant — renders just the body (no resizable shell). The
 *  caller (the chat Sheet) supplies the panel chrome. Shares one RFB host →
 *  only one WebSocket. */
export function LiveBrowserMobileBody({ threadId }: { threadId: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <LiveBrowserBody threadId={threadId} embedded />
    </div>
  );
}

/**
 * Read-only right-side pane streaming the live external-agent browser over
 * noVNC. Clones the WorkspaceFilesPane shell: resizable 320–720px (default
 * ~480), a collapse-to-48px strip with a vertical label, a `border-l` left
 * edge, a drag handle, and `React.memo`. Self-gated at the toggle + mount site
 * (chat-input self-gates the toggle; chat.tsx only mounts this where it makes
 * sense). The noVNC bundle is code-split via `lazyComponent` at the import site.
 */
function LiveBrowserPaneComponent() {
  const { t } = useT('chat');
  const threadMatch = useMatch({
    from: '/dashboard/$id/chat/$threadId',
    shouldThrow: false,
  });
  const threadId = threadMatch?.params?.threadId;

  const { isOpen, open } = useLiveBrowser();

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const resizeRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startWidth =
      resizeRef.current?.parentElement?.offsetWidth ?? DEFAULT_WIDTH;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startWidth + delta),
      );
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  // No threadId → nothing to stream (gated at the toggle + mount site too).
  if (!threadId) return null;

  // Collapsed: hidden on mobile (the Sheet takes over below `md`), a vertical
  // strip on desktop so the pane is one click away after the user closes it.
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={open}
        aria-label={t('liveBrowser.toggleLabel', {
          defaultValue: 'Live browser',
        })}
        className="border-border bg-background hover:bg-muted/50 group hidden h-full shrink-0 cursor-pointer flex-col items-center gap-3 border-l py-4 transition-colors md:flex"
        style={{ width: STRIP_WIDTH }}
      >
        <MonitorPlay className="text-muted-foreground group-hover:text-foreground size-4" />
        <span className="text-muted-foreground group-hover:text-foreground rotate-180 text-[10px] [writing-mode:vertical-rl]">
          {t('liveBrowser.title', { defaultValue: 'Live browser' })}
        </span>
      </button>
    );
  }

  return (
    <div
      className="border-border bg-background relative hidden h-full shrink-0 flex-col border-l md:flex"
      style={{ width }}
      role="complementary"
      aria-label={t('liveBrowser.title', { defaultValue: 'Live browser' })}
    >
      <div
        ref={resizeRef}
        onMouseDown={handleMouseDown}
        className="absolute top-0 -left-1 z-10 h-full w-2 cursor-col-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('liveBrowser.paneClose', {
          defaultValue: 'Resize live browser panel',
        })}
      />
      <LiveBrowserBody threadId={threadId} />
    </div>
  );
}

export const LiveBrowserPane = memo(LiveBrowserPaneComponent);
