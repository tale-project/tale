// Managed-Chromium control for the live-browser view (TALE_BROWSER_CDP=1).
//
// The entrypoint launches ONE headed Chromium with a CDP endpoint on loopback
// 127.0.0.1:9222 under a self-healing supervisor (see entrypoint.sh
// _browser_supervise). This module is runnerd's interface to that browser:
//   - probeCdp():   the REAL liveness check — /json/version answers even when
//                   the browser is wedged, so we actually open a CDP session and
//                   round-trip Target.getTargets. Distinguishes "HTTP up" from
//                   "agent can drive it".
//   - restartBrowser(): recycle a hung-but-alive browser WITHOUT losing logins —
//                   SIGKILL the supervised Chromium (the supervisor respawns it
//                   with lock hygiene), then wait until a CDP session attaches.
//   - resetBrowser():  the explicit "Reset browser" — drop a reset flag the
//                   supervisor honors (wipe the persistent profile while the
//                   browser is down), then SIGKILL + wait. Loses logins.
//   - closePages():  reset tabs back to a clean state on turn-stop without
//                   touching cookies (logins persist).
//
// node: built-ins + the global WebSocket (Node 24) only — this daemon is bundled
// with `bun build --target=node` and carries NO npm deps (no playwright-core).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { get as httpGet, type IncomingMessage } from 'node:http';

import type {
  RunnerdBrowserClosePages,
  RunnerdBrowserRecycle,
} from './protocol.ts';

/** Loopback CDP endpoint the entrypoint's managed Chromium listens on.
 * Read per-call from the environment (like screencast-tunnel's target host/port)
 * so unit tests can point this at a stub server without re-importing. */
const CDP_HOST = '127.0.0.1';
const CDP_PORT = 9222;
function cdpHost(): string {
  return process.env.TALE_CDP_HOST ?? CDP_HOST;
}
function cdpPort(): number {
  return Number(process.env.TALE_CDP_PORT ?? '') || CDP_PORT;
}

/** Control dir shared with the entrypoint's _browser_supervise (tmpfs): the
 * live pid (written by the supervisor) and the reset flag (written here). Must
 * match TALE_BROWSER_CTRL in entrypoint.sh; overridable for tests. */
function ctrlDir(): string {
  return process.env.TALE_BROWSER_CTRL_DIR ?? '/tmp/tale-browser';
}
function pidFile(): string {
  return `${ctrlDir()}/pid`;
}
function resetFlag(): string {
  return `${ctrlDir()}/reset`;
}

/** Default probe timeout — short, so a wedge surfaces fast (the per-exec
 * pre-flight and /healthz both call this). */
const PROBE_TIMEOUT_MS = 3_000;
/** How long restart/reset wait for a fresh CDP session before giving up (the
 * caller proceeds regardless — a never-ready browser must not block an exec). */
const RECYCLE_WAIT_MS = 15_000;
const RECYCLE_POLL_MS = 500;

export interface CdpHealth {
  /** True only when a CDP session attached AND answered a protocol round-trip. */
  healthy: boolean;
  /** Open page targets (tabs) at probe time; 0 when unhealthy. */
  tabs: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GET an HTTP path on the CDP endpoint, returning the decoded text body (or
 * rejecting on transport error / timeout / non-2xx). Bounds the request with an
 * explicit timer rather than the node:http `timeout` socket option (Bun's
 * http.get doesn't honor it; the manual timer works under both Bun and Node). */
function httpGetText(path: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const req = httpGet(
      { host: cdpHost(), port: cdpPort(), path },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (status < 200 || status >= 300) {
            finish(() => reject(new Error(`GET ${path} -> ${status}`)));
            return;
          }
          finish(() => resolve(body));
        });
        res.on('error', (err) => finish(() => reject(err)));
      },
    );
    const timer = setTimeout(
      () =>
        finish(() => {
          req.destroy();
          reject(new Error(`GET ${path} timed out`));
        }),
      timeoutMs,
    );
    req.on('error', (err) => finish(() => reject(err)));
  });
}

async function httpGetJson<T>(path: string, timeoutMs: number): Promise<T> {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return JSON.parse(await httpGetText(path, timeoutMs)) as T;
}

function closeQuietly(ws: WebSocket | undefined): void {
  try {
    ws?.close();
  } catch (err) {
    console.warn('[runnerd] cdp ws close failed:', err);
  }
}

/** Open a CDP session to the browser-level WebSocket and round-trip a single
 * method, resolving its `result`. This is the authoritative liveness signal:
 * a wedged browser's HTTP listener still answers /json/version, but this
 * round-trip hangs (→ timeout → unhealthy). */
function cdpRoundTrip(
  wsUrl: string,
  method: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws: WebSocket | undefined;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeQuietly(ws);
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`cdp ${method} timed out`))),
      timeoutMs,
    );
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      return;
    }
    ws.addEventListener('open', () => {
      try {
        ws?.send(JSON.stringify({ id: 1, method }));
      } catch (err) {
        finish(() =>
          reject(err instanceof Error ? err : new Error(String(err))),
        );
      }
    });
    ws.addEventListener('message', (ev: MessageEvent) => {
      if (settled) return;
      try {
        const data = typeof ev.data === 'string' ? ev.data : '';
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        const msg = JSON.parse(data) as { id?: number; result?: unknown };
        if (msg.id === 1) {
          const result =
            msg.result && typeof msg.result === 'object'
              ? // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
                (msg.result as Record<string, unknown>)
              : {};
          finish(() => resolve(result));
        }
      } catch (err) {
        // A non-JSON frame on a CDP socket is unexpected; log but keep waiting
        // for the id:1 response (the timer still bounds the wait).
        console.warn('[runnerd] cdp frame parse failed:', err);
      }
    });
    ws.addEventListener('error', () =>
      finish(() => reject(new Error(`cdp ${method} ws error`))),
    );
    ws.addEventListener('close', () =>
      finish(() => reject(new Error(`cdp ${method} ws closed early`))),
    );
  });
}

