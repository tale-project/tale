// Tale Sandbox Spawner — HTTP entrypoint.
//
// Routes:
//   GET  /health                       — 200 if docker daemon reachable.
//   POST /v1/drain, GET /v1/drain-status — HMAC-auth, in-place rolling-deploy
//                                        control (control-routes.ts).
//   POST/GET/DELETE /v1/sessions[...]  — HMAC-auth, persistent session API
//                                        (create/get/list/destroy/exec/cancel).
//
// Every route but /health is verified against the REQUIRED shared secret
// (request-auth.ts; loadConfig fails closed without SANDBOX_TOKEN).
//
// Every sandbox run is a session; the per-org session budgets live platform-side
// (governance `sandbox_quota`), bounded by the host cap `SANDBOX_MAX_SESSIONS`.

import { createHostBackend, createSessionBackend } from './backend/index.ts';
import { CapacityReader } from './capacity.ts';
import { installSignalHandlers, startPeriodicSweep } from './cleanup.ts';
import { loadConfig } from './config.ts';
import { ControlRoutes } from './control-routes.ts';
import { makeHealthProbe } from './health-probe.ts';
import { jsonResponse } from './http-util.ts';
import { createRequestAuth } from './request-auth.ts';
import { SessionRoutes } from './session/session-routes.ts';

const cfg = loadConfig();
// Host lifecycle backend (docker | kubernetes), chosen once at boot. Constructing
// it has no side effects; init() runs the docker lock + boot sweep in main().
const backend = createHostBackend(cfg);

// Session lifecycle is separate from host boot/health. Construct once after
// the deploy control routes are ready; both Docker and Kubernetes implement it.
let sessionRoutes: SessionRoutes | null = null;
function getSessionRoutes(): SessionRoutes {
  if (sessionRoutes === null) {
    // controlRoutes is module-scope below; this closure only runs from main()
    // (after module init), and a draining spawner must never adopt a session
    // its replacement created — the same rule as the sweep tick.
    sessionRoutes = new SessionRoutes(
      cfg,
      createSessionBackend(cfg),
      () => controlRoutes.isDraining,
    );
  }
  return sessionRoutes;
}

// The one HMAC verifier every state-changing route runs through. The shared
// secret is REQUIRED (loadConfig fails closed), so there is no unsigned mode.
const auth = createRequestAuth(cfg.sandboxToken, cfg.maxRequestBodyBytes);

// Deploy control (drain / drain-status + the max-linger self-reap anchor). The
// sandbox tier is a SINGLE container that deploys roll in-place via a
// serialized drain — see control-routes.ts. The status probe peeks at the
// session subsystem without constructing it.
const controlRoutes = new ControlRoutes(auth, () => sessionRoutes);
const capacity = new CapacityReader(cfg, () =>
  getSessionRoutes().pendingCreates(),
);

// A single execution's stray async error must not take down the long-running
// spawner that's serving other requests. Per-request paths already try/catch;
// this is the backstop. (The k8s backend's aborted log/exec streams under Bun
// are the most likely source — handled at the source too, but logged here if
// one escapes.)
process.on('unhandledRejection', (reason) => {
  console.error('[sandbox] unhandledRejection (surviving):', reason);
});

// Cache the backend liveness probe so the compose healthcheck (every 10s)
// doesn't fork a subprocess on every hit. 60s is well under the watchdog
// cutoff and short enough that a daemon recycle surfaces within one
// healthcheck cycle of the user noticing. Concurrent probes share ONE
// backend call (health-probe.ts) — a slow probe against a wedged daemon
// used to spawn a new `docker version` child per overlapping healthcheck.
const HEALTH_PROBE_TTL_MS = 60_000;
const probeHealth = makeHealthProbe(
  () => backend.health(),
  HEALTH_PROBE_TTL_MS,
);

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

// Session routes. All authenticated identically to the control routes (HMAC
// over METHOD\npath\nts\nnonce\nsha256(body) — request-auth.ts); the per-route
// handlers live in session/session-routes.ts.
const SESSION_ID = '([a-zA-Z0-9_-]{1,64})';
const EXEC_ID = '([a-zA-Z0-9_-]{1,64})';
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

