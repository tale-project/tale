// runnerd — the in-container control daemon for persistent sandbox sessions.
//
// The control process of a session container (entrypoint dispatch `daemon`),
// run under the image's tini init so the orphans that cancelled exec trees and
// browser recycles leave behind are reaped rather than left as zombies. Listens
// on :8200 inside tale-sandbox-net; the spawner is its only client and proxies
// in-session operations here over HTTP. Auth is the per-session token in
// x-tale-runnerd-token (derived spawner-side as HMAC(SANDBOX_TOKEN,
// "runnerd-v1:"+sessionId); empty disables the check in unsigned dev mode).
//
// Bundled to a single dist/runnerd.mjs with `bun build --target=node` and run
// by the image's Node 24 — so this file uses only node: built-ins, no deps.

import { timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

import {
  closePages,
  probeCdp,
  resetBrowser,
  restartBrowser,
} from './browser-control.ts';
import { EnvStore } from './env-store.ts';
import { ExecManager } from './exec-manager.ts';
import {
  deletePaths,
  listDir,
  readWorkspaceFile,
  stageFiles,
  type StageItem,
} from './file-ops.ts';
import { readJsonBody } from './http-body.ts';
import {
  RUNNERD_CONSUMER_BUFFER_MAX_BYTES,
  RUNNERD_MAX_LIVE_EXECS,
  RUNNERD_PORT,
  RUNNERD_TOKEN_HEADER,
  type RunnerdExecEvent,
  type RunnerdExecRequest,
  type RunnerdStdinWriteRequest,
} from './protocol.ts';
import {
  getActiveScreencasts,
  handleScreencastUpgrade,
} from './screencast-tunnel.ts';

const FILE_READ_MAX_BYTES = 20 * 1024 * 1024;

/** Live-browser view is on (operator flag, set by the spawner via the session
 * container env). Gates the CDP health field, the /browser/* recycle routes,
 * and the per-exec pre-flight self-heal. */
const BROWSER_VIEW = process.env.TALE_BROWSER_CDP === '1';
/** Short probe inside /healthz — the idle reaper polls it with a 5s budget. */
const HEALTHZ_PROBE_TIMEOUT_MS = 1_500;
/** How long the per-exec pre-flight waits for a recycled browser to come back
 * before starting the exec anyway (a never-ready browser must not block it). */
const PREFLIGHT_WAIT_MS = 10_000;

/** De-dupe concurrent pre-flights: up to RUNNERD_MAX_LIVE_EXECS execs can start
 * at once, and on a wedged browser each would otherwise fire its own probe +
 * 10s recycle in parallel (amplified, slower). They share this one in-flight
 * promise instead, so a single recycle serves the whole burst. */
let preflightInFlight: Promise<void> | null = null;

/** Before an agent exec on a browser-view session, ensure the managed Chromium
 * can actually accept a CDP session — recycle it if wedged. This turns the
 * per-turn "fresh Playwright MCP against the same hung browser" loop into a
 * self-healing one, so the wedge is gone before the agent ever attaches.
 * Best-effort + bounded: any failure just proceeds (the agent has guidance). */
async function preflightBrowser(): Promise<void> {
  // A recycle is already running — wait for it rather than starting another.
  if (preflightInFlight) {
    await preflightInFlight;
    return;
  }
  const run = (async () => {
    try {
      const health = await probeCdp();
      if (health.healthy) return;
      console.warn(
        '[runnerd] pre-flight: managed browser CDP unhealthy — recycling before exec',
      );
      const r = await restartBrowser(PREFLIGHT_WAIT_MS);
      if (!r.ready) {
        console.warn(
          '[runnerd] pre-flight: browser still not ready after recycle — proceeding',
        );
      }
    } catch (err) {
      console.warn(
        '[runnerd] pre-flight browser check failed (continuing):',
        err,
      );
    }
  })();
  preflightInFlight = run;
  try {
    await run;
  } finally {
    preflightInFlight = null;
  }
}

const TOKEN = process.env.TALE_RUNNERD_TOKEN ?? '';
const bootedAtMs = Date.now();
let lastActivityAtMs = bootedAtMs;
const touch = () => {
  lastActivityAtMs = Date.now();
};

let seedEnv: Record<string, string> | undefined;
if (process.env.TALE_SESSION_ENV) {
  try {
    const parsed: unknown = JSON.parse(process.env.TALE_SESSION_ENV);
    if (parsed !== null && typeof parsed === 'object') {
      // EnvStore drops non-string values + deny-listed names; coerce here so
      // the type stays Record<string,string> without an assertion.
      const seed: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') seed[k] = v;
      }
      seedEnv = seed;
    }
  } catch (err) {
    console.error('[runnerd] TALE_SESSION_ENV is not valid JSON:', err);
  }
}
const envStore = new EnvStore(seedEnv);
const execManager = new ExecManager(envStore, touch);

