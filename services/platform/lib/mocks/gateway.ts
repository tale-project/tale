/**
 * The unified mock gateway.
 *
 * One Bun HTTP server fronts every third-party API the platform calls, offline
 * and deterministically:
 *
 *   - `GET  /health`                  → readiness probe (Playwright `webServer.url`).
 *   - `POST /v1/chat/completions`     → the chat override (SSE + scenarios) — the one
 *                                       route Prism can't serve.
 *   - `…/v1/*`                        → OpenAI-compatible AI endpoints, served from
 *                                       `specs/providers/openai-compat.openapi.yaml`.
 *   - `…/mock/<connector>/*`        → per-connector spec (GitHub, Slack, …).
 *
 * Each spec is mounted at its `mountPrefix` (registry.ts); the prefix is stripped
 * before Prism matches an operation, so spec paths mirror the real upstream
 * (`/repos/{owner}/{repo}`, `/api/conversations.list`, …). Built once per spec at
 * boot; reused per request.
 */

import { existsSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

import {
  handleChatCompletions,
  isChatCompletionsRoute,
} from './overrides/chat-completions';
import { handleEmbeddings, isEmbeddingsRoute } from './overrides/embeddings';
import { MockInstance, type MockResponse } from './prism-instance';
import { MOCK_SPECS } from './registry';

export interface GatewayHandle {
  port: number;
  baseUrl: string;
  stop: () => void;
}

interface MountedInstance {
  mountPrefix: string;
  instance: MockInstance;
}

/** Parse `Prefer: code=NNN` → forced response status, else undefined. */
function preferredStatus(headers: Headers): number | undefined {
  const prefer = headers.get('prefer');
  if (!prefer) return undefined;
  const match = /(?:^|[;,\s])code=(\d{3})/.exec(prefer);
  return match ? Number(match[1]) : undefined;
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    // Drop the client's `Accept` header before handing the request to Prism.
    // Real connectors send vendor media types (e.g. GitHub's
    // `application/vnd.github+json`) that our spec responses declare as plain
    // `application/json`, so Prism's content negotiation would 406
    // ("NOT_ACCEPTABLE"). The gateway serves leniently — always return the
    // spec example — so let negotiation fall back to the default representation.
    if (key.toLowerCase() === 'accept') return;
    out[key] = value;
  });
  return out;
}

function queryToObject(
  searchParams: URLSearchParams,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const all = searchParams.getAll(key);
    out[key] = all.length > 1 ? all : (all[0] ?? '');
  }
  return out;
}

