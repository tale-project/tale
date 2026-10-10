// Tale Sandbox Spawner — HTTP entrypoint.
//
// Routes:
//   GET  /health                       — 200 once boot adoption has run and
//                                        the docker daemon is reachable.
//   POST /v1/drain, GET /v1/drain-status — HMAC-auth, in-place rolling-deploy
//                                        control (control-routes.ts).
//   POST/GET/DELETE /v1/sessions[...]  — HMAC-auth, persistent session API
//                                        (create/get/list/destroy/exec/cancel).
//   GET /v1/workspaces                 — HMAC-auth, workspace inventory for the
//                                        platform's cleanup.
//   DELETE /v1/organizations/:id       — HMAC-auth, a deleted organization's
//                                        remaining sessions and caches.
//
// Every route but /health is verified against the REQUIRED shared secret
// (request-auth.ts; loadConfig fails closed without SANDBOX_TOKEN).
//
// Every sandbox run is a session; the per-org session budgets live platform-side
// (governance `sandbox_quota`), bounded by the host cap `SANDBOX_MAX_SESSIONS`.

import { loadBackends } from './backend/index.ts';
import type { SessionBackend } from './backend/types.ts';
import { CapacityReader } from './capacity.ts';
import { installSignalHandlers, startPeriodicSweep } from './cleanup.ts';
import { loadConfig } from './config.ts';
import { ControlRoutes } from './control-routes.ts';
import { launchSelfUpdate } from './devices/apply.ts';
import { loadDeviceConfig } from './devices/device-config.ts';
import { DeviceAgent } from './devices/device.ts';
import { DeviceHub, serveHub } from './devices/hub.ts';
import { DockerDataDiskProbe, SandboxDiskProbe } from './docker-data-disk.ts';
import {
  flushSandboxErrorReporting,
  handleSandboxRequest,
  initSandboxErrorReporting,
  reportSandboxError,
  sandboxServerError,
} from './error-reporting.ts';
import { makeHealthProbe } from './health-probe.ts';
import { HostDiskProbe } from './host-disk.ts';
import {
  autoSessionCapacity,
  DEFAULT_CPU_PRESSURE_PERCENT,
  HostMemoryProbe,
  memoryReserveBytes,
} from './host-memory.ts';
import { jsonResponse } from './http-util.ts';
import { ImageWarmup } from './image-warmup.ts';
import { createRequestAuth } from './request-auth.ts';
import { BootAdoption } from './session/boot-adoption.ts';
import {
  SessionRoutes,
  unavailableSessionResponse,
} from './session/session-routes.ts';

// Awaited before anything else so a failure from here on is reported; it
// loads the error-reporting SDK only when SENTRY_DSN is set.
await initSandboxErrorReporting();
const cfg = loadConfig();
// Host lifecycle backend (docker | kubernetes), chosen once at boot. Constructing
// it has no side effects; init() runs the docker lock + boot sweep in main().
const { host: backend, createSession: createSessionBackend } =
  await loadBackends(cfg);
const imageWarmup = new ImageWarmup(() => backend.warmImage());
// `SANDBOX_SKIP_IMAGE_WARMUP=1` skips the pull entirely — used by the local
// `bun run dev` script where the runtime image is built ad-hoc and never
// published to a registry, so the pull is guaranteed to 404.
const imageWarmupEnabled = process.env.SANDBOX_SKIP_IMAGE_WARMUP !== '1';
const bootAdoption = new BootAdoption();

// Session lifecycle is separate from host boot/health. Construct once after
// the deploy control routes are ready; both Docker and Kubernetes implement it.
// The Docker host's memory, read where /proc describes it (a local Docker
// spawner or connected device; never Kubernetes or a remote daemon).
const hostMemory =
  cfg.backend === 'docker'
    ? new HostMemoryProbe({
        cpuPressure:
          (cfg.session.cpuPressurePercent ?? DEFAULT_CPU_PRESSURE_PERCENT) > 0,
      })
    : null;