interface CdpTargetInfo {
  type?: string;
  id?: string;
}

/** REAL CDP liveness: resolve the browser WS endpoint, then round-trip
 * Target.getTargets. Any failure (HTTP down, no WS url, wedged → timeout) is
 * reported as unhealthy — callers decide whether to recycle/log. */
export async function probeCdp(
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<CdpHealth> {
  try {
    const version = await httpGetJson<{ webSocketDebuggerUrl?: string }>(
      '/json/version',
      timeoutMs,
    );
    const wsUrl = version.webSocketDebuggerUrl;
    if (!wsUrl) return { healthy: false, tabs: 0 };
    const result = await cdpRoundTrip(wsUrl, 'Target.getTargets', timeoutMs);
    const infos = Array.isArray(result.targetInfos)
      ? // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        (result.targetInfos as CdpTargetInfo[])
      : [];
    const tabs = infos.filter((t) => t.type === 'page').length;
    return { healthy: true, tabs };
  } catch {
    // Unhealthy is the meaningful result here (not a swallowed error): the
    // caller probes precisely to branch on health, and may recycle + re-probe.
    return { healthy: false, tabs: 0 };
  }
}

function readPid(): number | null {
  try {
    const n = Number(readFileSync(pidFile(), 'utf8').trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    // No pidfile yet (browser never launched / control dir absent) — nothing
    // to signal; the caller treats this as "no managed browser".
    return null;
  }
}

function killBrowser(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch (err) {
    // ESRCH = already gone (the supervisor will respawn anyway); anything else
    // is worth surfacing. `'code' in err` narrows without an assertion.
    const gone =
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      err.code === 'ESRCH';
    if (!gone) console.warn('[runnerd] browser SIGKILL failed:', err);
  }
}

/** Wait until a CDP session attaches again (or the deadline passes). Returns
 * the final probe — the caller proceeds regardless of `healthy`. */
async function waitHealthy(deadlineMs: number): Promise<CdpHealth> {
  const start = Date.now();
  for (;;) {
    const health = await probeCdp(Math.min(PROBE_TIMEOUT_MS, deadlineMs));
    if (health.healthy) return health;
    if (Date.now() - start > deadlineMs) return health;
    await delay(RECYCLE_POLL_MS);
  }
}

/** Recycle a wedged-but-alive browser WITHOUT losing logins: SIGKILL the
 * supervised Chromium (the supervisor respawns it, clearing the singleton lock
 * first), then wait for a fresh CDP session. */
export async function restartBrowser(
  waitMs: number = RECYCLE_WAIT_MS,
): Promise<RunnerdBrowserRecycle> {
  const pid = readPid();
  if (pid !== null) killBrowser(pid);
  const health = await waitHealthy(waitMs);
  return { signalled: pid !== null, ready: health.healthy, tabs: health.tabs };
}

/** Explicit "Reset browser": drop a flag the supervisor honors (wipe the
 * persistent profile while the browser is DOWN — atomic, no relaunch race),
 * then SIGKILL + wait. Loses saved logins, by design (manual recovery of last
 * resort for a genuinely corrupt profile). */
export async function resetBrowser(
  waitMs: number = RECYCLE_WAIT_MS,
): Promise<RunnerdBrowserRecycle> {
  try {
    mkdirSync(ctrlDir(), { recursive: true });
    writeFileSync(resetFlag(), '1');
  } catch (err) {
    // If we can't drop the flag the supervisor won't wipe the profile; still
    // attempt the restart so at least a recycle happens.
    console.warn('[runnerd] could not write browser reset flag:', err);
  }
  const pid = readPid();
  if (pid !== null) killBrowser(pid);
  const health = await waitHealthy(waitMs);
  return { signalled: pid !== null, ready: health.healthy, tabs: health.tabs };
}

/** Close all open page targets (tabs) via the CDP HTTP API, leaving cookies /
 * localStorage intact (logins persist). Used on turn-stop so a runaway/hung tab
 * from the stopped turn can't wedge the next turn's attach. Best-effort. */
export async function closePages(): Promise<RunnerdBrowserClosePages> {
  let list: CdpTargetInfo[];
  try {
    list = await httpGetJson<CdpTargetInfo[]>('/json/list', PROBE_TIMEOUT_MS);
  } catch (err) {
    console.warn('[runnerd] browser closePages: /json/list failed:', err);
    return { closed: 0 };
  }
  const pages = (Array.isArray(list) ? list : []).filter(
    (t): t is { type: string; id: string } =>
      t.type === 'page' && typeof t.id === 'string',
  );
  let closed = 0;
  for (const p of pages) {
    try {
      await httpGetText(
        `/json/close/${encodeURIComponent(p.id)}`,
        PROBE_TIMEOUT_MS,
      );
      closed += 1;
    } catch (err) {
      console.warn('[runnerd] browser closePages: close target failed:', err);
    }
  }
  return { closed };
}
