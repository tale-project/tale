'use client';

import RFB, { type RFBEventDetail } from '@novnc/novnc';
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { useMatch } from '@tanstack/react-router';
import { useAction } from 'convex/react';
import {
  Eye,
  Hand,
  MonitorPlay,
  MonitorOff,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import type { ChatPaneDescriptor } from '@/app/features/chat/components/chat-panel/types';
import {
  useAutoOpen,
  useRegisterPane,
} from '@/app/features/chat/components/chat-panel/use-register-pane';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import {
  useSessionProgress,
  useThreadSandboxState,
} from '../../chat/hooks/queries';
import { useLiveBrowser } from './live-browser-context';

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
    // Never construct RFB during SSR or before the host node mounts. Also bail
    // when the session is inactive — the host div is unmounted in that state
    // (see the `!sessionActive` early-return below), so a live socket would be
    // orphaned. Depending on `sessionActive` makes the cleanup below run (and
    // disconnect) the moment a running session stops.
    const container = containerRef.current;
    if (!container || typeof window === 'undefined' || !sessionActive)
      return undefined;

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
    // the right (writable vs read-only) endpoint. `sessionActive` is a dep so
    // the socket is torn down when a running session stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, connectNonce, control, sessionActive]);

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
            ? t('liveBrowser.ariaLabelControl')
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
            <Button variant="secondary" icon={RefreshCw} onClick={reconnect}>
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
            <Button variant="secondary" icon={RefreshCw} onClick={reconnect}>
              {t('liveBrowser.retry', { defaultValue: 'Retry' })}
            </Button>
          </Stack>
        </Row>
      )}
    </div>
  );
}

/**
 * Take / release writable control of the live browser. Control is ALWAYS
 * available to the thread owner while a session is active — it is not gated on
 * an agent `request_human_control` handoff (that flow still exists for the agent
 * to ASK and to pause/resume). Flipping this reconnects the RFB socket to the
 * writable (`control=1`) or read-only endpoint via the context `control` state.
 * Once in control, drive the browser's own menu bar (omnibox, back/forward,
 * reload) directly in the stream.
 */
function ControlToggle({
  control,
  onToggle,
}: {
  control: boolean;
  onToggle: (next: boolean) => void;
}) {
  const { t } = useT('chat');
  return control ? (
    <Button
      variant="secondary"
      size="sm"
      icon={Eye}
      onClick={() => onToggle(false)}
    >
      {t('liveBrowser.releaseControl', { defaultValue: 'Release control' })}
    </Button>
  ) : (
    <Button
      variant="primary"
      size="sm"
      icon={Hand}
      onClick={() => onToggle(true)}
    >
      {t('liveBrowser.takeControl', { defaultValue: 'Take control' })}
    </Button>
  );
}

/** The open-pane body: the live stream surface + the reset confirm dialog. The
 *  control badge and Reset button are lifted to the registrar's header actions;
 *  this body owns only the RFB host (which must stay mounted) and the dialog. */
function LiveBrowserBody({
  threadId,
  sessionActive,
  control,
  confirmOpen,
  onConfirmOpenChange,
  resetting,
  onReset,
}: {
  threadId: string;
  sessionActive: boolean;
  control: boolean;
  confirmOpen: boolean;
  onConfirmOpenChange: (open: boolean) => void;
  resetting: boolean;
  onReset: () => void;
}) {
  const { t } = useT('chat');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreencastViewport
        threadId={threadId}
        sessionActive={sessionActive}
        control={control}
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={onConfirmOpenChange}
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
        onConfirm={onReset}
      />
    </div>
  );
}

interface LiveBrowserPaneProps {
  /** True on external-agent threads with a session — the content signal. */
  available: boolean;
}

/**
 * Live-browser pane. A registrar: it owns the session/reset state and publishes
 * a descriptor (the RFB stream body + a control badge / Reset header action) to
 * the unified right panel. The RFB WebSocket lives in `ScreencastViewport`,
 * which the shell keeps mounted across tab switches. The `control` mode is
 * still driven through `LiveBrowserProvider` (the take-control card flips it),
 * and `useAutoOpen` opens the tab when `control` is requested or content lands.
 */
function LiveBrowserPaneComponent({ available }: LiveBrowserPaneProps) {
  const { t } = useT('chat');
  const threadMatch = useMatch({
    from: '/dashboard/$id/chat/$threadId',
    shouldThrow: false,
  });
  const threadId = threadMatch?.params?.threadId;

  const { control, isOpen, setControl } = useLiveBrowser();

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
      await resetBrowser({ threadId: threadId ?? '' });
      setConfirmOpen(false);
    } catch (err) {
      // Surface, don't swallow — the dialog stays open so the user can retry.
      console.error('[live-browser] reset failed', err);
    } finally {
      setResetting(false);
    }
  }, [resetBrowser, threadId]);

  const hasContent = !!threadId && available;
  // Unlike Plan/Canvas, the sandbox panes don't auto-open on mere availability
  // (that's true for the whole sandbox thread and would fight Files↔Browser).
  // They open on an explicit signal: the `+`-menu flipping the context `isOpen`,
  // or a take-control request flipping `control`. Track the two edges
  // SEPARATELY — a single `isOpen || control` boolean only fires once, so a
  // control request after the menu was already opened (then minimized) would
  // never re-surface the pane. Each call owns its own rising-edge detection.
  useAutoOpen('browser', hasContent && isOpen);
  useAutoOpen('browser', hasContent && control);

  const descriptor = useMemo<ChatPaneDescriptor | null>(() => {
    if (!hasContent || !threadId) return null;

    const headerActions: ReactNode = (
      <>
        {sessionActive && (
          <ControlToggle control={control} onToggle={setControl} />
        )}
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
      </>
    );

    return {
      id: 'browser',
      icon: MonitorPlay,
      label: t('liveBrowser.title', { defaultValue: 'Live browser' }),
      ariaLabel: t('liveBrowser.toggleLabel', { defaultValue: 'Live browser' }),
      hasContent: true,
      headerActions,
      body: (
        <LiveBrowserBody
          threadId={threadId}
          sessionActive={sessionActive}
          control={control}
          confirmOpen={confirmOpen}
          onConfirmOpenChange={setConfirmOpen}
          resetting={resetting}
          onReset={() => void handleReset()}
        />
      ),
    };
  }, [
    hasContent,
    threadId,
    t,
    control,
    setControl,
    sessionActive,
    confirmOpen,
    resetting,
    handleReset,
  ]);

  useRegisterPane(descriptor);

  return null;
}

export const LiveBrowserPane = memo(LiveBrowserPaneComponent);