// Keep a floor on the workspace filesystem and the Docker metadata filesystem
// where its existing hostname bind can be verified against the local daemon.
const hostDisk =
  cfg.backend === 'docker'
    ? new SandboxDiskProbe(
        new HostDiskProbe(cfg.hostSessionRoot, cfg.session.minFreeDiskBytes),
        new DockerDataDiskProbe(
          cfg.dockerDataPath === undefined
            ? undefined
            : { path: cfg.dockerDataPath, root: cfg.dockerDataRoot },
          {
            isLocalHost: () =>
              hostMemory?.latest() !== null &&
              hostMemory?.latest() !== undefined,
          },
        ),
        cfg.session.minFreeDiskBytes,
        cfg.dockerDataPath !== undefined,
      )
    : null;
// No SANDBOX_MAX_SESSIONS set: a host whose memory the spawner can read
// gets a capacity sized from it and its CPUs (never below the fixed default
// of 8), and the memory and CPU guards at admission protect the rest. A boot that cannot read
// it yet (a busy daemon after a reboot) sizes on a later sweep.
let capacitySized = hostMemory === null || cfg.session.autoMaxSessions !== true;
async function sizeSessionCapacity(): Promise<void> {
  if (capacitySized || hostMemory === null) return;
  const memory = await hostMemory.read();
  if (memory === null || capacitySized) return;
  capacitySized = true;
  cfg.session.maxSessions = autoSessionCapacity(
    memory.totalBytes,
    memoryReserveBytes(memory.totalBytes, cfg.session.minFreeMemoryBytes),
    cfg.dockerInContainer,
    cfg.dockerWorkloads,
    hostMemory.cpus(),
  );
  const cpus = hostMemory.cpus();
  console.log(
    `[sandbox] session capacity ${cfg.session.maxSessions}, sized from the host's ${Math.round(memory.totalBytes / 1024 ** 3)} GiB${cpus === null ? '' : ` and ${cpus} CPUs`} (set SANDBOX_MAX_SESSIONS to fix it)`,
  );
}

let sessionRoutes: SessionRoutes | null = null;
let sessionBackend: SessionBackend | null = null;
function getSessionBackend(): SessionBackend {
  if (sessionBackend === null) {
    sessionBackend = createSessionBackend();
    // A create that finds the image gone (an image prune on an idle host)
    // pulls it again; creates wait meanwhile instead of failing one by one.
    if (imageWarmupEnabled) {
      sessionBackend.onRuntimeImageMissing?.(
        (detail) => void imageWarmup.restart(detail),
      );
    }
  }
  return sessionBackend;
}
function getSessionRoutes(): SessionRoutes {
  if (sessionRoutes === null) {
    // controlRoutes is module-scope below; this closure only runs from main()
    // (after module init), and a draining spawner must never adopt a session
    // its replacement created — the same rule as the sweep tick.
    sessionRoutes = new SessionRoutes(
      cfg,
      getSessionBackend(),
      () => controlRoutes.isDraining,
      hostMemory ?? undefined,
      hostDisk ?? undefined,
    );
  }
  return sessionRoutes;
}

// The spawner's release, for the device hub's compatibility check and a
// device's auto-update. Baked into the image (Dockerfile ENV TALE_VERSION).
const spawnerVersion = process.env.TALE_VERSION?.trim() || 'dev';

// The device hub: connected devices dial it and it places sessions on them
// (devices/hub.ts). Off unless SANDBOX_HUB_PORT is set (Docker backend only).
const hub =
  cfg.hub === null
    ? null
    : new DeviceHub({
        token: cfg.sandboxToken,
        version: spawnerVersion,
        stateDir: cfg.hub.stateDir,
        relays: cfg.hub.relays,
        // A session that already lives here — running, or a stopped
        // workspace — is never moved to a device.
        isLocalSession: async (sessionId) =>
          getSessionRoutes().holds(sessionId) ||
          (await getSessionBackend().hasWorkspace?.(sessionId)) === true,
      });

