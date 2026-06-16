// Tale Sandbox Spawner — HTTP entrypoint.
//
// Routes:
//   GET  /health                       — 200 if docker daemon reachable.
//   POST /v1/execute                   — HMAC-auth, one ephemeral container.
//   POST /v1/cancel/:id                — HMAC-auth, kills in-flight container.
//   POST/GET/DELETE /v1/sessions[...]  — HMAC-auth, persistent session API
//                                        (create/get/list/destroy/exec/cancel).
//
// Concurrency: in-process semaphore at SANDBOX_MAX_CONCURRENT. 429 over cap.

import {
  verify,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  NONCE_HEADER,
} from './auth.ts';
import {
  createBackend,
  createSessionBackend,
  type HealthResult,
} from './backend/index.ts';
import { installSignalHandlers, startPeriodicSweep } from './cleanup.ts';
import { loadConfig } from './config.ts';
import { jsonResponse, readBodyCapped } from './http-util.ts';
import {
  createScreencastWebSocketHandler,
  type ScreencastWsData,
} from './session/screencast-relay.ts';
import { SessionRoutes } from './session/session-routes.ts';
import {
  cancelExecution,
  executeRequest,
  inFlightSize,
  isInFlight,
  registerInFlight,
  unregisterInFlight,
} from './spawn.ts';
import { sseResponse } from './sse.ts';
import { validateExecuteRequest } from './validate-request.ts';

const cfg = loadConfig();
// Execution backend (docker | kubernetes), chosen once at boot. Constructing
// it has no side effects; init() runs the docker lock + boot sweep in main().
const backend = createBackend(cfg);
// Session subsystem (persistent sessions). Lazily constructed on first session
// route hit so a kubernetes deployment (session backend not yet implemented)
// only errors when sessions are actually used, never at boot.
let sessionRoutes: SessionRoutes | null = null;
function getSessionRoutes(): SessionRoutes {
  if (sessionRoutes === null) {
    sessionRoutes = new SessionRoutes(cfg, createSessionBackend(cfg));
  }
  return sessionRoutes;
}

// A single execution's stray async error must not take down the long-running
// spawner that's serving other requests. Per-request paths already try/catch;
// this is the backstop. (The k8s backend's aborted log/exec streams under Bun
// are the most likely source — handled at the source too, but logged here if
// one escapes.)
process.on('unhandledRejection', (reason) => {
  console.error('[sandbox] unhandledRejection (surviving):', reason);
});