async function handleSessionRoutes(
  req: Request,
  url: URL,
): Promise<Response | null> {
  const path = url.pathname;

  // POST /v1/sessions (create)
  if (req.method === 'POST' && path === '/v1/sessions') {
    // Draining: refuse NEW sessions so they land on the replacement container.
    // Execs on existing sessions (below) keep working until the session is reaped.
    if (controlRoutes.isDraining) {
      return jsonResponse(
        {
          error: 'draining',
          message: 'spawner is draining; create once the rollout completes',
        },
        503,
      );
    }
    const r = await auth.readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleCreate(r.body);
  }
  // GET /v1/sessions?organizationId=… (list)
  if (req.method === 'GET' && path === '/v1/sessions') {
    const r = await auth.readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleList(
      url.searchParams.get('organizationId'),
    );
  }
  // POST /v1/sessions/:id/exec  (must precede the bare :id matcher)
  const execMatch = path.match(SESSION_EXEC_RE);
  if (req.method === 'POST' && execMatch) {
    const r = await auth.readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleExec(req, execMatch[1] ?? '', r.body);
  }
  // POST /v1/sessions/:id/exec/:execId/cancel
  const cancelMatch = path.match(SESSION_EXEC_CANCEL_RE);
  if (req.method === 'POST' && cancelMatch) {
    const r = await auth.readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleExecCancel(
      cancelMatch[1] ?? '',
      cancelMatch[2] ?? '',
    );
  }
  // GET /v1/sessions/:id/exec/:execId/attach (SSE reconnect)
  const attachMatch = path.match(SESSION_EXEC_ATTACH_RE);
  if (req.method === 'GET' && attachMatch) {
    const r = await auth.readAndAuth(req);
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
    const r = await auth.readAndAuth(req);
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
    const r = await auth.readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleExecStatus(
      execStatusMatch[1] ?? '',
      execStatusMatch[2] ?? '',
    );
  }
  // PATCH /v1/sessions/:id/env
  const envMatch = path.match(SESSION_ENV_RE);
  if (req.method === 'PATCH' && envMatch) {
    const r = await auth.readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleEnvPatch(envMatch[1] ?? '', r.body);
  }
  // PATCH /v1/sessions/:id/pin — toggle always-on (idle/TTL reaper exemption)
  const pinMatch = path.match(SESSION_PIN_RE);
  if (req.method === 'PATCH' && pinMatch) {
    const r = await auth.readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleSetPinned(pinMatch[1] ?? '', r.body);
  }
  // POST /v1/sessions/:id/files/stage
  const stageMatch = path.match(SESSION_FILES_STAGE_RE);
  if (req.method === 'POST' && stageMatch) {
    const r = await auth.readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleFilesStage(stageMatch[1] ?? '', r.body);
  }
  // POST /v1/sessions/:id/files/delete
  const deleteMatch = path.match(SESSION_FILES_DELETE_RE);
  if (req.method === 'POST' && deleteMatch) {
    const r = await auth.readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleFilesDelete(deleteMatch[1] ?? '', r.body);
  }
  // GET /v1/sessions/:id/files/content?path=  (must precede the bare files RE)
  const fileContentMatch = path.match(SESSION_FILES_CONTENT_RE);
  if (req.method === 'GET' && fileContentMatch) {
    const r = await auth.readAndAuth(req);
    if ('error' in r) return r.error;
    return getSessionRoutes().handleFileContent(
      fileContentMatch[1] ?? '',
      url.searchParams.get('path') ?? '',
    );
  }
  // GET /v1/sessions/:id/files?path=  (directory listing)
  const filesMatch = path.match(SESSION_FILES_RE);
  if (req.method === 'GET' && filesMatch) {
    const r = await auth.readAndAuth(req);
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
      const r = await auth.readAndAuth(req);
      if ('error' in r) return r.error;
      return getSessionRoutes().handleGet(id);
    }
    if (req.method === 'DELETE') {
      const r = await auth.readAndAuth(req);
      if ('error' in r) return r.error;
      // `?if_idle=1` — conditional destroy for janitor callers: no-op with
      // {busy:true} while the session still has a live exec. The query string
      // is HMAC-covered (authorize signs pathname + search).
      return getSessionRoutes().handleDestroy(id, {
        ifIdle: url.searchParams.get('if_idle') === '1',
      });
    }
  }
  return null;
}

