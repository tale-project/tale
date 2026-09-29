import { vi } from 'vitest';

type Reply = (url: URL) => Response | Promise<Response>;

/**
 * A closed synthetic transport for the app's `/api/app` doors: `fetch` is
 * stubbed, every request is recorded, and each one is answered by the most
 * recent route whose pattern matches its path and query. A test can fail one
 * read, count its attempts, heal it and watch the same mounted screen
 * recover — the real hooks, adapters and retry policy run unchanged, and
 * nothing can reach a network.
 */
export interface SyntheticBackend {
  /** Every request so far, as `METHOD /path?query` (origin stripped). */
  readonly calls: string[];
  /** Answer requests whose `METHOD /path?query` matches `pattern` with
   * `reply`, from now on (a later route for the same pattern wins). */
  on(pattern: RegExp, reply: Reply): void;
  /** How many requests so far matched `pattern` (same form as `on`). */
  count(pattern: RegExp): number;
}

export function syntheticBackend(): SyntheticBackend {
  const routes: Array<{ pattern: RegExp; reply: Reply }> = [];
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    );
    const call = `${init?.method ?? 'GET'} ${url.pathname}${url.search}`;
    calls.push(call);
    for (let index = routes.length - 1; index >= 0; index -= 1) {
      const route = routes[index];
      if (route !== undefined && route.pattern.test(call)) {
        return route.reply(url);
      }
    }
    return Response.json(
      { error: 'NOT_FOUND', code: 'NOT_FOUND' },
      {
        status: 404,
      },
    );
  });
  return {
    calls,
    on(pattern, reply) {
      routes.push({ pattern, reply });
    },
    count(pattern) {
      return calls.filter((call) => pattern.test(call)).length;
    },
  };
}

/** A fault the retry policy retries: the door answered, but not with data. */
export function serviceUnavailable(): Response {
  return Response.json(
    { error: 'Service unavailable', code: 'INTERNAL' },
    { status: 503 },
  );
}
