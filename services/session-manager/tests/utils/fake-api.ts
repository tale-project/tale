import { vi } from 'vitest';

/**
 * A stand-in for the session manager's HTTP API in component tests. Routes are
 * written as `METHOD /path` against the API root (`GET /sessions`,
 * `POST /sessions/:id/start`); a handler answers with a JSON body, or with a
 * `FakeAnswer` to choose the status and headers. A call that no route matches
 * fails the test: the page asked for something the test did not expect.
 */
export interface FakeRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}

export type FakeAnswer = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined };

/** What a route answers: a JSON value, a `FakeAnswer`, or a function of the request. */
export type FakeRoute = Handler | JsonValue | FakeAnswer | undefined;
type Handler = (request: FakeRequest) => FakeRoute | Promise<FakeRoute>;

export interface FakeApi {
  /** Every call so far, in order. */
  calls: FakeRequest[];
  /** The calls to one route, e.g. `calls('POST /sessions')`. */
  callsTo(route: string): FakeRequest[];
  /** Replace the answer of a route. */
  on(route: string, handler: FakeRoute): void;
}

function isAnswer(value: unknown): value is FakeAnswer & { __answer: true } {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__answer' in value &&
    value.__answer === true
  );
}

/** An answer with a status and headers: `answer({ status: 409, body: {...} })`. */
export function answer(init: FakeAnswer): FakeAnswer & { __answer: true } {
  return { ...init, __answer: true };
}

/** The shape of an error answer: `{ error: <code>, message }`. */
export function failure(
  status: number,
  code: string,
  message = code,
  extra: Record<string, unknown> = {},
) {
  return answer({ status, body: { ...extra, error: code, message } });
}

/** A list answer with its `X-Total-Count`. */
export function list(items: readonly unknown[], total = items.length) {
  return answer({ body: items, headers: { 'X-Total-Count': String(total) } });
}

/**
 * The answer of the server to a request for part of a list: of `rows`, newest
 * (highest id) first, the ones below `before` and from `minId` up, at most
 * `limit` of them. `total` is the size of the whole list, when the test lets
 * `rows` stand for more than it holds. A fake that sends the same rows to every
 * request sends a page that reads on for ever.
 */
export function listFor(
  query: URLSearchParams,
  rows: readonly { id: number }[],
  total = rows.length,
) {
  const before = query.get('before');
  const minId = query.get('minId');
  const limit = query.get('limit');
  const part = rows
    .filter((row) => before === null || row.id < Number(before))
    .filter((row) => minId === null || row.id >= Number(minId))
    .slice(0, limit === null ? undefined : Number(limit));
  return list(part, total);
}

function compile(route: string) {
  const [method, path] = route.split(' ');
  if (method === undefined || path === undefined) {
    throw new Error(`a fake route reads "METHOD /path", got "${route}"`);
  }
  const names: string[] = [];
  const pattern = path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    names.push(name);
    return '([^/]+)';
  });
  return { method, regex: new RegExp(`^${pattern}$`), names };
}

function isHandler(value: FakeRoute): value is Handler {
  return typeof value === 'function';
}

export function installFakeApi(routes: Record<string, FakeRoute>) {
  const table = new Map<string, { handler: FakeRoute }>(
    Object.entries(routes).map(([route, handler]) => [route, { handler }]),
  );
  const compiled = new Map(
    [...table.keys()].map((route) => [route, compile(route)]),
  );
  const calls: FakeRequest[] = [];

  const fetchStub = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const target =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(target, 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      const path = url.pathname.replace(/^\/api/, '');
      for (const [route, { regex, names, method: routeMethod }] of compiled) {
        const match = regex.exec(path);
        if (routeMethod !== method || !match) continue;
        const params = Object.fromEntries(
          names.map((name, index) => [name, match[index + 1] ?? '']),
        );
        const request: FakeRequest = {
          method,
          path,
          params,
          query: url.searchParams,
          body:
            typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        };
        calls.push(request);
        const entry = table.get(route);
        const result = isHandler(entry?.handler)
          ? await entry.handler(request)
          : entry?.handler;
        const reply: FakeAnswer = isAnswer(result) ? result : { body: result };
        const status = reply.status ?? (reply.body === undefined ? 204 : 200);
        return new Response(
          reply.body === undefined || status === 204
            ? null
            : JSON.stringify(reply.body),
          {
            status,
            headers: {
              'Content-Type': 'application/json',
              ...reply.headers,
            },
          },
        );
      }
      throw new Error(
        `The page made a call no fake route answers: ${method} ${path}`,
      );
    },
  );
  vi.stubGlobal('fetch', fetchStub);

  const api: FakeApi = {
    calls,
    callsTo: (route) => {
      const { method, regex } = compile(route);
      return calls.filter(
        (call) => call.method === method && regex.test(call.path),
      );
    },
    on: (route, handler) => {
      table.set(route, { handler });
      compiled.set(route, compile(route));
    },
  };
  return api;
}
