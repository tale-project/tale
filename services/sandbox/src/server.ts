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
import {
  bootSweep,
  installSignalHandlers,
  startPeriodicSweep,
} from './cleanup.ts';
import { loadConfig } from './config.ts';
import { ensureImage, runDocker } from './spawn-util.ts';
import {
  cancelExecution,
  executeRequest,
  inFlightSize,
  isInFlight,
  registerInFlight,
  unregisterInFlight,
} from './spawn.ts';
import type { ExecuteRequest } from './types.ts';
import { ID_ALPHABET_RE } from './wire.ts';

const cfg = loadConfig();

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
    return jsonResponse({ error: 'unauthorized', reason: result.reason }, 401);
  }
  return null;
}

// Cache the docker version probe so the compose healthcheck (every 10s)
// doesn't fork a subprocess on every hit. 60s is well under the watchdog
// cutoff and short enough that a daemon recycle surfaces within one
// healthcheck cycle of the user noticing.
const DOCKER_PROBE_TTL_MS = 60_000;
let dockerProbeCache:
  | { ok: true; version: string; expiresAt: number }
  | { ok: false; error: string; expiresAt: number }
  | null = null;

async function probeDocker(): Promise<
  { ok: true; version: string } | { ok: false; error: string }
> {
  const now = Date.now();
  if (dockerProbeCache !== null && dockerProbeCache.expiresAt > now) {
    return dockerProbeCache.ok
      ? { ok: true, version: dockerProbeCache.version }
      : { ok: false, error: dockerProbeCache.error };
  }
  // Probe docker daemon reachability. Use `docker version --format` over the
  // older `docker info --format` because some Debian-packaged CLIs (e.g.
  // docker.io 20.10 in our base image) panic when templating a newer-API
  // `info` response. `docker version` is a much smaller surface that has
  // been compatible across the 20.10 ↔ 29.x gap.
  const info = await runDocker(['version', '--format', '{{.Server.Version}}']);
  if (info.exitCode !== 0) {
    const error = info.stderr.trim() || info.stdout.trim();
    dockerProbeCache = {
      ok: false,
      error,
      expiresAt: now + DOCKER_PROBE_TTL_MS,
    };
    return { ok: false, error };
  }
  const version = info.stdout.trim();
  dockerProbeCache = {
    ok: true,
    version,
    expiresAt: now + DOCKER_PROBE_TTL_MS,
  };
  return { ok: true, version };
}

async function handleHealth(): Promise<Response> {
  const docker = await probeDocker();
  if (!docker.ok) {
    return jsonResponse({ status: 'unhealthy', error: docker.error }, 503);
  }
  return jsonResponse(
    { status: 'ok', dockerServerVersion: docker.version },
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
  if (parsedUnknown === null || typeof parsedUnknown !== 'object') {
    return jsonResponse(
      { error: 'bad_request', message: 'request body must be a JSON object' },
      400,
    );
  }
  // Field-level validation below narrows from the unknown record into the
  // ExecuteRequest shape the spawn pipeline expects. Each field used as a
  // registry key or argv input is gated explicitly; everything else is
  // forwarded as the spawn-side argv builder re-validates it.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- wire-shape narrowing; spawn-side argv builder re-validates each field
  const parsed = parsedUnknown as ExecuteRequest;
  // Validate the only field we use as a registry key before touching state.
  // Defends against an unauthenticated dev-mode caller polluting the
  // in-flight set with garbage ids that would block legitimate cancels.
  if (
    typeof parsed.executionId !== 'string' ||
    !ID_ALPHABET_RE.test(parsed.executionId)
  ) {
    return jsonResponse(
      { error: 'bad_request', message: 'executionId is missing or malformed' },
      400,
    );
  }

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
    cancelExecution(parsed.executionId).catch((err) => {
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
      try {
        const result = await executeRequest(cfg, parsed, {
          onPhase: (e) => send('phase', e),
        });
        send('result', result);
      } catch (err) {
        send('error', {
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
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
  const killed = await cancelExecution(id);
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
  // Fail-closed: refuse to start without a token unless the operator has
  // explicitly opted in to dev-mode unauth. Production deploys auto-mint
  // SANDBOX_TOKEN via the CLI's ensure-env helper, so the only way to hit
  // this branch is a misconfiguration or an explicit `bun dev` opt-in.
  if (cfg.sandboxToken === null && !cfg.allowUnauth) {
    console.error(
      '[sandbox] FATAL: SANDBOX_TOKEN is unset. Set a token, or pass SANDBOX_ALLOW_UNAUTH=true for dev-only unauth mode (rag/crawler-parity).',
    );
    process.exit(1);
  }

  await bootSweep(cfg);
  // Warm the runtime image so the first /v1/execute call doesn't pay a
  // cold registry round-trip. Non-fatal: if the daemon is unreachable at
  // boot the spawner still starts (its /health probe will surface the
  // real problem), but a hot daemon means the first call will get
  // image-not-found if we never pull. Failure is logged inside ensureImage.
  await ensureImage(cfg.runtimeImage);

  const stopPeriodic = startPeriodicSweep(cfg);

  const server = Bun.serve({
    port: cfg.port,
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
  });

  console.log(
    `[sandbox] spawner listening on :${server.port}; runtime=${cfg.runtime}; image=${cfg.runtimeImage}; maxConcurrent=${cfg.maxConcurrent}; tokenAuth=${cfg.sandboxToken !== null ? 'on' : 'OFF (dev opt-in)'}`,
  );

  // Keep the periodic sweep handle so it isn't GC'd.
  void stopPeriodic;
}

void main();
