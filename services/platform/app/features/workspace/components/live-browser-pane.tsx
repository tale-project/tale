'use client';

import RFB, { type RFBEventDetail } from '@novnc/novnc';
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { useMatch } from '@tanstack/react-router';
import { useAction } from 'convex/react';
import { MonitorPlay, MonitorOff, RefreshCw, RotateCcw, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { api } from '@/convex/_generated/api';
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
function buildScreencastUrl(threadId: string, control: boolean): string {
  const scheme = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  return `${scheme}${window.location.host}/screencast/${encodeURIComponent(
    threadId,
  )}${control ? '?control=1' : ''}`;
}

// X11 keysyms for the synthetic paste chord (noVNC's `KeyTable` isn't importable
// — the package exports only `RFB`). `Control_L` + lowercase `v`.
const XK_CONTROL_L = 0xffe3;
const XK_V = 0x76;

/** A Ctrl+V (Win/Linux) or Cmd+V (macOS) press. Match on the physical key
 *  (`code`) so layout doesn't matter, and exclude AltGr combos. */
function isPasteChord(e: KeyboardEvent): boolean {
  if (e.code !== 'KeyV' || e.altKey) return false;
  return e.ctrlKey || e.metaKey;
}

/**
 * Push the host clipboard into the remote browser, then paste it. `readText()`
 * runs synchronously inside the user-gesture keydown (before any await), so the
 * browser permits the read. `clipboardPasteFrom` writes its `ClientCutText`
 * bytes first on the same socket — x11vnc doesn't advertise extended-clipboard
 * caps, so it's the inline path — and the synthesized Ctrl+V follows, so the
 * remote `CLIPBOARD` is set before the paste keystroke lands (race-free). The
 * chord is self-contained (we suppressed the physical one) so it works even when
 * the host modifier is Cmd, which never maps to a Linux paste on its own.
 */
async function bridgeHostPaste(rfb: RFB): Promise<void> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch (err) {
    // Permission denied / non-secure context / unsupported browser — the human
    // can still type the value in. Surface it, don't swallow.
    console.warn('[live-browser] clipboard read failed; paste skipped', err);
    return;
  }
  if (!text) return;
  rfb.clipboardPasteFrom(text);
  rfb.sendKey(XK_CONTROL_L, 'ControlLeft', true);
  rfb.sendKey(XK_V, 'KeyV', true);
  rfb.sendKey(XK_V, 'KeyV', false);
  rfb.sendKey(XK_CONTROL_L, 'ControlLeft', false);
}

/**
 * Bridge the host clipboard to/from the remote browser while the human is in
 * control. Read-only viewers never get this (defense-in-depth on top of
 * `rfb.viewOnly`, which already makes `clipboardPasteFrom`/`sendKey` no-ops).
 *
 *  - host → remote: intercept the paste chord in the capture phase on
 *    `container` (the parent of noVNC's `<canvas>`, whose own keydown listener
 *    is in the bubble phase) so the physical Ctrl/Cmd+V never reaches noVNC —
 *    a raw forward would paste stale/empty content. `bridgeHostPaste` drives it.
 *  - remote → host: mirror the remote's `ServerCutText` (noVNC's `clipboard`
 *    event) onto the host clipboard, best-effort.
 *
 * Returns a teardown that removes both listeners.
 */