function tokenOk(req: IncomingMessage): boolean {
  if (TOKEN === '') return true; // unsigned dev mode
  const got = req.headers[RUNNERD_TOKEN_HEADER];
  const value = Array.isArray(got) ? (got[0] ?? '') : (got ?? '');
  const a = Buffer.from(value, 'utf8');
  const b = Buffer.from(TOKEN, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  // A 413 needs no `Connection: close`: `readJsonBody` drains the refused
  // body before the route answers, so the keep-alive connection is clean
  // for the next request (closing it under a half-sent upload hangs Bun
  // 1.3.12's fetch — the spawner — on its next call).
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Validate a POST /env body without a cast. `set` (if present) must be a
 * Record<string,string>; `unset` (if present) must be string[]. Returns null on
 * any malformed shape so the handler answers 400 before reaching envStore.patch
 * (which re-enforces the deny-list + caps but assumes well-typed entries). */
function parseEnvPatch(
  v: unknown,
): { set?: Record<string, string>; unset?: string[] } | null {
  if (!isObject(v)) return null;
  let set: Record<string, string> | undefined;
  if (v.set !== undefined) {
    if (!isObject(v.set)) return null;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.set)) {
      if (typeof val !== 'string') return null;
      out[k] = val;
    }
    set = out;
  }
  let unset: string[] | undefined;
  if (v.unset !== undefined) {
    if (!Array.isArray(v.unset)) return null;
    // Type-predicate filter mirrors validate-session's command parsing — a
    // clean string[] with no assertion. Reject if any entry was non-string.
    const strings = v.unset.filter((e): e is string => typeof e === 'string');
    if (strings.length !== v.unset.length) return null;
    unset = strings;
  }
  return { set, unset };
}