export async function router(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/health') {
    return handleHealth();
  }
  if (req.method === 'GET' && url.pathname === '/v1/capacity') {
    const signed = await auth.readAndAuth(req);
    if ('error' in signed) return signed.error;
    const organizationId = url.searchParams.get('organizationId');
    if (
      organizationId === null ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(organizationId)
    ) {
      return jsonResponse({ error: 'bad_request' }, 400);
    }
    try {
      return jsonResponse(await capacity.forOrganization(organizationId), 200, {
        'cache-control': 'no-store',
      });
    } catch (error) {
      console.warn('[sandbox] capacity observation failed:', error);
      return jsonResponse({ error: 'capacity_unavailable' }, 503, {
        'cache-control': 'no-store',
      });
    }
  }
  // Deploy control routes — HMAC-gated inside ControlRoutes; null = not one.
  const controlResponse = await controlRoutes.handle(req, url);
  if (controlResponse !== null) return controlResponse;
  if (url.pathname.startsWith('/v1/sessions')) {
    const sessionResponse = await handleSessionRoutes(req, url);
    if (sessionResponse !== null) return sessionResponse;
  }
  return jsonResponse({ error: 'not_found' }, 404);
}

async function main(): Promise<void> {
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

  // Warm the runtime image so the first session create doesn't pay a
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
  // start the TTL/idle reaper. A transient backend failure is retried on
  // the next sweep; it must not prevent the control service from starting.
  let stopSessionSweep: (() => void) | undefined;
  try {
    const sessions = getSessionRoutes();
    await sessions.adoptExisting();
    const sweepTimer = setInterval(() => {
      // Re-adopt before reaping so a session missed at boot (a `docker ps` /
      // apiserver blip) or created by a peer replica becomes routable and
      // reapable within one interval instead of lingering unregistered. NOT
      // while draining: a lingering spawner must never adopt (and later
      // linger-reap) the sessions its replacement is creating.
      const tick = controlRoutes.isDraining
        ? Promise.resolve()
        : sessions.adoptExisting();
      void tick
        .then(() => sessions.sweepExpired())
        .catch((err) => {
          console.warn('[sandbox.session] periodic sweep failed:', err);
        });
      // Max-linger self-reap (CLI-independent safety net): if this spawner has
      // been draining longer than the linger TTL, reclaim its session compute
      // ourselves so a deploy that died mid-roll can't pin compute forever.
      // Stop-only (workspace preserved); the spawner stays up — `restart:
      // unless-stopped` would otherwise bounce a self-exit into a zombie
      // spawner. The deploy's teardown removes this container. One-shot
      // (ControlRoutes.takeLingerReap fires exactly once).
      if (controlRoutes.takeLingerReap(cfg.session.maxLingerMs)) {
        void sessions
          .stopAllSessions()
          .then((n) => {
            if (n > 0) {
              console.warn(
                `[sandbox.session] max-linger (${cfg.session.maxLingerMs}ms) reached while draining — reclaimed ${n} session(s); workspaces preserved for resume.`,
              );
            }
            return null;
          })
          .catch((err) => {
            console.warn('[sandbox.session] linger reap failed:', err);
          });
      }
    }, SESSION_SWEEP_INTERVAL_MS);
    stopSessionSweep = () => clearInterval(sweepTimer);
  } catch (err) {
    console.warn('[sandbox.session] session subsystem startup failed:', err);
  }

  const server = Bun.serve({
    port: cfg.port,
    // Bun's default idleTimeout is 10 s, which kills long SSE streams during
    // silent install phases. 255 is Bun's max — combined with the in-stream
    // keepalive in session exec streams, this gives a generous backstop without
    // disabling the timeout entirely.
    idleTimeout: 255,
    fetch: (req) => {
      return router(req).catch((err) => {
        console.error('[sandbox] handler error:', err);
        return jsonResponse({ error: 'internal', message: String(err) }, 500);
      });
    },
  });

  installSignalHandlers(() => {
    try {
      void server.stop();
    } catch (err) {
      console.warn('[sandbox] server.stop() during shutdown failed:', err);
    }
  }, backend);

  console.log(
    `[sandbox] spawner listening on :${server.port}; runtime=${cfg.runtimeTier}${cfg.dockerInContainer ? '+dind' : ''}; image=${cfg.runtimeImage}; maxSessions=${cfg.session.maxSessions}; tokenAuth=on`,
  );

  // Keep the periodic sweep handles so they aren't GC'd.
  void stopPeriodic;
  void stopSessionSweep;
}

if (import.meta.main)
  main().catch((err: unknown) => {
    // Without this catch a boot failure after init() (e.g. Bun.serve EADDRINUSE)
    // would be swallowed by the global unhandledRejection backstop above,
    // leaving a zombie process that neither listens nor exits.
    console.error('[sandbox] FATAL: boot failed:', err);
    process.exit(1);
  });