// Device mode: this spawner runs on a machine an organization connected and
// dials the hub (devices/device.ts). Started from main() once sessions are
// re-adopted.
let deviceAgent: DeviceAgent | null = null;

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
  reportSandboxError(reason, 'unhandled-rejection');
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
  // Ready means adopted. The listener opens before boot adoption so session
  // calls meet a 503 rather than a refused connection, but every probe of
  // this route (Docker's healthcheck, a Kubernetes readiness probe, the CLI's
  // runtime wait) must still read the spawner as ready only once it has
  // adopted its sessions: a rollout then keeps the previous Pod serving
  // meanwhile, and a deploy never drains a spawner part-way through adoption.
  if (bootAdoption.pending()) {
    return jsonResponse({ status: 'starting' }, 503);
  }
  const health = await probeHealth();
  if (!health.ok) {
    return jsonResponse({ status: 'unhealthy', error: health.error }, 503);
  }
  // `dockerServerVersion` is preserved as the field name for the docker
  // backend (the compose healthcheck only checks HTTP 200, not the body).
  return jsonResponse(
    {
      status: 'ok',
      dockerServerVersion: health.detail,
      disks: hostDisk?.status() ?? null,
      // Informational, like `disks`: a missing image holds creates (429
      // runtime_image) but is no reason to restart the spawner.
      runtimeImage: imageWarmup.status(),
    },
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
const SESSION_EXEC_CHECKPOINT_RE = new RegExp(
  `^/v1/sessions/${SESSION_ID}/exec/${EXEC_ID}/checkpoint$`,
);
const SESSION_EXEC_STATUS_RE = new RegExp(
  `^/v1/sessions/${SESSION_ID}/exec/${EXEC_ID}$`,
);
const SESSION_ENV_RE = new RegExp(`^/v1/sessions/${SESSION_ID}/env$`);
const SESSION_PIN_RE = new RegExp(`^/v1/sessions/${SESSION_ID}/pin$`);
const SESSION_ACTIVITY_RE = new RegExp(
  `^/v1/sessions/${SESSION_ID}/(acquire|release)$`,
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

/** Is this a session route at all? Checked before the signature, so an
 * unknown or retired path answers 404 whether or not it is signed — and the
 * hub only ever forwards routes a device can serve. Mirrors the dispatch in
 * handleSessionRoutes. */
function isSessionRoute(method: string, path: string): boolean {
  if (path === '/v1/sessions') return method === 'POST' || method === 'GET';
  const activity = path.match(SESSION_ACTIVITY_RE);
  if (activity) {
    return method === 'POST' || (method === 'GET' && activity[2] === 'release');
  }
  const routes: ReadonlyArray<readonly [string, RegExp]> = [
    ['POST', SESSION_EXEC_RE],
    ['POST', SESSION_EXEC_CANCEL_RE],
    ['GET', SESSION_EXEC_ATTACH_RE],
    ['POST', SESSION_EXEC_STDIN_RE],
    ['GET', SESSION_EXEC_STATUS_RE],
    ['GET', SESSION_EXEC_CHECKPOINT_RE],
    ['PUT', SESSION_EXEC_CHECKPOINT_RE],
    ['PATCH', SESSION_ENV_RE],
    ['PATCH', SESSION_PIN_RE],
    ['POST', SESSION_FILES_STAGE_RE],
    ['POST', SESSION_FILES_DELETE_RE],
    ['GET', SESSION_FILES_CONTENT_RE],
    ['GET', SESSION_FILES_RE],
    ['GET', SESSION_ONE_RE],
    ['DELETE', SESSION_ONE_RE],
  ];
  return routes.some(([m, re]) => m === method && re.test(path));
}

const ORG_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const DEVICE_DISCONNECT_RE =
  /^\/v1\/devices\/([a-zA-Z0-9_-]{1,64})\/disconnect$/;
const ORGANIZATION_RE = /^\/v1\/organizations\/([a-zA-Z0-9_-]{1,128})$/;

/** The calls whose answer depends on what boot adoption fills in — the
 * session registry and the hub's placements — and so wait for it. The
 * deploy's drain and drain status are among them: a drain latched mid-way
 * stops adoption, leaving every session not yet adopted to answer 404, and
 * the status counts only the sessions adopted so far, so a deploy would read
 * the spawner as drained and restart it under running sessions. */
function dependsOnAdoption(method: string, path: string): boolean {
  return (
    isSessionRoute(method, path) ||
    (method === 'GET' &&
      (path === '/v1/workspaces' ||
        path === '/v1/capacity' ||
        path === '/v1/drain-status')) ||
    (method === 'POST' && path === '/v1/drain') ||
    (method === 'DELETE' && ORGANIZATION_RE.test(path)) ||
    (method === 'POST' && DEVICE_DISCONNECT_RE.test(path))
  );
}

// How often the session TTL/idle reaper runs.
const SESSION_SWEEP_INTERVAL_MS = 60_000;

async function handleSessionRoutes(
  req: Request,
  url: URL,
  body: string,
): Promise<Response | null> {
  const path = url.pathname;

  // POST /v1/sessions (create)
  if (req.method === 'POST' && path === '/v1/sessions') {
    const waiting = imageWarmup.refusal();
    if (waiting !== null) return waiting;
    const created = await getSessionRoutes().handleCreate(body, req.signal);
    // A create that failed on a missing image restarted the warmup: it gets
    // the same retryable wait as the creates after it, not a 502.
    return created.status === 502
      ? (imageWarmup.refusal() ?? created)
      : created;
  }
  // GET /v1/sessions?organizationId=… (list)
  if (req.method === 'GET' && path === '/v1/sessions') {
    return getSessionRoutes().handleList(
      url.searchParams.get('organizationId'),
    );
  }
  const activityMatch = path.match(SESSION_ACTIVITY_RE);
  if (
    activityMatch &&
    (req.method === 'POST' ||
      (req.method === 'GET' && activityMatch[2] === 'release'))
  ) {
    return getSessionRoutes().handleActivity(
      activityMatch[1] ?? '',
      req.method === 'GET'
        ? 'ticket'
        : activityMatch[2] === 'acquire'
          ? 'acquire'
          : 'release',
      body,
    );
  }
  // POST /v1/sessions/:id/exec  (must precede the bare :id matcher)
  const execMatch = path.match(SESSION_EXEC_RE);
  if (req.method === 'POST' && execMatch) {
    return getSessionRoutes().handleExec(req, execMatch[1] ?? '', body);
  }
  // POST /v1/sessions/:id/exec/:execId/cancel[?leftovers=keep]
  const cancelMatch = path.match(SESSION_EXEC_CANCEL_RE);
  if (req.method === 'POST' && cancelMatch) {
    // The query string is HMAC-covered (authorize signs pathname + search).
    return getSessionRoutes().handleExecCancel(
      cancelMatch[1] ?? '',
      cancelMatch[2] ?? '',
      { keepLeftovers: url.searchParams.get('leftovers') === 'keep' },
    );
  }
  // GET /v1/sessions/:id/exec/:execId/attach (SSE reconnect)
  const attachMatch = path.match(SESSION_EXEC_ATTACH_RE);
  if (req.method === 'GET' && attachMatch) {
    return getSessionRoutes().handleExecAttach(
      req,
      attachMatch[1] ?? '',
      attachMatch[2] ?? '',
    );
  }
  // POST /v1/sessions/:id/exec/:execId/stdin (held-open stdin append/EOF)
  const stdinMatch = path.match(SESSION_EXEC_STDIN_RE);
  if (req.method === 'POST' && stdinMatch) {
    return getSessionRoutes().handleExecStdin(
      stdinMatch[1] ?? '',
      stdinMatch[2] ?? '',
      body,
    );
  }
  // GET /v1/sessions/:id/exec/:execId — per-exec status (no stream); the
  // restorative recovery watchdog's liveness probe. Must follow the cancel/
  // attach/stdin matchers (they carry a trailing segment) and the bare-:id
  // create matcher (no execId).
  const checkpointMatch = path.match(SESSION_EXEC_CHECKPOINT_RE);
  if ((req.method === 'GET' || req.method === 'PUT') && checkpointMatch) {
    return getSessionRoutes().handleExecCheckpoint(
      req,
      checkpointMatch[1] ?? '',
      checkpointMatch[2] ?? '',
      body,
    );
  }
  const execStatusMatch = path.match(SESSION_EXEC_STATUS_RE);
  if (req.method === 'GET' && execStatusMatch) {
    return getSessionRoutes().handleExecStatus(
      execStatusMatch[1] ?? '',
      execStatusMatch[2] ?? '',
      req.signal,
    );
  }
  // PATCH /v1/sessions/:id/env
  const envMatch = path.match(SESSION_ENV_RE);
  if (req.method === 'PATCH' && envMatch) {
    return getSessionRoutes().handleEnvPatch(envMatch[1] ?? '', body);
  }
  // PATCH /v1/sessions/:id/pin — toggle always-on (idle/TTL reaper exemption)
  const pinMatch = path.match(SESSION_PIN_RE);
  if (req.method === 'PATCH' && pinMatch) {
    return getSessionRoutes().handleSetPinned(pinMatch[1] ?? '', body);
  }
  // POST /v1/sessions/:id/files/stage
  const stageMatch = path.match(SESSION_FILES_STAGE_RE);
  if (req.method === 'POST' && stageMatch) {
    return getSessionRoutes().handleFilesStage(
      stageMatch[1] ?? '',
      body,
      req.signal,
    );
  }
  // POST /v1/sessions/:id/files/delete
  const deleteMatch = path.match(SESSION_FILES_DELETE_RE);
  if (req.method === 'POST' && deleteMatch) {
    return getSessionRoutes().handleFilesDelete(deleteMatch[1] ?? '', body);
  }
  // GET /v1/sessions/:id/files/content?path=  (must precede the bare files RE)
  const fileContentMatch = path.match(SESSION_FILES_CONTENT_RE);
  if (req.method === 'GET' && fileContentMatch) {
    return getSessionRoutes().handleFileContent(
      fileContentMatch[1] ?? '',
      url.searchParams.get('path') ?? '',
      req.signal,
    );
  }
  // GET /v1/sessions/:id/files?path=  (directory listing)
  const filesMatch = path.match(SESSION_FILES_RE);
  if (req.method === 'GET' && filesMatch) {
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
      return getSessionRoutes().handleGet(id);
    }
    if (req.method === 'DELETE') {
      // `?if_idle=1` — conditional destroy for janitor callers: no-op with
      // {busy:true} while the session still has a live exec. `?if_stopped=1`
      // — the workspace cleanup's: no-op while ANY compute runs under the id.
      // `?await_deletion=1` — the cleanup's too: wait a bounded time for the
      // workspace's bytes, and answer how far their deletion came.
      // `?keep_workspace=1` — remove the compute alone and keep the
      // workspace (the cleanup after a failed create of an agent session).
      // The query string is HMAC-covered (authorize signs pathname + search).
      return getSessionRoutes().handleDestroy(id, {
        ifIdle: url.searchParams.get('if_idle') === '1',
        ifStopped: url.searchParams.get('if_stopped') === '1',
        awaitDeletion: url.searchParams.get('await_deletion') === '1',
        keepWorkspace: url.searchParams.get('keep_workspace') === '1',
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
  if (bootAdoption.pending() && dependsOnAdoption(req.method, url.pathname)) {
    return unavailableSessionResponse();
  }
  if (req.method === 'GET' && url.pathname === '/v1/limits') {
    const signed = await auth.readAndAuth(req);
    if ('error' in signed) return signed.error;
    // With an organization, also what its connected devices add: a quota may
    // use the deployment's slots plus its own machines'.
    const organizationId = url.searchParams.get('organizationId');
    return jsonResponse(
      {
        maxSessions: cfg.session.maxSessions,
        ...(organizationId !== null && ORG_ID_RE.test(organizationId)
          ? { deviceSessions: hub?.deviceSessionCapacity(organizationId) ?? 0 }
          : {}),
      },
      200,
      { 'cache-control': 'no-store' },
    );
  }
  // GET /v1/devices?organizationId= — the organization's connected devices.
  if (req.method === 'GET' && url.pathname === '/v1/devices') {
    const signed = await auth.readAndAuth(req);
    if ('error' in signed) return signed.error;
    const organizationId = url.searchParams.get('organizationId');
    if (organizationId === null || !ORG_ID_RE.test(organizationId)) {
      return jsonResponse({ error: 'bad_request' }, 400);
    }
    return jsonResponse(
      { hub: hub !== null, devices: hub?.devicesFor(organizationId) ?? [] },
      200,
      { 'cache-control': 'no-store' },
    );
  }
  // POST /v1/devices/:id/disconnect — the organization removed the device.
  const disconnectMatch = url.pathname.match(DEVICE_DISCONNECT_RE);
  if (req.method === 'POST' && disconnectMatch) {
    const signed = await auth.readAndAuth(req);
    if ('error' in signed) return signed.error;
    return jsonResponse(
      (await hub?.disconnect(disconnectMatch[1] ?? '')) ?? {
        disconnected: false,
        placementsDropped: 0,
      },
      200,
    );
  }
  // GET /v1/workspaces — the workspace inventory the platform's cleanup
  // reconciles against its own records.
  if (req.method === 'GET' && url.pathname === '/v1/workspaces') {
    const signed = await auth.readAndAuth(req);
    if ('error' in signed) return signed.error;
    return getSessionRoutes().handleWorkspaces();
  }
  // DELETE /v1/organizations/:id — the organization was deleted: its
  // remaining sessions, build helpers and caches go.
  const organizationMatch = url.pathname.match(ORGANIZATION_RE);
  if (req.method === 'DELETE' && organizationMatch) {
    const signed = await auth.readAndAuth(req);
    if ('error' in signed) return signed.error;
    return getSessionRoutes().handleOrganizationTeardown(
      organizationMatch[1] ?? '',
    );
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
      const snapshot = await capacity.forOrganization(organizationId);
      if (hub !== null) {
        // The organization's device-placed sessions: where each lives, and
        // how the connected devices report them (an offline device's are
        // simply not running here).
        const overlay = hub.capacityOverlay(organizationId);
        const onDevice = new Set(overlay.placements.map((p) => p.sessionId));
        snapshot.placements = overlay.placements;
        snapshot.runtimeSessions = [
          ...snapshot.runtimeSessions.filter((s) => !onDevice.has(s.sessionId)),
          ...overlay.runtimeSessions.filter((s) => onDevice.has(s.sessionId)),
        ];
      }
      return jsonResponse(snapshot, 200, { 'cache-control': 'no-store' });
    } catch (error) {
      reportSandboxError(error, 'capacity-observation', req.signal, req);
      console.warn('[sandbox] capacity observation failed:', error);
      return jsonResponse({ error: 'capacity_unavailable' }, 503, {
        'cache-control': 'no-store',
      });
    }
  }
  // Deploy control routes — HMAC-gated inside ControlRoutes; null = not one.
  const controlResponse = await controlRoutes.handle(req, url);
  if (controlResponse !== null) return controlResponse;
  if (isSessionRoute(req.method, url.pathname)) {
    // Draining: refuse NEW sessions so they land on the replacement
    // container. Execs on existing sessions keep working until reaped.
    if (
      req.method === 'POST' &&
      url.pathname === '/v1/sessions' &&
      controlRoutes.isDraining
    ) {
      return jsonResponse(
        {
          error: 'draining',
          message: 'spawner is draining; create once the rollout completes',
        },
        503,
      );
    }
    const signed = await auth.readAndAuth(req);
    if ('error' in signed) return signed.error;
    // A session that lives on a connected device (or should start on one)
    // is the device's to serve.
    if (hub !== null) {
      const forwarded = await hub.maybeForward(req, url, signed.body);
      if (forwarded !== null) return forwarded;
    }
    const sessionResponse = await handleSessionRoutes(req, url, signed.body);
    if (sessionResponse !== null) return sessionResponse;
  }
  return jsonResponse({ error: 'not_found' }, 404);
}

/** Start the periodic session sweep: re-adoption, the TTL/idle reaper, the
 * deferred capacity sizing and the max-linger self-reap. Returns its stop. */
function startSessionSweep(sessions: SessionRoutes): () => void {
  const sweepTimer = setInterval(() => {
    // Re-adopt before reaping so a session missed at boot (a `docker ps` /
    // apiserver blip) or created by a peer replica becomes routable and
    // reapable within one interval instead of lingering unregistered (not
    // while draining — see `maintain`). A pass still running joins rather
    // than stacks.
    void sessions.maintain().catch((err) => {
      reportSandboxError(err, 'session-sweep');
      console.warn('[sandbox.session] periodic sweep failed:', err);
    });
    if (!capacitySized) {
      void sizeSessionCapacity().catch((err: unknown) => {
        reportSandboxError(err, 'capacity-sizing');
        console.warn('[sandbox] sizing the session capacity failed:', err);
      });
    }
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
          reportSandboxError(err, 'linger-reap');
          console.warn('[sandbox.session] linger reap failed:', err);
        });
    }
  }, SESSION_SWEEP_INTERVAL_MS);
  return () => clearInterval(sweepTimer);
}

/** The boot steps that run around the adoption gate. */
export interface AdoptionBootSteps<S> {
  /** Open the API listener; what it returns is the boot's result. */
  listen(): S;
  /** Re-adopt the sessions a previous process left running. */
  adopt(): Promise<void>;
  /** Load the device hub's placements and open its door. */
  startHub(): Promise<void>;
}

/**
 * Open the listener, then re-adopt the sessions and load the hub's
 * placements behind the adoption gate: from before the listener accepts a
 * call until both are done, the calls whose answer depends on them, and
 * `/health`, answer 503 (see the router). A failed adoption is logged and
 * does not keep the spawner from serving or the hub from loading; the gate
 * ends however the steps end, so a spawner never stays "starting" for good.
 */
export async function listenThenAdopt<S>(
  steps: AdoptionBootSteps<S>,
  adoption: BootAdoption = bootAdoption,
): Promise<S> {
  adoption.begin();
  try {
    const server = steps.listen();
    try {
      await steps.adopt();
    } catch (err) {
      // A backend listing that fails is caught inside adoption and retried by
      // the periodic sweep; anything else that throws here must still not
      // keep the control service from starting.
      reportSandboxError(err, 'session-startup');
      console.warn('[sandbox.session] session subsystem startup failed:', err);
    }
    await steps.startHub();
    return server;
  } finally {
    adoption.end();
  }
}

async function main(): Promise<void> {
  // Backend boot setup. For the docker backend this acquires the cross-process
  // host-session lock (refuses to start if another live spawner shares the
  // hostSessionRoot — audit finding R2-B5) then runs the boot orphan sweep.
  // Throwing here is fatal.
  try {
    await backend.init();
  } catch (err) {
    reportSandboxError(err, 'backend-init');
    await flushSandboxErrorReporting();
    console.error('[sandbox] FATAL: backend init failed:', err);
    process.exit(1);
  }

  // Warm beside startup: control, health and existing sessions stay available
  // while a cold registry transfer runs. Only local creates wait (429 above).
  if (imageWarmupEnabled) {
    void imageWarmup.start();
  }

  hostMemory?.start();
  hostDisk?.start();
  await sizeSessionCapacity();
  if (!capacitySized) {
    console.warn(
      `[sandbox] cannot read the Docker host's memory yet; session capacity stays ${cfg.session.maxSessions} until it can (set SANDBOX_MAX_SESSIONS to fix it)`,
    );
  }

  const stopPeriodic = startPeriodicSweep(backend, cfg);

  // Listen before re-adopting the sessions a previous process left running,
  // so a restart reads to the platform as a short 503 rather than a refused
  // connection; the calls that depend on adoption wait for it (BootAdoption).
  // The host lock and the boot sweep above have run by now.
  let stopSessionSweep: (() => void) | undefined;
  await listenThenAdopt({
    listen: () => {
      const server = Bun.serve({
        port: cfg.port,
        // A device's spawner is reached only through its tunnel (in-process)
        // and by its own healthcheck — never from the network its sessions
        // share.
        ...(cfg.deviceConfigPath !== null ? { hostname: '127.0.0.1' } : {}),
        // Bun's default idleTimeout is 10 s, which kills long SSE streams
        // during silent install phases. 255 is Bun's max — combined with the
        // in-stream keepalive in session exec streams, this gives a generous
        // backstop without disabling the timeout entirely.
        idleTimeout: 255,
        fetch: (req) => handleSandboxRequest(req, router),
        error: sandboxServerError,
      });

      installSignalHandlers(() => {
        deviceAgent?.stop();
        hub?.stop();
        try {
          void server.stop();
        } catch (err) {
          reportSandboxError(err, 'server-stop');
          console.warn('[sandbox] server.stop() during shutdown failed:', err);
        }
      }, backend);

      console.log(
        `[sandbox] spawner listening on :${server.port}; runtime=${cfg.runtimeTier}${cfg.dockerInContainer ? '+dind' : ''}; image=${cfg.runtimeImage}; maxSessions=${cfg.session.maxSessions}; tokenAuth=on`,
      );
      return server;
    },
    // Session subsystem: re-adopt running session containers into the
    // registry (the registry is a cache; backend objects are the source of
    // truth) and start the TTL/idle reaper.
    adopt: async () => {
      const sessions = getSessionRoutes();
      await sessions.adoptExisting();
      stopSessionSweep = startSessionSweep(sessions);
    },
    // The hub's placement memory must be loaded before the API routes a
    // single session call (the adoption gate holds them until it is); its
    // WebSocket door opens beside the API.
    startHub: async () => {
      if (hub === null || cfg.hub === null) return;
      await hub.start();
      const door = serveHub(hub, cfg.hub.port);
      console.log(
        `[sandbox] device hub listening on :${door.port} (devices dial /sandbox/tunnel)`,
      );
    },
  });

  if (cfg.deviceConfigPath !== null) {
    const configPath = cfg.deviceConfigPath;
    const deviceConfig = await loadDeviceConfig(configPath);
    deviceAgent = new DeviceAgent({
      config: deviceConfig,
      version: spawnerVersion,
      maxRequestBodyBytes: cfg.maxRequestBodyBytes,
      dispatch: async (req, url, body) =>
        (await handleSessionRoutes(req, url, body)) ??
        jsonResponse({ error: 'not_found' }, 404),
      // What the device runs comes from the spawner's own memory and /proc,
      // never a `docker ps` on the user's machine every few seconds.
      observe: async () => {
        const sessions = getSessionRoutes().inventory(
          deviceConfig.organizationId,
        );
        return {
          running: sessions.filter((s) => s.state === 'running').length,
          starting: sessions.filter((s) => s.state === 'starting').length,
          sessions,
          resources: await capacity.hostResources(),
        };
      },
      inventoryKey: () =>
        JSON.stringify(
          getSessionRoutes().inventory(deviceConfig.organizationId),
        ),
      selfUpdate: (version) =>
        launchSelfUpdate(deviceConfig, configPath, version),
    });
    void deviceAgent.start().catch((err: unknown) => {
      reportSandboxError(err, 'device-connection');
      console.error('[sandbox.devices] device connection loop stopped:', err);
    });
    console.log(
      `[sandbox] device mode: "${deviceConfig.name}" (${deviceConfig.deviceId}) connecting to ${deviceConfig.serverUrl}`,
    );
  }

  // Keep the periodic sweep handles so they aren't GC'd.
  void stopPeriodic;
  void stopSessionSweep;
}

if (import.meta.main)
  main().catch(async (err: unknown) => {
    // Without this catch a boot failure after init() (e.g. Bun.serve EADDRINUSE)
    // would be swallowed by the global unhandledRejection backstop above,
    // leaving a zombie process that neither listens nor exits.
    console.error('[sandbox] FATAL: boot failed:', err);
    reportSandboxError(err, 'boot');
    await flushSandboxErrorReporting();
    process.exit(1);
  });