async function handleExec(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Shape is re-validated field-by-field inside execManager.run (execId,
  // command/shell, cwd); this is trust-then-validate at the boundary.
  const body = await readJsonBody(req);
  if (!body.ok) {
    sendJson(res, body.status, { error: body.error });
    return;
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = body.value as RunnerdExecRequest;
  if (execManager.liveCount() >= RUNNERD_MAX_LIVE_EXECS) {
    // Report through the NDJSON channel so the spawner's parser handles it
    // uniformly with pre-spawn failures.
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    const fail: RunnerdExecEvent = {
      t: 'fail',
      code: 'EXEC_LIMIT',
      message: `live exec cap ${RUNNERD_MAX_LIVE_EXECS} reached`,
    };
    res.end(`${JSON.stringify(fail)}\n`);
    return;
  }
  // Self-heal a wedged managed browser before the agent attaches to it (no-op
  // on non-browser sessions). Bounded; never blocks the exec on failure.
  if (BROWSER_VIEW) await preflightBrowser();
  res.writeHead(200, {
    'content-type': 'application/x-ndjson',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  });
  let primaryClosed = false;
  const emit = (event: RunnerdExecEvent) => {
    if (primaryClosed) return; // stop writing to a dead socket (no log spam)
    // Backpressure ceiling: a stalled-but-attached consumer must not let the
    // response buffer grow without bound. Stop writing to THIS consumer past the
    // cap; it reconnects via /attach?sinceSeq= and replays from the ring.
    if (res.writableLength > RUNNERD_CONSUMER_BUFFER_MAX_BYTES) {
      primaryClosed = true;
      console.warn(
        `[runnerd] exec stream consumer backpressured past ${RUNNERD_CONSUMER_BUFFER_MAX_BYTES}B — dropping it (reconnect via /attach)`,
      );
      return;
    }
    try {
      res.write(`${JSON.stringify(event)}\n`);
    } catch (err) {
      console.warn('[runnerd] NDJSON write after close:', err);
    }
  };
  // Consumer disconnect: do NOT touch the exec. The child runs detached and is
  // kept alive by its SLIDING deadline (re-armed on every /attach), so a
  // platform action that lost its SSE can reconnect via /attach?sinceSeq= for
  // as long as the window allows — an orphaned exec (no reconnect for the whole
  // window) is the only thing the deadline reaps. We just stop writing here.
  req.on('close', () => {
    primaryClosed = true;
  });
  try {
    await execManager.run(parsed, emit);
  } catch (err) {
    emit({
      t: 'fail',
      code: 'BAD_REQUEST',
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    res.end();
  }
}

const EXEC_CANCEL_RE = /^\/execs\/([a-zA-Z0-9_-]{1,64})\/cancel$/;
const EXEC_ATTACH_RE = /^\/execs\/([a-zA-Z0-9_-]{1,64})\/attach$/;
const EXEC_STDIN_RE = /^\/execs\/([a-zA-Z0-9_-]{1,64})\/stdin$/;
const EXEC_STATUS_RE = /^\/execs\/([a-zA-Z0-9_-]{1,64})$/;

async function handleAttach(
  req: IncomingMessage,
  res: ServerResponse,
  execId: string,
  sinceSeq: number,
): Promise<void> {
  if (!execManager.canAttach(execId)) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/x-ndjson',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  });
  let attachClosed = false;
  const emit = (event: RunnerdExecEvent) => {
    if (attachClosed) return;
    // Same backpressure ceiling as the primary stream (see handleExec): bound a
    // slow attach consumer's buffer; it can reconnect and replay from the ring.
    if (res.writableLength > RUNNERD_CONSUMER_BUFFER_MAX_BYTES) {
      attachClosed = true;
      console.warn(
        `[runnerd] attach consumer backpressured past ${RUNNERD_CONSUMER_BUFFER_MAX_BYTES}B — dropping it (reconnect via /attach)`,
      );
      return;
    }
    try {
      res.write(`${JSON.stringify(event)}\n`);
    } catch (err) {
      console.warn('[runnerd] attach write after close:', err);
    }
  };
  // This attach consumer dropping leaves the exec to its sliding deadline; a
  // further reattach re-arms it. No grace kill here (see handleExec).
  req.on('close', () => {
    attachClosed = true;
  });
  const stream = execManager.attach(execId, emit, sinceSeq);
  if (stream) await stream;
  res.end();
}

async function router(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://runnerd');
  const path = url.pathname;

  // Unauthenticated kubelet probe — returns no session data.
  if (req.method === 'GET' && path === '/readyz') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (!tokenOk(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  if (req.method === 'GET' && path === '/healthz') {
    const body: Record<string, unknown> = {
      ok: true,
      bootedAtMs,
      lastActivityAtMs,
      liveExecs: execManager.liveCount(),
      activeScreencasts: getActiveScreencasts(),
    };
    // Real CDP health (not just "HTTP up") so the spawner's idle reaper doesn't
    // pin a session whose VNC tunnel is open but whose browser is dead, and the
    // pane can show a "recovering" state. Only on browser-view sessions.
    if (BROWSER_VIEW) {
      const health = await probeCdp(HEALTHZ_PROBE_TIMEOUT_MS);
      body.browser = { cdpHealthy: health.healthy, tabs: health.tabs };
    }
    sendJson(res, 200, body);
    return;
  }
  // Managed-browser recycle controls (browser-view sessions only). restart
  // preserves logins (lock hygiene + respawn); reset wipes the profile (manual
  // recovery); close-pages resets tabs on turn-stop without clearing cookies.
  if (req.method === 'POST' && path.startsWith('/browser/')) {
    if (!BROWSER_VIEW) {
      sendJson(res, 200, {
        signalled: false,
        ready: false,
        tabs: 0,
        closed: 0,
      });
      return;
    }
    touch();
    if (path === '/browser/restart') {
      sendJson(res, 200, await restartBrowser());
      return;
    }
    if (path === '/browser/reset') {
      sendJson(res, 200, await resetBrowser());
      return;
    }
    if (path === '/browser/close-pages') {
      sendJson(res, 200, await closePages());
      return;
    }
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  if (req.method === 'POST' && path === '/execs') {
    await handleExec(req, res);
    return;
  }
  const cancelMatch = path.match(EXEC_CANCEL_RE);
  if (req.method === 'POST' && cancelMatch) {
    touch();
    sendJson(res, 200, { killed: execManager.cancel(cancelMatch[1] ?? '') });
    return;
  }
  const attachMatch = path.match(EXEC_ATTACH_RE);
  if (req.method === 'GET' && attachMatch) {
    const sinceSeq = Number(url.searchParams.get('sinceSeq') ?? '0') || 0;
    await handleAttach(req, res, attachMatch[1] ?? '', sinceSeq);
    return;
  }
  const stdinMatch = path.match(EXEC_STDIN_RE);
  if (req.method === 'POST' && stdinMatch) {
    const stdinBody = await readJsonBody(req);
    if (!stdinBody.ok) {
      sendJson(res, stdinBody.status, { error: stdinBody.error });
      return;
    }
    // writeStdin validates the payload (single NDJSON line, size cap).
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const body = stdinBody.value as RunnerdStdinWriteRequest;
    // 200 with a structured body in every reachable case (mirrors /cancel's
    // killed:false) — the caller branches on `reason`, not the status code.
    sendJson(res, 200, execManager.writeStdin(stdinMatch[1] ?? '', body));
    return;
  }
  const statusMatch = path.match(EXEC_STATUS_RE);
  if (req.method === 'GET' && statusMatch) {
    const id = statusMatch[1] ?? '';
    const st = execManager.status(id);
    if (st === null) {
      // Neither live nor recently-retained → gone (evicted past the recent
      // window, or never existed). 404 so the platform reads it as 'gone'.
      sendJson(res, 404, { execId: id, state: 'gone' });
      return;
    }
    sendJson(res, 200, {
      execId: id,
      state: st.state,
      ...(st.state === 'running'
        ? { startedAtMs: st.startedAtMs }
        : { exitCode: st.exitCode }),
    });
    return;
  }
  if (req.method === 'POST' && path === '/env') {
    const envBody = await readJsonBody(req);
    if (!envBody.ok) {
      sendJson(res, envBody.status, { error: envBody.error });
      return;
    }
    const patch = parseEnvPatch(envBody.value);
    if (patch === null) {
      sendJson(res, 400, { error: 'bad_request' });
      return;
    }
    touch();
    const denied = envStore.patch(patch.set, patch.unset);
    sendJson(res, 200, { ok: true, denied });
    return;
  }
  if (req.method === 'POST' && path === '/files/stage') {
    const stageBody = await readJsonBody(req);
    if (!stageBody.ok) {
      sendJson(res, stageBody.status, { error: stageBody.error });
      return;
    }
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const body = stageBody.value as { files?: StageItem[] };
    touch();
    const result = await stageFiles(body.files ?? []);
    sendJson(res, 200, result);
    return;
  }
  if (req.method === 'POST' && path === '/files/delete') {
    const deleteBody = await readJsonBody(req);
    if (!deleteBody.ok) {
      sendJson(res, deleteBody.status, { error: deleteBody.error });
      return;
    }
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const body = deleteBody.value as { paths?: string[] };
    touch();
    const result = await deletePaths(body.paths ?? []);
    sendJson(res, 200, result);
    return;
  }
  if (req.method === 'GET' && path === '/fs/list') {
    const entries = await listDir(url.searchParams.get('path') ?? '.');
    if (entries === null) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    sendJson(res, 200, { entries });
    return;
  }
  if (req.method === 'GET' && path === '/fs/read') {
    const bytes = await readWorkspaceFile(
      url.searchParams.get('path') ?? '',
      FILE_READ_MAX_BYTES,
    );
    if (bytes === null) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(bytes);
    return;
  }
  sendJson(res, 404, { error: 'not_found' });
}

const server = createServer((req, res) => {
  router(req, res).catch((err) => {
    console.error('[runnerd] handler error:', err);
    try {
      sendJson(res, 500, { error: 'internal' });
    } catch {
      // headers already sent on a streaming response
    }
  });
});

// HTTP/1.1 Upgrade → raw VNC tunnel. The spawner opens `GET /screencast` with
// the per-session token; we relay raw bytes to the local x11vnc RFB port (no WS
// framing here — that lives at the platform browser leg). Any other upgrade
// path is closed outright.
server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '/', 'http://runnerd').pathname;
  if (path !== '/screencast') {
    socket.destroy();
    return;
  }
  handleScreencastUpgrade(req, socket, head, { tokenOk, touch });
});
// Bound how long a client may take to send a request (headers + body) so a
// slow/stalled client can't pin a connection for Node's 5-min default. These
// cap request RECEIPT only — not the response, so long-lived exec NDJSON
// streams are unaffected (their bodies are small JSON, read up front).
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;

// SIGTERM → graceful close (the container is being torn down; in-flight execs
// get their process-group SIGTERM from the orchestrator's container stop).
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000);
  });
}

server.listen(RUNNERD_PORT, '0.0.0.0', () => {
  console.log(
    `[runnerd] listening on :${RUNNERD_PORT}; tokenAuth=${TOKEN === '' ? 'OFF (dev)' : 'on'}`,
  );
});
