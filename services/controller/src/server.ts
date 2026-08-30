// Tale Controller — privileged control-plane sidecar.
//
// A dedicated, internal-only service that performs the ONE privileged action
// the browser-facing platform must not: restarting sibling containers so a
// deployment-config change (external knowledge Postgres / Convex S3 storage)
// takes effect. It mounts the docker socket (host root — same accepted threat
// boundary as the sandbox spawner) but is far more constrained: HMAC-signed
// requests only, a hard service allowlist of {backend-api, backend-worker,
// sandbox}, and only
// list+restart (no run/exec). Reachable only on the internal network.

import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from './auth.ts';
import {
  dockerReachable,
  listContainerIds,
  restartContainer,
} from './docker.ts';
import { projectCandidates, serviceCandidates } from './targets.ts';

const TOKEN = process.env.CONTROLLER_TOKEN ?? '';
const PORT = Number(process.env.CONTROLLER_PORT ?? 8004);
// Scope restarts to this compose project so we never touch another stack.
const PROJECT =
  process.env.COMPOSE_PROJECT_NAME ||
  process.env.CONTROLLER_PROJECT ||
  undefined;

/** Hard allowlist — the only services this control plane may ever restart.
 * `sandbox` is here so a sandboxRuntime tier change in deployment.json takes
 * effect on apply-and-restart (the spawner reads it at boot); the two backend
 * services because a deployment-config change (external knowledge Postgres,
 * object storage) is read at boot by the process that serves it. */
const ALLOWED = new Set(['backend-api', 'backend-worker', 'sandbox']);

// Delay before bouncing the CALLER's own container so the signed HTTP
// response is flushed and the request that asked for the restart can return
// its result first.
const DEFERRED_RESTART_DELAY_MS = 1500;

// Replay guard. The signature already binds the request to a timestamp within
// a ~60s skew window; tracking each nonce for that long makes a captured
// request single-use. Single-instance sidecar, so an in-memory map suffices.
const NONCE_TTL_MS = 60_000;
const seenNonces = new Map<string, number>();
function claimNonce(nonce: string): boolean {
  const now = Date.now();
  for (const [n, exp] of seenNonces) {
    if (exp <= now) seenNonces.delete(n);
  }
  if (seenNonces.has(nonce)) return false;
  seenNonces.set(nonce, now + NONCE_TTL_MS);
  return true;
}

/** Restart every running container for one allowlisted compose service. */
async function restartService(
  svc: string,
): Promise<{ restarted: string[]; errors: string[] }> {
  const restarted: string[] = [];
  const errors: string[] = [];
  try {
    const ids = await listContainerIds(
      projectCandidates(PROJECT, svc),
      serviceCandidates(svc),
    );
    if (ids.length === 0) {
      errors.push(`${svc}: no running container found`);
      return { restarted, errors };
    }
    for (const id of ids) {
      await restartContainer(id);
      restarted.push(`${svc}:${id.slice(0, 12)}`);
    }
  } catch (err) {
    errors.push(`${svc}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { restarted, errors };
}

if (!TOKEN) {
  console.error(
    '[controller] CONTROLLER_TOKEN is required — refusing to start.',
  );
  process.exit(1);
}

Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/health') {
      const ok = await dockerReachable();
      return Response.json({ ok }, { status: ok ? 200 : 503 });
    }

    if (req.method === 'POST' && url.pathname === '/restart') {
      const body = await req.text();
      if (
        !verify(
          TOKEN,
          req.headers.get(TIMESTAMP_HEADER),
          req.headers.get(SIGNATURE_HEADER),
          body,
        )
      ) {
        return Response.json(
          { ok: false, error: 'unauthorized' },
          { status: 401 },
        );
      }

      let parsed: { services?: unknown; nonce?: unknown };
      try {
        parsed = JSON.parse(body);
      } catch {
        return Response.json(
          { ok: false, error: 'invalid JSON' },
          { status: 400 },
        );
      }

      // Single-use nonce (signed as part of the body) → no replay within skew.
      if (typeof parsed.nonce !== 'string' || parsed.nonce.length === 0) {
        return Response.json(
          { ok: false, error: 'missing nonce' },
          { status: 400 },
        );
      }
      if (!claimNonce(parsed.nonce)) {
        return Response.json(
          { ok: false, error: 'replayed request' },
          { status: 409 },
        );
      }

      const services = Array.isArray(parsed.services)
        ? parsed.services.filter((s): s is string => typeof s === 'string')
        : [];
      const invalid = services.filter((s) => !ALLOWED.has(s));
      if (services.length === 0 || invalid.length > 0) {
        return Response.json(
          {
            ok: false,
            error: `services must be a non-empty subset of {backend-api, backend-worker, sandbox}${
              invalid.length ? `; rejected: ${invalid.join(', ')}` : ''
            }`,
          },
          { status: 400 },
        );
      }

      // `backend-api` is co-located with the caller (the route that signed
      // this request). Restarting it synchronously would sever this
      // connection before the reply is flushed, so a successful restart would
      // surface as a network error. Restart the others now; defer the api
      // until just after the response is sent.
      const immediate = services.filter((s) => s !== 'backend-api');
      const deferred = services.filter((s) => s === 'backend-api');

      const restarted: string[] = [];
      const errors: string[] = [];
      for (const svc of immediate) {
        const r = await restartService(svc);
        restarted.push(...r.restarted);
        errors.push(...r.errors);
      }

      // All-or-nothing: only schedule the deferred api bounce when the
      // immediate phase fully succeeded. A failed sibling restart must NOT
      // trigger a lone api bounce while the response already says
      // ok:false.
      const willDefer = deferred.length > 0 && errors.length === 0;
      if (willDefer) {
        setTimeout(() => {
          void (async () => {
            for (const svc of deferred) {
              const r = await restartService(svc);
              for (const line of r.restarted) {
                console.log(`[controller] deferred restart ${line}`);
              }
              for (const line of r.errors) {
                console.error(`[controller] deferred restart error: ${line}`);
              }
            }
          })();
        }, DEFERRED_RESTART_DELAY_MS);
      }

      return Response.json({
        ok: errors.length === 0,
        restarted,
        scheduled: willDefer ? deferred : [],
        errors,
      });
    }

    return new Response('not found', { status: 404 });
  },
});

console.log(
  `[controller] listening on :${PORT} — allowlist {backend-api, backend-worker, sandbox}, project=${PROJECT ?? '(any)'}`,
);
