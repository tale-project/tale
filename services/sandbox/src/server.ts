// Tale Sandbox Spawner — HTTP entrypoint.
//
// Routes:
//   GET  /health             — 200 if docker daemon reachable.
//   POST /v1/execute         — HMAC-authenticated, runs one ephemeral container,
//                              returns ExecuteResponse.
//   POST /v1/cancel/:id      — HMAC-authenticated, kills in-flight container.
//
// Concurrency: in-process semaphore at SANDBOX_MAX_CONCURRENT. 429 over cap.

import { verify, SIGNATURE_HEADER } from './auth.ts';
import {
  bootSweep,
  installSignalHandlers,
  startPeriodicSweep,
} from './cleanup.ts';
import { loadConfig } from './config.ts';
import { cancelExecution, executeRequest, isInFlight } from './spawn.ts';
import { runDocker } from './spawn_util.ts';
import type { ExecuteRequest } from './types.ts';

const cfg = loadConfig();

const inFlightSet = new Set<string>();

function inFlightIds(): string[] {
  return Array.from(inFlightSet);
}

async function handleHealth(): Promise<Response> {
  // /health pings docker daemon — caches not used for v1.
  const info = await runDocker(['info', '--format', '{{.ServerVersion}}']);
  if (info.exitCode !== 0) {
    return new Response(
      JSON.stringify({ status: 'unhealthy', error: info.stderr.trim() }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response(
    JSON.stringify({ status: 'ok', dockerServerVersion: info.stdout.trim() }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

async function handleExecute(req: Request): Promise<Response> {
  const body = await req.text();
  if (!verify(body, req.headers.get(SIGNATURE_HEADER), cfg.sandboxToken)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (inFlightSet.size >= cfg.maxConcurrent) {
    return new Response(
      JSON.stringify({
        error: 'busy',
        message: `Spawner at concurrency cap (${cfg.maxConcurrent})`,
      }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '5',
        },
      },
    );
  }
  let parsed: ExecuteRequest;
  try {
    parsed = JSON.parse(body) as ExecuteRequest;
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'bad_request', message: String(err) }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }
  inFlightSet.add(parsed.executionId);
  try {
    const result = await executeRequest(cfg, parsed);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } finally {
    inFlightSet.delete(parsed.executionId);
  }
}

async function handleCancel(req: Request, id: string): Promise<Response> {
  const body = await req.text();
  if (!verify(body, req.headers.get(SIGNATURE_HEADER), cfg.sandboxToken)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (!isInFlight(id)) {
    return new Response(JSON.stringify({ killed: false }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }
  const killed = await cancelExecution(id);
  return new Response(JSON.stringify({ killed }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function router(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/health') {
    return handleHealth();
  }
  if (req.method === 'POST' && url.pathname === '/v1/execute') {
    return handleExecute(req);
  }
  const cancelMatch = url.pathname.match(/^\/v1\/cancel\/([a-f0-9-]{1,64})$/i);
  if (req.method === 'POST' && cancelMatch) {
    return handleCancel(req, cancelMatch[1] ?? '');
  }
  return new Response(JSON.stringify({ error: 'not_found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

async function main(): Promise<void> {
  await bootSweep();
  const stopPeriodic = startPeriodicSweep(cfg);
  installSignalHandlers(inFlightIds);

  const server = Bun.serve({
    port: cfg.port,
    fetch: (req) =>
      router(req).catch((err) => {
        console.error('[sandbox] handler error:', err);
        return new Response(
          JSON.stringify({ error: 'internal', message: String(err) }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        );
      }),
  });

  console.log(
    `[sandbox] spawner listening on :${server.port}; runtime=${cfg.runtime}; image=${cfg.runtimeImage}; maxConcurrent=${cfg.maxConcurrent}`,
  );

  // Keep the periodic sweep handle so it isn't GC'd.
  void stopPeriodic;
}

void main();
