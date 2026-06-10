// Tale Sandbox Spawner — HTTP entrypoint.
//
// Routes:
//   GET  /health             — 200 if docker daemon reachable.
//   POST /v1/execute         — HMAC-authenticated, runs one ephemeral container,
//                              streams SSE phase events + final result.
//   POST /v1/cancel/:id      — HMAC-authenticated, kills in-flight container.
//
// Concurrency: in-process semaphore at SANDBOX_MAX_CONCURRENT. 429 over cap.

import { verify, SIGNATURE_HEADER, TIMESTAMP_HEADER } from './auth.ts';
import { createBackend, type HealthResult } from './backend/index.ts';
import { installSignalHandlers, startPeriodicSweep } from './cleanup.ts';
import { loadConfig } from './config.ts';
import {
  cancelExecution,
  executeRequest,
  inFlightSize,
  isInFlight,
  registerInFlight,
  unregisterInFlight,
} from './spawn.ts';
import { validateExecuteRequest } from './validate-request.ts';

const cfg = loadConfig();
// Execution backend (docker | kubernetes), chosen once at boot. Constructing
// it has no side effects; init() runs the docker lock + boot sweep in main().
const backend = createBackend(cfg);

// A single execution's stray async error must not take down the long-running
// spawner that's serving other requests. Per-request paths already try/catch;
// this is the backstop. (The k8s backend's aborted log/exec streams under Bun
// are the most likely source — handled at the source too, but logged here if
// one escapes.)
process.on('unhandledRejection', (reason) => {
  console.error('[sandbox] unhandledRejection (surviving):', reason);
});

async function readBodyCapped(req: Request, maxBytes: number): Promise<string> {
  // Streaming guard so an unbounded POST can't OOM the process before we
  // ever see HMAC. We rely on the Content-Length hint when present and
  // hard-cap the actual byte count regardless.
  const cl = req.headers.get('content-length');
  if (cl !== null) {
    const declared = Number(cl);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw Object.assign(new Error('payload_too_large'), { httpStatus: 413 });
    }
  }
  const reader = req.body?.getReader();
  if (!reader) {
    return '';
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        reader.cancel().catch((err) => {
          console.warn('[sandbox] reader cancel after body cap failed:', err);
        });
        throw Object.assign(new Error('payload_too_large'), {
          httpStatus: 413,
        });
      }
      chunks.push(value);
    }
  }
  const first = chunks[0];
  return new TextDecoder('utf-8').decode(
    chunks.length === 1 && first ? first : concat(chunks, total),
  );
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...extraHeaders,
    },
  });
}

function authorize(body: string, req: Request): Response | null {
  if (cfg.sandboxToken === null) return null; // dev opt-in mode
  const url = new URL(req.url);
  const result = verify(
    req.method,
    url.pathname,
    body,
    req.headers.get(SIGNATURE_HEADER),
    req.headers.get(TIMESTAMP_HEADER),
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
    cancelExecution(backend, parsed.executionId).catch((err) => {
      console.warn('[sandbox] client-abort cancel failed:', err);
    });
  };
  req.signal.addEventListener('abort', abortHandler, { once: true });
  registerInFlight(parsed.executionId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch (err) {
          // Stream already closed — common when the caller aborted; we
          // continue draining the spawn so the cleanup paths run.
          console.warn('[sandbox] SSE enqueue after close:', err);
        }
      };
      // Bun.serve enforces a per-connection idleTimeout (we raise it to the
      // 255 s max below, but install + run can still outlast that). An SSE
      // comment line (`: ...\n\n`) is ignored by the platform-side parser
      // and resets the idle clock, so a periodic tick keeps the stream live
      // during silent stretches like `pip install` / `npm install`.
      const sendKeepalive = () => {
        try {
          controller.enqueue(enc.encode(`: keepalive\n\n`));
        } catch (err) {
          console.warn('[sandbox] SSE keepalive enqueue after close:', err);
        }
      };
      const keepalive = setInterval(sendKeepalive, 20_000);
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
        clearInterval(keepalive);
        unregisterInFlight(parsed.executionId);
        req.signal.removeEventListener('abort', abortHandler);
        try {
          controller.close();
        } catch (err) {
          console.warn('[sandbox] SSE close failed:', err);
        }
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
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
  if (!isInFlight(id)) {
    return jsonResponse({ killed: false }, 404);
  }
  const killed = await cancelExecution(backend, id);
  return jsonResponse({ killed }, 200);
}

// Cancel route uses the same id alphabet as the execute payload so a
// Convex doc id (contains g-z) is not silently rejected. Centralized in
// wire.ts; one regex covers spawn.ts, docker-args.ts, and this router.
const CANCEL_ROUTE_RE = /^\/v1\/cancel\/([a-zA-Z0-9_-]{1,64})$/;

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

  const server = Bun.serve({
    port: cfg.port,
    // Bun's default idleTimeout is 10 s, which kills long SSE streams during
    // silent install phases. 255 is Bun's max — combined with the in-stream
    // keepalive in /v1/execute, this gives a generous backstop without
    // disabling the timeout entirely.
    idleTimeout: 255,
    fetch: (req) =>
      router(req).catch((err) => {
        console.error('[sandbox] handler error:', err);
        return jsonResponse({ error: 'internal', message: String(err) }, 500);
      }),
  });

  installSignalHandlers(() => {
    try {
      void server.stop();
    } catch (err) {
      console.warn('[sandbox] server.stop() during shutdown failed:', err);
    }
  }, backend);

  console.log(
    `[sandbox] spawner listening on :${server.port}; runtime=${cfg.runtime}; image=${cfg.runtimeImage}; maxConcurrent=${cfg.maxConcurrent}; tokenAuth=${cfg.sandboxToken !== null ? 'on' : 'OFF (dev opt-in)'}`,
  );

  // Keep the periodic sweep handle so it isn't GC'd.
  void stopPeriodic;
}

void main();
