// A stub Docker Engine API on a temporary Unix socket, for tests: it answers
// the version ping, container inspects and container listings the way the
// daemon does, and records every request it was asked.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface EngineStub {
  /** The socket path; DOCKER_HOST is `unix://` + this. */
  readonly socket: string;
  /** Every request, as `METHOD /path?query` with the query decoded. */
  readonly requests: string[];
  /** Inspect documents by the name or id they answer to. */
  readonly containers: Map<string, unknown>;
  /** What `GET /containers/json` lists before its filters apply. */
  listing: Record<string, unknown>[];
  /** The `API-Version` the ping names; null names none. */
  apiVersion: string | null;
  /** Answers a request before the stub does, when it returns a response. */
  intercept:
    | ((
        request: Request,
        path: string,
      ) => Response | undefined | Promise<Response | undefined>)
    | null;
  stop(): Promise<void>;
}

/** A JSON answer as the daemon sends one: its Content-Type is exactly
 * `application/json`, which is what the CLI reads an error's message by. */
export function engineJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The daemon's label filter: every `key` or `key=value` must hold. */
function labelsMatch(
  container: Record<string, unknown>,
  wanted: readonly string[],
): boolean {
  const held = container.Labels;
  const labels = new Map<string, unknown>(
    held !== null && typeof held === 'object' ? Object.entries(held) : [],
  );
  return wanted.every((filter) => {
    const equals = filter.indexOf('=');
    return equals === -1
      ? labels.has(filter)
      : labels.get(filter.slice(0, equals)) === filter.slice(equals + 1);
  });
}

/** The label filter of a listing's query: the daemon takes its values as a
 * list, or as the keys of a map, which is how the docker CLI sends them. */
function labelFilter(query: URLSearchParams): string[] {
  const filters: unknown = JSON.parse(query.get('filters') ?? '{}');
  const label: unknown =
    filters !== null && typeof filters === 'object'
      ? Reflect.get(filters, 'label')
      : undefined;
  if (Array.isArray(label)) return label.map(String);
  return label !== null && typeof label === 'object' ? Object.keys(label) : [];
}

export async function startEngineStub(): Promise<EngineStub> {
  const dir = await mkdtemp(join(tmpdir(), 'tale-engine-stub-'));
  const socket = join(dir, 'docker.sock');
  const stub: EngineStub = {
    socket,
    requests: [],
    containers: new Map(),
    listing: [],
    apiVersion: '1.47',
    intercept: null,
    stop: async () => {
      await server.stop(true);
      await rm(dir, { recursive: true, force: true });
    },
  };
  const server = Bun.serve({
    unix: socket,
    async fetch(request) {
      const url = new URL(request.url);
      stub.requests.push(
        `${request.method} ${url.pathname}${decodeURIComponent(url.search)}`,
      );
      const intercepted = await stub.intercept?.(request, url.pathname);
      if (intercepted !== undefined) return intercepted;
      if (url.pathname === '/_ping') {
        return new Response('OK', {
          headers:
            stub.apiVersion === null ? {} : { 'Api-Version': stub.apiVersion },
        });
      }
      const path = url.pathname.replace(/^\/v\d+\.\d+/, '');
      if (path === '/containers/json') {
        const wanted = labelFilter(url.searchParams);
        const all = url.searchParams.get('all') === '1';
        return engineJson(
          stub.listing.filter(
            (container) =>
              (all || container.State === 'running') &&
              labelsMatch(container, wanted),
          ),
        );
      }
      const inspect = /^\/containers\/([^/]+)\/json$/.exec(path);
      if (inspect?.[1] !== undefined) {
        const ref = decodeURIComponent(inspect[1]);
        const container = stub.containers.get(ref);
        return container === undefined
          ? engineJson({ message: `No such container: ${ref}` }, 404)
          : engineJson(container);
      }
      return engineJson({ message: 'page not found' }, 404);
    },
  });
  return stub;
}