function authorize(body: string, req: Request): Response | null {
  if (cfg.sandboxToken === null) return null; // dev opt-in mode
  const url = new URL(req.url);
  // Verify against path + query: clients sign the full request path (see
  // session_client's signedHeaders), and the query carries semantics worth
  // binding (e.g. /files?path=…). Query-less requests are unaffected
  // (url.search is the empty string).
  const result = verify(
    req.method,
    url.pathname + url.search,
    body,
    req.headers.get(SIGNATURE_HEADER),
    req.headers.get(TIMESTAMP_HEADER),
    req.headers.get(NONCE_HEADER),
    cfg.sandboxToken,
  );
  if (!result.ok) {
    // Log the discriminator server-side so operators can diagnose, but DON'T
    // surface it in the response body — distinguishing "wrong signature" from
    // "clock skew" lets an attacker calibrate (audit finding R2-B5).
    console.warn(`[sandbox.auth] unauthorized (${result.reason})`);
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  return null;
}

// Cache the backend liveness probe so the compose healthcheck (every 10s)
// doesn't fork a subprocess on every hit. 60s is well under the watchdog
// cutoff and short enough that a daemon recycle surfaces within one
// healthcheck cycle of the user noticing.
const HEALTH_PROBE_TTL_MS = 60_000;
let healthProbeCache:
  | { ok: true; detail: string; expiresAt: number }
  | { ok: false; error: string; expiresAt: number }
  | null = null;

async function probeHealth(): Promise<HealthResult> {
  const now = Date.now();
  if (healthProbeCache !== null && healthProbeCache.expiresAt > now) {
    return healthProbeCache.ok
      ? { ok: true, detail: healthProbeCache.detail }
      : { ok: false, error: healthProbeCache.error };
  }
  const result = await backend.health();
  healthProbeCache = { ...result, expiresAt: now + HEALTH_PROBE_TTL_MS };
  return result;
}

async function handleHealth(): Promise<Response> {
  const health = await probeHealth();
  if (!health.ok) {
    return jsonResponse({ status: 'unhealthy', error: health.error }, 503);
  }
  // `dockerServerVersion` is preserved as the field name for the docker
  // backend (the compose healthcheck only checks HTTP 200, not the body).
  return jsonResponse(
    { status: 'ok', dockerServerVersion: health.detail },
    200,
  );
}

async function handleExecute(req: Request): Promise<Response> {
  let body: string;
  try {
    body = await readBodyCapped(req, cfg.maxRequestBodyBytes);
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'httpStatus' in err
        ? Number((err as { httpStatus: unknown }).httpStatus)
        : 400;
    return jsonResponse(
      {
        error: status === 413 ? 'payload_too_large' : 'bad_request',
        message: err instanceof Error ? err.message : String(err),
      },
      status === 413 ? 413 : 400,
    );
  }
  const authFail = authorize(body, req);
  if (authFail) return authFail;

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(body);
  } catch (err) {
    return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
  }
  // Full runtime validation of every field — defends downstream spawn /
  // docker-args code from malformed types that would otherwise crash mid
  // pipeline. The previous spot-check of executionId was the only gate
  // (audit finding R2-B3).
  const validated = validateExecuteRequest(parsedUnknown);
  if (!validated.ok) {
    return jsonResponse(
      { error: 'bad_request', message: validated.error },
      400,
    );
  }
  const parsed = validated.request;

  // Per-request INFO so docker logs tale-sandbox surfaces what's been
  // dispatched. The spawner used to only log warn/error which made
  // every "did the request even get here?" question require code
  // inspection — see pre-stage debugging session 2026-05-23.
  console.info(
    `[sandbox.execute] id=${parsed.executionId} org=${parsed.organizationId} lang=${parsed.language} ${
      parsed.steps !== undefined
        ? `steps=${JSON.stringify(parsed.steps)}`
        : `entry=${parsed.entryPath}`
    } files=${parsed.files?.length ?? 0} priorDownloads=${parsed.priorOutputDownloads?.length ?? 0} preAllocSlots=${parsed.outputUploadSlots.length}`,
  );

  // Reject duplicates explicitly: the in-flight registry is keyed by
  // executionId, and overwriting the entry would silently detach the
  // original AbortController from cancelExecution. The Convex action
  // never retries the same executionId in practice, so a duplicate
  // POST is almost always a misconfigured caller or a malicious replay.
  if (isInFlight(parsed.executionId)) {
    return jsonResponse(
      {
        error: 'duplicate',
        message: `executionId ${parsed.executionId} is already in flight`,
      },
      409,
    );
  }

  // Concurrency check AFTER validation so a malformed request can't
  // consume a slot.
  if (inFlightSize() >= cfg.maxConcurrent) {
    return jsonResponse(
      {
        error: 'busy',
        message: `Spawner at concurrency cap (${cfg.maxConcurrent})`,
      },
      429,
      { 'retry-after': '5' },
    );
  }

  // Register AFTER validation; the spawn-side registry is the single source
  // of truth (previously had a separate server-side Set that could drift).
  // The execution may also be aborted by the caller disconnecting — wire a
  // request-signal abort to cancelExecution so a closed SSE stream tears
  // the container down promptly.
  const abortHandler = () => {
    cancelExecution(parsed.executionId);
  };
  req.signal.addEventListener('abort', abortHandler, { once: true });
  registerInFlight(parsed.executionId);

  // Keepalive + stream-close handling live in sseResponse (extracted to
  // sse.ts so the session exec route shares them).
  return sseResponse(async ({ send }) => {
    try {
      const result = await executeRequest(backend, cfg, parsed, {
        onPhase: (e) => send('phase', e),
        // Live stdout/stderr tail. Per-line for stdout (PHASE markers
        // stripped); per-chunk for stderr. Coalescing is left to the
        // platform-side action because that's where the cost of "too
        // many mutations" actually lives — SSE event overhead is small.
        onStdoutDelta: (text) => send('stdout', { text }),
        onStderrDelta: (text) => send('stderr', { text }),
      });
      send('result', result);
    } catch (err) {
      send('error', {
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      unregisterInFlight(parsed.executionId);
      req.signal.removeEventListener('abort', abortHandler);
    }
  });
}

async function handleCancel(req: Request, id: string): Promise<Response> {
  let body: string;
  try {
    body = await readBodyCapped(req, cfg.maxRequestBodyBytes);
  } catch (err) {
    return jsonResponse(
      {
        error: 'bad_request',
        message: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }
  const authFail = authorize(body, req);
  if (authFail) return authFail;
  // Locally owned → abort-only; execute() does its final reads then cleans up.
  if (isInFlight(id)) {
    const killed = cancelExecution(id);
    return jsonResponse({ killed }, 200);
  }
  // Not ours — REMOTE path: the backend addresses the runtime by
  // deterministic name, so a cancel landing on any replica still kills a run
  // owned by another one (the docs' cancel-from-any-replica contract; the
  // owner's run then resolves as failed/HARVEST_READ_FAILED, not cancelled).
  const found = await backend.cancel(id);
  return jsonResponse({ killed: found }, found ? 200 : 404);
}

// Cancel route uses the same id alphabet as the execute payload so a
// Convex doc id (contains g-z) is not silently rejected. Centralized in
// wire.ts; one regex covers spawn.ts, docker-args.ts, and this router.
const CANCEL_ROUTE_RE = /^\/v1\/cancel\/([a-zA-Z0-9_-]{1,64})$/;

// Session routes. All authenticated identically to /v1/execute (HMAC over
// METHOD\npath\nts\nsha256(body)); the per-route handlers live in
// session/session-routes.ts.
const SESSION_ID = '([a-zA-Z0-9_-]{1,64})';
const EXEC_ID = '([a-zA-Z0-9_-]{1,64})';
// Read-only live browser view: a WebSocket the platform opens, bridged to the
// session's runnerd raw-VNC tunnel (see session/screencast-relay.ts). Matched
// BEFORE the bare :id matcher (it carries a trailing /screencast segment).
const SESSION_BROWSER_SCREENCAST_RE = new RegExp(
  `^/v1/sessions/${SESSION_ID}/screencast$`,
);
const SESSION_ONE_RE = new RegExp(`^/v1/sessions/${SESSION_ID}$`);
const SESSION_EXEC_RE = new RegExp(`^/v1/sessions/${SESSION_ID}/exec$`);
const SESSION_EXEC_CANCEL_RE = new RegExp(
  `^/v1/sessions/${SESSION_ID}/exec/${EXEC_ID}/cancel$`,
);
const SESSION_EXEC_ATTACH_RE = new RegExp(
  `^/v1/sessions/${SESSION_ID}/exec/${EXEC_ID}/attach$`,
);
const SESSION_EXEC_STDIN_RE = new RegExp(
  `^/v1/sessions/${SESSION_ID}/exec/${EXEC_ID}/stdin$`,
);
const SESSION_EXEC_STATUS_RE = new RegExp(
  `^/v1/sessions/${SESSION_ID}/exec/${EXEC_ID}$`,
);
const SESSION_ENV_RE = new RegExp(`^/v1/sessions/${SESSION_ID}/env$`);
const SESSION_PIN_RE = new RegExp(`^/v1/sessions/${SESSION_ID}/pin$`);
// Managed live-browser recycle: restart (preserve logins), reset (wipe
// profile), close-pages (reset tabs on turn-stop). Browser-view sessions only.
const SESSION_BROWSER_RE = new RegExp(
  `^/v1/sessions/${SESSION_ID}/browser/(restart|reset|close-pages)$`,
);
const SESSION_FILES_STAGE_RE = new RegExp(
  `^/v1/sessions/${SESSION_ID}/files/stage$`,
);
const SESSION_FILES_DELETE_RE = new RegExp(
  `^/v1/sessions/${SESSION_ID}/files/delete$`,
);
const SESSION_FILES_CONTENT_RE = new RegExp(
  `^/v1/sessions/${SESSION_ID}/files/content$`,
);
const SESSION_FILES_RE = new RegExp(`^/v1/sessions/${SESSION_ID}/files$`);

// How often the session TTL/idle reaper runs.
const SESSION_SWEEP_INTERVAL_MS = 60_000;

/** Body-cap + HMAC for a session route that needs the raw body; returns the
 * verified body string or an error Response. */
async function readAndAuth(
  req: Request,
): Promise<{ body: string } | { error: Response }> {
  let body: string;
  try {
    body = await readBodyCapped(req, cfg.maxRequestBodyBytes);
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'httpStatus' in err
        ? Number((err as { httpStatus: unknown }).httpStatus)
        : 400;
    return {
      error: jsonResponse(
        { error: status === 413 ? 'payload_too_large' : 'bad_request' },
        status === 413 ? 413 : 400,
      ),
    };
  }
  const authFail = authorize(body, req);
  if (authFail) return { error: authFail };
  return { body };
}

async function handleSessionRoutes(
  req: Request,
  url: URL,
): Promise<Response | null> {
  const path = url.pathname;

  // POST /v1/sessions (create)
  if (req.method === 'POST' && path === '/v1/sessions') {
    const r = await readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleCreate(r.body);
  }
  // GET /v1/sessions?organizationId=… (list)
  if (req.method === 'GET' && path === '/v1/sessions') {
    const r = await readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleList(
      url.searchParams.get('organizationId'),
    );
  }
  // POST /v1/sessions/:id/exec  (must precede the bare :id matcher)
  const execMatch = path.match(SESSION_EXEC_RE);
  if (req.method === 'POST' && execMatch) {
    const r = await readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleExec(req, execMatch[1] ?? '', r.body);
  }
  // POST /v1/sessions/:id/exec/:execId/cancel
  const cancelMatch = path.match(SESSION_EXEC_CANCEL_RE);
  if (req.method === 'POST' && cancelMatch) {
    const r = await readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleExecCancel(
      cancelMatch[1] ?? '',
      cancelMatch[2] ?? '',
    );
  }
  // GET /v1/sessions/:id/exec/:execId/attach (SSE reconnect)
  const attachMatch = path.match(SESSION_EXEC_ATTACH_RE);
  if (req.method === 'GET' && attachMatch) {
    const r = await readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleExecAttach(
      req,
      attachMatch[1] ?? '',
      attachMatch[2] ?? '',
    );
  }
  // POST /v1/sessions/:id/exec/:execId/stdin (held-open stdin append/EOF)
  const stdinMatch = path.match(SESSION_EXEC_STDIN_RE);
  if (req.method === 'POST' && stdinMatch) {
    const r = await readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleExecStdin(
      stdinMatch[1] ?? '',
      stdinMatch[2] ?? '',
      r.body,
    );
  }
  // GET /v1/sessions/:id/exec/:execId — per-exec status (no stream); the
  // restorative recovery watchdog's liveness probe. Must follow the cancel/
  // attach/stdin matchers (they carry a trailing segment) and the bare-:id
  // create matcher (no execId).
  const execStatusMatch = path.match(SESSION_EXEC_STATUS_RE);
  if (req.method === 'GET' && execStatusMatch) {
    const r = await readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleExecStatus(
      execStatusMatch[1] ?? '',
      execStatusMatch[2] ?? '',
    );
  }
  // PATCH /v1/sessions/:id/env
  const envMatch = path.match(SESSION_ENV_RE);
  if (req.method === 'PATCH' && envMatch) {
    const r = await readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleEnvPatch(envMatch[1] ?? '', r.body);
  }
  // PATCH /v1/sessions/:id/pin — toggle always-on (idle/TTL reaper exemption)
  const pinMatch = path.match(SESSION_PIN_RE);
  if (req.method === 'PATCH' && pinMatch) {
    const r = await readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleSetPinned(pinMatch[1] ?? '', r.body);
  }
  // POST /v1/sessions/:id/browser/{restart,reset,close-pages}
  const browserMatch = path.match(SESSION_BROWSER_RE);
  if (req.method === 'POST' && browserMatch) {
    const r = await readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleBrowserControl(
      browserMatch[1] ?? '',
      browserMatch[2] ?? '',
    );
  }
  // POST /v1/sessions/:id/files/stage
  const stageMatch = path.match(SESSION_FILES_STAGE_RE);
  if (req.method === 'POST' && stageMatch) {
    const r = await readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleFilesStage(stageMatch[1] ?? '', r.body);
  }
  // POST /v1/sessions/:id/files/delete
  const deleteMatch = path.match(SESSION_FILES_DELETE_RE);
  if (req.method === 'POST' && deleteMatch) {
    const r = await readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleFilesDelete(deleteMatch[1] ?? '', r.body);
  }
  // GET /v1/sessions/:id/files/content?path=  (must precede the bare files RE)
  const fileContentMatch = path.match(SESSION_FILES_CONTENT_RE);
  if (req.method === 'GET' && fileContentMatch) {
    const r = await readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleFileContent(
      fileContentMatch[1] ?? '',
      url.searchParams.get('path') ?? '',
    );
  }
  // GET /v1/sessions/:id/files?path=  (directory listing)
  const filesMatch = path.match(SESSION_FILES_RE);
  if (req.method === 'GET' && filesMatch) {
    const r = await readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleFilesList(
      filesMatch[1] ?? '',
      url.searchParams.get('path') ?? '.',
    );
  }
  // GET / DELETE /v1/sessions/:id
  const oneMatch = path.match(SESSION_ONE_RE);
  if (oneMatch) {
    const id = oneMatch[1] ?? '';
    if (req.method === 'GET') {
      const r = await readAndAuth(req);
      if ('error' in r) return r.error;
      return getSessionRoutes().handleGet(id);
    }
    if (req.method === 'DELETE') {
      const r = await readAndAuth(req);
      if ('error' in r) return r.error;
      return getSessionRoutes().handleDestroy(id);
    }
  }
  return null;
}

// The browser-facing WebSocket handler (one per process). It bridges each WS
// to the session's runnerd raw-VNC tunnel; the resolver is the registry-cache
// lookup the route layer owns (a WS that reached here already passed HMAC).
const screencastWsHandler = createScreencastWebSocketHandler((sessionId) =>
  getSessionRoutes().resolveScreencastTarget(sessionId),
);

/**
 * GET /v1/sessions/:id/screencast — authenticate (HMAC over an EMPTY body,
 * since the GET has no body), then hand the connection to Bun's WebSocket
 * server. Returns:
 *  - a 401/500 `Response` to send as-is (auth failed / upgrade refused), or
 *  - `undefined` when `server.upgrade` succeeded and Bun has taken over the
 *    socket (fetch must return undefined in that case).
 *
 * Lives in `fetch` rather than `router()` because `server.upgrade` needs the
 * live `Server` instance, which only exists inside the Bun.serve callback.
 */
function handleScreencastUpgrade(
  req: Request,
  server: import('bun').Server<ScreencastWsData>,
  sessionId: string,
): Response | undefined {
  // HMAC over the empty body — same gate as every other session route (the
  // files/content GET signs sha256('') identically). The signature covers
  // pathname+search, so the `?control=1` query (see below) is authenticated:
  // the platform only sets it after its oracle authorized + leased control.
  const authFail = authorize('', req);
  if (authFail) return authFail;
  // The spawner does NOT decide control — it relays the platform's already-
  // authorized flag so runnerd dials the writable x11vnc. Parse it from the
  // (signed) query and carry it on ws.data.
  const control = new URL(req.url).searchParams.get('control') === '1';
  const upgraded = server.upgrade(req, { data: { sessionId, control } });
  if (upgraded) return undefined; // Bun owns the socket now.
  return jsonResponse({ error: 'upgrade_failed' }, 500);
}

async function router(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/health') {
    return handleHealth();
  }
  if (req.method === 'POST' && url.pathname === '/v1/execute') {
    return handleExecute(req);
  }
  const cancelMatch = url.pathname.match(CANCEL_ROUTE_RE);
  if (req.method === 'POST' && cancelMatch) {
    return handleCancel(req, cancelMatch[1] ?? '');
  }
  if (url.pathname.startsWith('/v1/sessions')) {
    const sessionResponse = await handleSessionRoutes(req, url);
    if (sessionResponse !== null) return sessionResponse;
  }
  return jsonResponse({ error: 'not_found' }, 404);
}

async function main(): Promise<void> {
  // Token policy: SANDBOX_TOKEN is opt-in verification. Unset = skip HMAC
  // (mirrors the Convex-side behavior); set = enforce. Production deploys
  // auto-mint SANDBOX_TOKEN via the CLI's ensure-env helper. Log a single
  // warn at boot so operators see the state.
  if (cfg.sandboxToken === null) {
    console.warn(
      '[sandbox] SANDBOX_TOKEN is unset — HMAC verification disabled. Set SANDBOX_TOKEN to enable request authentication.',
    );
  }

  // Backend boot setup. For the docker backend this acquires the cross-process
  // host-session lock (refuses to start if another live spawner shares the
  // hostSessionRoot — audit finding R2-B5) then runs the boot orphan sweep.
  // Throwing here is fatal.
  try {
    await backend.init();
  } catch (err) {
    console.error('[sandbox] FATAL: backend init failed:', err);
    process.exit(1);
  }

  // Warm the runtime image so the first /v1/execute call doesn't pay a
  // cold registry round-trip. Non-fatal: if the daemon is unreachable at
  // boot the spawner still starts (its /health probe will surface the
  // real problem). Failure is logged inside the backend.
  // `SANDBOX_SKIP_IMAGE_WARMUP=1` skips the pull entirely — used by the
  // local `bun run dev` script where the runtime image is built ad-hoc
  // and never published to a registry, so the pull is guaranteed to 404.
  if (process.env.SANDBOX_SKIP_IMAGE_WARMUP !== '1') {
    await backend.warmImage();
  }

  const stopPeriodic = startPeriodicSweep(backend, cfg);

  // Session subsystem: re-adopt running session containers into the registry
  // (the registry is a cache; backend objects are the source of truth) and
  // start the TTL/idle reaper. Best-effort + guarded so a kubernetes
  // deployment (session backend not yet implemented) doesn't fail boot.
  let stopSessionSweep: (() => void) | undefined;
  try {
    const sessions = getSessionRoutes();
    await sessions.adoptExisting();
    const sweepTimer = setInterval(() => {
      void sessions.sweepExpired().catch((err) => {
        console.warn('[sandbox.session] periodic sweep failed:', err);
      });
    }, SESSION_SWEEP_INTERVAL_MS);
    stopSessionSweep = () => clearInterval(sweepTimer);
  } catch (err) {
    console.warn(
      '[sandbox.session] session subsystem not started (backend unsupported?):',
      err,
    );
  }

  const server = Bun.serve<ScreencastWsData>({
    port: cfg.port,
    // Bun's default idleTimeout is 10 s, which kills long SSE streams during
    // silent install phases. 255 is Bun's max — combined with the in-stream
    // keepalive in /v1/execute, this gives a generous backstop without
    // disabling the timeout entirely.
    idleTimeout: 255,
    fetch: (req, srv) => {
      // Intercept the screencast WS upgrade before the generic router: the
      // upgrade needs the live Server instance (only available here). Every
      // other route flows through router() unchanged.
      const url = new URL(req.url);
      const screencastMatch =
        req.method === 'GET'
          ? url.pathname.match(SESSION_BROWSER_SCREENCAST_RE)
          : null;
      if (screencastMatch) {
        try {
          return handleScreencastUpgrade(req, srv, screencastMatch[1] ?? '');
        } catch (err) {
          console.error('[sandbox] screencast upgrade error:', err);
          return jsonResponse({ error: 'internal', message: String(err) }, 500);
        }
      }
      return router(req).catch((err) => {
        console.error('[sandbox] handler error:', err);
        return jsonResponse({ error: 'internal', message: String(err) }, 500);
      });
    },
    websocket: screencastWsHandler,
  });

  installSignalHandlers(() => {
    try {
      void server.stop();
    } catch (err) {
      console.warn('[sandbox] server.stop() during shutdown failed:', err);
    }
  }, backend);

  console.log(
    `[sandbox] spawner listening on :${server.port}; runtime=${cfg.runtimeTier}${cfg.dockerInContainer ? '+dind' : ''}; image=${cfg.runtimeImage}; maxConcurrent=${cfg.maxConcurrent}; tokenAuth=${cfg.sandboxToken !== null ? 'on' : 'OFF (dev opt-in)'}`,
  );

  // Keep the periodic sweep handles so they aren't GC'd.
  void stopPeriodic;
  void stopSessionSweep;
}

main().catch((err: unknown) => {
  // Without this catch a boot failure after init() (e.g. Bun.serve EADDRINUSE)
  // would be swallowed by the global unhandledRejection backstop above,
  // leaving a zombie process that neither listens nor exits.
  console.error('[sandbox] FATAL: boot failed:', err);
  process.exit(1);
});
