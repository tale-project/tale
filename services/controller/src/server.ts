// Tale Controller — privileged control-plane sidecar.
//
// A dedicated, internal-only service that performs the ONE privileged action
// the browser-facing platform must not: restarting sibling containers so a
// deployment-config change (external knowledge Postgres / Convex S3 storage)
// takes effect. It mounts the docker socket (host root — same accepted threat
// boundary as the sandbox spawner) but is far more constrained: HMAC-signed
// requests only, a hard service allowlist of {rag, convex}, and only
// list+restart (no run/exec). Reachable only on the internal network.

import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from './auth.ts';
import {
  dockerReachable,
  listContainerIds,
  restartContainer,
} from './docker.ts';

const TOKEN = process.env.CONTROLLER_TOKEN ?? '';
const PORT = Number(process.env.CONTROLLER_PORT ?? 8004);
// Scope restarts to this compose project so we never touch another stack.
const PROJECT =
  process.env.COMPOSE_PROJECT_NAME ||
  process.env.CONTROLLER_PROJECT ||
  undefined;

/** Hard allowlist — the only services this control plane may ever restart. */
const ALLOWED = new Set(['rag', 'convex']);

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

      let parsed: { services?: unknown };
      try {
        parsed = JSON.parse(body);
      } catch {
        return Response.json(
          { ok: false, error: 'invalid JSON' },
          { status: 400 },
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
            error: `services must be a non-empty subset of {rag, convex}${
              invalid.length ? `; rejected: ${invalid.join(', ')}` : ''
            }`,
          },
          { status: 400 },
        );
      }

      const restarted: string[] = [];
      const errors: string[] = [];
      for (const svc of services) {
        try {
          const ids = await listContainerIds(PROJECT, svc);
          if (ids.length === 0) {
            errors.push(`${svc}: no running container found`);
            continue;
          }
          for (const id of ids) {
            await restartContainer(id);
            restarted.push(`${svc}:${id.slice(0, 12)}`);
          }
        } catch (err) {
          errors.push(
            `${svc}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      return Response.json({ ok: errors.length === 0, restarted, errors });
    }

    return new Response('not found', { status: 404 });
  },
});

console.log(
  `[controller] listening on :${PORT} — allowlist {rag, convex}, project=${PROJECT ?? '(any)'}`,
);