/** Read the request body as the structure Prism expects (parsed JSON or text). */
async function readBody(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const contentType = request.headers.get('content-type') ?? '';
  const text = await request.text();
  if (text.length === 0) return undefined;
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function toResponse(result: MockResponse): Response {
  const headers = new Headers(result.headers);
  const body = result.body;
  if (body === undefined || body === null) {
    return new Response(null, { status: result.statusCode, headers });
  }
  if (typeof body === 'string') {
    return new Response(body, { status: result.statusCode, headers });
  }
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Response(JSON.stringify(body), {
    status: result.statusCode,
    headers,
  });
}

/** Longest-prefix match so `/v1` never shadows a more specific mount. */
function matchMount(
  pathname: string,
  mounts: readonly MountedInstance[],
): MountedInstance | undefined {
  let best: MountedInstance | undefined;
  for (const mount of mounts) {
    if (
      pathname === mount.mountPrefix ||
      pathname.startsWith(`${mount.mountPrefix}/`)
    ) {
      if (!best || mount.mountPrefix.length > best.mountPrefix.length) {
        best = mount;
      }
    }
  }
  return best;
}

/**
 * Build every Prism instance declared in the registry. A registered-but-not-yet
 * -authored spec is skipped (not fatal) so the gateway boots incrementally as
 * specs land; calls to its mount then 404.
 */
async function buildMounts(): Promise<MountedInstance[]> {
  const mounts: MountedInstance[] = [];
  for (const spec of MOCK_SPECS) {
    if (!existsSync(spec.specPath)) {
      console.warn(
        `[mocks] spec for ${spec.label} not found at ${spec.specPath} — skipping ${spec.mountPrefix}`,
      );
      continue;
    }
    const instance = await MockInstance.fromSpec(spec.name, spec.specPath, {
      // Serve leniently so the live app/e2e never 422s on a benign mismatch.
      validateRequest: false,
    });
    mounts.push({ mountPrefix: spec.mountPrefix, instance });
    console.log(
      `[mocks] mounted ${spec.label} at ${spec.mountPrefix} (${instance.operationCount} ops)`,
    );
  }
  return mounts;
}

/**
 * Build the framework-agnostic request handler — a `(Request) => Response`
 * function over Web standard types. `startGateway` wraps it in `Bun.serve`;
 * contract tests drive it directly (via a mocked `fetch`) so they need no
 * server, port, or Bun runtime.
 */
export async function createGatewayHandler(): Promise<
  (request: Request) => Promise<Response>
> {
  const mounts = await buildMounts();
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'GET' && pathname === '/health') {
      return new Response('ok');
    }

    // The one non-spec route: deterministic streaming chat.
    if (isChatCompletionsRoute(request.method, pathname)) {
      return handleChatCompletions(request);
    }

    // Real-shaped embeddings (Prism's spec example is 1-dimensional, which
    // the knowledge-db's vector(1536) column rejects).
    if (isEmbeddingsRoute(request.method, pathname)) {
      return handleEmbeddings(request);
    }

    const mount = matchMount(pathname, mounts);
    if (!mount) {
      console.warn(`[mocks] no mount for ${request.method} ${pathname}`);
      return new Response('not found', { status: 404 });
    }

    const strippedPath = pathname.slice(mount.mountPrefix.length) || '/';
    try {
      const result = await mount.instance.respond({
        method: request.method,
        path: strippedPath,
        query: queryToObject(url.searchParams),
        headers: headersToObject(request.headers),
        body: await readBody(request),
        forceStatus: preferredStatus(request.headers),
      });
      return toResponse(result);
    } catch (error) {
      console.warn(
        `[mocks] ${mount.instance.name} ${request.method} ${strippedPath}: ${String(error)}`,
      );
      return Response.json(
        { error: 'mock_route_not_resolved', detail: String(error) },
        { status: 404 },
      );
    }
  };
}

/**
 * Node `http` adapter for the fetch-style handler. Used when the gateway runs
 * outside Bun (e.g. inside the vitest contract test workers, which don't expose
 * the `Bun` global). Production launches via `bun lib/mocks/start.ts` and take
 * the `Bun.serve` path below.
 */
async function startNodeGateway(
  handle: (request: Request) => Promise<Response>,
  port: number,
): Promise<GatewayHandle> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
        );
      }
      const method = req.method ?? 'GET';
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const entry of value) headers.append(key, entry);
        } else {
          headers.set(key, value);
        }
      }
      const hasBody =
        method !== 'GET' && method !== 'HEAD' && chunks.length > 0;
      const request = new Request(`http://127.0.0.1${req.url ?? '/'}`, {
        method,
        headers,
        body: hasBody ? Buffer.concat(chunks) : undefined,
      });
      const response = await handle(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    })().catch((error) => {
      console.error(`[mocks] node gateway error: ${String(error)}`);
      res.statusCode = 500;
      res.end();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  const boundPort =
    address !== null && typeof address === 'object' ? address.port : port;
  const baseUrl = `http://127.0.0.1:${boundPort}`;
  console.log(`[mocks] gateway listening on ${baseUrl}`);
  return {
    port: boundPort,
    baseUrl,
    stop: () => server.close(),
  };
}

/**
 * Build the handler and start an HTTP server on `port` (0 = ephemeral). Uses
 * `Bun.serve` under Bun (production launch) and a node `http` adapter otherwise.
 */
export async function startGateway(port = 4141): Promise<GatewayHandle> {
  const handle = await createGatewayHandler();
  if (typeof Bun === 'undefined') {
    return startNodeGateway(handle, port);
  }
  const server = Bun.serve({ port, hostname: '127.0.0.1', fetch: handle });
  const boundPort = server.port ?? port;
  const baseUrl = `http://127.0.0.1:${boundPort}`;
  console.log(`[mocks] gateway listening on ${baseUrl}`);
  return {
    port: boundPort,
    baseUrl,
    stop: () => server.stop(true),
  };
}
