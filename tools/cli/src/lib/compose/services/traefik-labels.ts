/**
 * The edge's routes, declared by the service that serves them.
 *
 * The proxy (services/proxy) runs Traefik, which reads these labels through
 * the read-only Docker API proxy (the `docker-api` service). It routes only a
 * container that carries `traefik.enable=true` and belongs to one of this
 * deployment's Compose projects (`TALE_PROXY_PROJECTS`). What belongs to the
 * edge rather than to one service lives in the proxy's own rules
 * (services/proxy/render/config.js), and the `@file` middlewares and services
 * named here are defined there: the host guard, BASE_PATH, the dot-segment
 * and control-plane refusals, the metrics gate, and the answers given while a
 * service is absent.
 *
 * A colour names its routers and services with the colour (`platform-blue`):
 * two containers that declare one name with different settings make Traefik
 * drop the router, and blue and green overlap during a cutover. Every one
 * points at the shared alias, so the cutover stays DNS-driven: the lifecycle
 * detaches the old colour from the network before it removes it.
 *
 * Priorities, highest first: the edge's refusals (500–1000); the object store
 * and the sandbox tunnel (300); the platform's health probe (200); the
 * backend's lanes (100–120); the edge's answer while the backend is absent
 * (90); the platform's machine doors (50–60) and pages (2); the edge's answers
 * while the platform is absent (1–3).
 */

/** Every path the backend serves. The edge answers the same rule while the
 *  backend is absent (`tale-absent-backend` in services/proxy/render/config.js,
 *  pinned equal by services/proxy/render/config.test.ts). */
export const BACKEND_LANES =
  '(?i)^/(api/|events$|dav/|scim/v2/|http_api/(api/sso|scim/v2|api/trusted-headers|api/cloud-import/oauth2)/|[.]well-known/oauth-(authorization-server/|protected-resource))';

/** Backend lanes a machine calls at volume, kept out of the access log: the
 *  tools and connector bridges, Slack's events and the automation webhooks. */
const BACKEND_QUIET =
  '(?i)^/api/(tools/|connectors/(execute|status|hostcall)$|connectors/slack/|automations/webhook/)';

/** The backend's sync WebSockets, which a compressor would break. */
const BACKEND_STREAMS = '(?i)^/api/.+/sync$';

/** The lanes a program calls on the platform, which get a JSON answer rather
 *  than the maintenance page when the platform fails; the edge answers them
 *  so while the platform is absent (`MACHINE_DOORS` in its config.js). */
export const PLATFORM_MACHINE_DOORS =
  '(?i)^/((api|scim|http_api)(/|$)|(events|status[.]json|openapi[.]json)$|[.]well-known/)';

interface Router {
  rule: string;
  priority: number;
  service: string;
  middlewares?: string[];
  /** No access log line: the path carries a signature or comes at volume. */
  quiet?: boolean;
}

interface Service {
  url: string;
  healthPath?: string;
}

/** Compose interpolates `$` in a label; a rule's regex anchor is literal. */
function literal(value: string): string {
  return value.replaceAll('$', () => '$$');
}

function labels(
  routers: Record<string, Router>,
  services: Record<string, Service>,
): Record<string, string> {
  const out: Record<string, string> = { 'traefik.enable': 'true' };
  for (const [name, router] of Object.entries(routers)) {
    const key = `traefik.http.routers.${name}`;
    out[`${key}.rule`] = router.rule;
    out[`${key}.priority`] = String(router.priority);
    out[`${key}.service`] = router.service;
    if (router.middlewares) {
      out[`${key}.middlewares`] = router.middlewares.join(',');
    }
    if (router.quiet) out[`${key}.observability.accesslogs`] = 'false';
  }
  for (const [name, service] of Object.entries(services)) {
    const key = `traefik.http.services.${name}.loadbalancer`;
    out[`${key}.server.url`] = service.url;
    if (service.healthPath) {
      out[`${key}.healthcheck.path`] = service.healthPath;
      out[`${key}.healthcheck.interval`] = '5s';
      out[`${key}.healthcheck.timeout`] = '2s';
    }
  }
  return out;
}

function named(service: string, color?: string): string {
  return color ? `${service}-${color}` : service;
}

/**
 * The platform: its pages, with compression and the maintenance page while it
 * fails; its machine doors, with the JSON answer instead; Convex's WebSocket;
 * and `/api/health` straight through, so a draining replica's 503 reaches the
 * probe instead of the health check's own.
 */
export function platformLabels(color?: string): Record<string, string> {
  const name = named('platform', color);
  return labels(
    {
      [`${name}-health`]: {
        rule: literal('PathRegexp(`(?i)^/api/health$`)'),
        priority: 200,
        service: `${name}-direct`,
      },
      [`${name}-ws`]: {
        rule: 'PathPrefix(`/ws_api/`)',
        priority: 60,
        service: name,
      },
      [`${name}-doors`]: {
        rule: literal(`PathRegexp(\`${PLATFORM_MACHINE_DOORS}\`)`),
        priority: 50,
        service: name,
        middlewares: ['tale-compress@file', 'tale-unavailable-json@file'],
      },
      [name]: {
        rule: 'PathPrefix(`/`)',
        priority: 2,
        service: name,
        middlewares: ['tale-compress@file', 'tale-unavailable-page@file'],
      },
    },
    {
      [name]: { url: 'http://platform:3000', healthPath: '/api/health' },
      [`${name}-direct`]: { url: 'http://platform:3000' },
    },
  );
}

/**
 * The backend API. Its own 502–504 carry meaning (the model relay, the image
 * proxy, DATABASE_UNAVAILABLE), so no lane rewrites an error.
 */
export function backendApiLabels(color?: string): Record<string, string> {
  const name = named('backend-api', color);
  return labels(
    {
      [`${name}-streams`]: {
        rule: literal(`PathRegexp(\`${BACKEND_STREAMS}\`)`),
        priority: 120,
        service: name,
      },
      [`${name}-quiet`]: {
        rule: literal(`PathRegexp(\`${BACKEND_QUIET}\`)`),
        priority: 110,
        service: name,
        middlewares: ['tale-compress@file'],
        quiet: true,
      },
      [name]: {
        rule: literal(`PathRegexp(\`${BACKEND_LANES}\`)`),
        priority: 100,
        service: name,
        middlewares: ['tale-compress@file'],
      },
    },
    { [name]: { url: 'http://backend-api:3005' } },
  );
}

/**
 * The blob store, at its bucket's path. Forwarded verbatim (SigV4 signs the
 * host and the path) and kept out of the access log: a presigned URL carries
 * its signature in the query string.
 */
export function objectStoreLabels(): Record<string, string> {
  return labels(
    {
      'object-store': {
        rule: 'PathPrefix(`/${OBJECT_STORE_BUCKET:-tale-blobs}/`)',
        priority: 300,
        service: 'object-store',
        quiet: true,
      },
    },
    { 'object-store': { url: 'http://object-store:9000' } },
  );
}

/** The device tunnel `tale sandbox connect` dials into the spawner's hub. */
export function sandboxLabels(): Record<string, string> {
  return labels(
    {
      sandbox: {
        rule: 'Path(`/sandbox/tunnel`)',
        priority: 300,
        service: 'sandbox',
      },
    },
    { sandbox: { url: 'http://sandbox:8004' } },
  );
}