function attachClipboardBridge(rfb: RFB, container: HTMLElement): () => void {
  const handlePasteKeydown = (e: KeyboardEvent) => {
    if (!isPasteChord(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    void bridgeHostPaste(rfb);
  };
  const handleRemoteClipboard = (event: CustomEvent<RFBEventDetail>) => {
    const text = event.detail?.text;
    if (!text) return;
    navigator.clipboard.writeText(text).catch((err) => {
      console.warn('[live-browser] clipboard write to host failed', err);
    });
  };

  container.addEventListener('keydown', handlePasteKeydown, true);
  rfb.addEventListener('clipboard', handleRemoteClipboard);

  return () => {
    container.removeEventListener('keydown', handlePasteKeydown, true);
    rfb.removeEventListener('clipboard', handleRemoteClipboard);
  };
}

interface ScreencastViewportProps {
  threadId: string;
  /** Whether the agent's session is actively running a turn / warm. */
  sessionActive: boolean;
  /** When true, connect for human takeover (`?control=1` → writable x11vnc) and
   * let the canvas receive pointer/keyboard input. Default false = read-only
   * mirror. The oracle still gates the grant server-side; a denied control
   * request silently falls back to a read-only stream. */
  control: boolean;
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
  control,
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
      rfb = new RFB(container, buildScreencastUrl(threadId, control), {});
      // In control mode the human drives — let RFB send pointer/keyboard and
      // focus on click; otherwise it's a strictly read-only mirror.
      rfb.viewOnly = !control;
      rfb.scaleViewport = true;
      rfb.clipViewport = true;
      rfb.focusOnClick = control;
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

    // Clipboard bridge only while the human is driving — read-only viewers get
    // no input path at all (the `clipboardPasteFrom`/`sendKey` calls are also
    // no-ops under `viewOnly`, so this is belt-and-suspenders).
    const detachClipboard = control
      ? attachClipboardBridge(rfb, container)
      : undefined;

    return () => {
      rfb?.removeEventListener('connect', handleConnect);
      rfb?.removeEventListener('disconnect', handleDisconnect);
      rfb?.removeEventListener('securityfailure', handleSecurityFailure);
      detachClipboard?.();
      try {
        rfb?.disconnect();
      } catch (err) {
        // disconnect() can throw if the socket never opened — log, don't mask
        // the unmount.
        console.warn('[live-browser] RFB disconnect during cleanup', err);
      }
      rfbRef.current = null;
    };
    // `control` is a dep: flipping take/return control must reconnect the WS to
    // the right (writable vs read-only) endpoint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, connectNonce, control]);

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
      {/* The RFB canvas mounts inside here. In read-only mode
          `pointer-events-none` is defense-in-depth on top of
          `rfb.viewOnly = true`; in control mode the human is driving, so the
          canvas must receive pointer/keyboard events. */}
      <div
        ref={containerRef}
        className={
          control
            ? 'absolute inset-0 size-full'
            : 'pointer-events-none absolute inset-0 size-full'
        }
        aria-label={
          control
            ? t('liveBrowser.ariaLabelControl', {
                defaultValue: 'Live browser — you are controlling it',
              })
            : t('liveBrowser.ariaLabel', {
                defaultValue: 'Live view of the agent’s browser (read-only)',
              })
        }
      />

      {/* Screen-reader status while the live frames are flowing (the canvas
          itself conveys nothing to AT). */}
      {status === 'streaming' && (
        <span className="sr-only" role="status" aria-live="polite">
          {t('liveBrowser.streaming', { defaultValue: 'Live' })}
        </span>
      )}

      {status === 'connecting' && (
        <Row gap={0} justify="center" className="absolute inset-0">
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
        </Row>
      )}

      {status === 'disconnected' && (
        <Row gap={0} justify="center" className="absolute inset-0 p-8">
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
        </Row>
      )}

      {status === 'error' && (
        <Row gap={0} justify="center" className="absolute inset-0 p-8">
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
        </Row>
      )}
    </div>
  );
}

/** The full open-pane body: header (with the "View only" badge) + the live
 *  stream surface. Shared by the desktop resizable pane and the mobile sheet. */
function LiveBrowserBody({ threadId }: { threadId: string }) {
  const { t } = useT('chat');
  const { close, control } = useLiveBrowser();

  // "Active" = there's something worth streaming: a turn is actively running,
  // or the sandbox is warm (`active`). A `stopped`/`creating`/`degraded`
  // session (or no live op) shows the gated empty state instead of opening a
  // socket that would only stare at a black frame.
  const state = useThreadSandboxState(threadId);
  const progress = useSessionProgress(threadId);
  const running =
    progress?.status === 'running' && progress?.agentIdleAt == null;
  const sessionActive = running || state?.status === 'active';

  // Manual "Reset browser" — the last-resort recovery for a wedged browser the
  // automatic self-heal (lock hygiene + recycle) couldn't unstick. It WIPES the
  // persistent profile, so the agent is signed out of every site it had logged
  // into — hence the destructive confirm. Auto-recovery preserves logins; this
  // does not.
  const resetBrowser = useAction(
    api.node_only.sandbox.workspace_files.resetThreadBrowser,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const handleReset = useCallback(async () => {
    setResetting(true);
    try {
      await resetBrowser({ threadId });
      setConfirmOpen(false);
    } catch (err) {
      // Surface, don't swallow — the dialog stays open so the user can retry.
      console.error('[live-browser] reset failed', err);
    } finally {
      setResetting(false);
    }
  }, [resetBrowser, threadId]);

  return (
    <>
      <Row gap={2} justify="between" className="border-border border-b p-3">
        <Row gap={2} className="min-w-0">
          <MonitorPlay
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
          <span className="truncate text-sm font-medium">
            {t('liveBrowser.title', { defaultValue: 'Live browser' })}
          </span>
          {control ? (
            <span className="border-primary/40 text-primary bg-primary/10 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
              {t('liveBrowser.controlling', {
                defaultValue: 'You’re in control',
              })}
            </span>
          ) : (
            <span className="border-border text-muted-foreground bg-muted/60 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
              {t('liveBrowser.viewOnly', { defaultValue: 'View only' })}
            </span>
          )}
        </Row>
        {/* Rendered in every variant. On desktop it's the pane's close; in the
            mobile Sheet (`embedded`) it replaces the Sheet's own absolute
            top-right close (suppressed via `hideClose`) so the close affordance
            stays aligned with this header row. */}
        <Row gap={1} className="shrink-0">
          {/* Reset browser — only while a session is live (nothing to reset
              otherwise). Recovery of last resort; wipes saved logins. */}
          {sessionActive && (
            <Tooltip
              content={t('liveBrowser.reset', {
                defaultValue: 'Reset browser (clears logins)',
              })}
              side="bottom"
            >
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setConfirmOpen(true)}
                aria-label={t('liveBrowser.reset', {
                  defaultValue: 'Reset browser (clears logins)',
                })}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </Tooltip>
          )}
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
        </Row>
      </Row>

      <Stack gap={0} className="min-h-0 flex-1">
        <ScreencastViewport
          threadId={threadId}
          sessionActive={sessionActive}
          control={control}
        />
      </Stack>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        variant="destructive"
        title={t('liveBrowser.resetConfirmTitle', {
          defaultValue: 'Reset browser?',
        })}
        description={t('liveBrowser.resetConfirmBody', {
          defaultValue:
            'Restarts the browser with a clean profile and signs out of every site the agent logged into. Use this only if the browser is stuck and won’t recover on its own.',
        })}
        confirmText={t('liveBrowser.resetConfirmAction', {
          defaultValue: 'Reset browser',
        })}
        isLoading={resetting}
        onConfirm={handleReset}
      />
    </>
  );
}

/** Mobile/embedded variant — renders just the body (no resizable shell). The
 *  caller (the chat Sheet) supplies the panel chrome. Shares one RFB host →
 *  only one WebSocket. */
export function LiveBrowserMobileBody({ threadId }: { threadId: string }) {
  return (
    <Stack gap={0} className="h-full min-h-0">
      <LiveBrowserBody threadId={threadId} />
    </Stack>
  );
}

/**
 * Read-only right-side pane streaming the live external-agent browser over
 * noVNC. Clones the WorkspaceFilesPane shell: resizable 320–720px (default
 * ~480), a collapse-to-48px strip with a vertical label, a `border-l` left
 * edge, a drag handle, and `React.memo`. Gated at the mount site: chat.tsx only
 * mounts this when `useSandboxPanesAvailable` is true (external-agent thread
 * with a session). The noVNC bundle is code-split via `lazyComponent` at the
 * import site.
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

  // No threadId → nothing to stream (the mount site also gates availability).
  if (!threadId) return null;

  // Collapsed: hidden on mobile (the Sheet takes over below `md`), a vertical
  // strip on desktop so the pane is one click away after the user closes it.
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => open()}
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
