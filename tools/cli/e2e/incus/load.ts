// Load through the stack's edge: pollers that ask each target over and over
// while a deploy runs, and the arithmetic that turns what they saw into the
// windows a target did not serve (design 15.5, R3-21, R3-36). The pollers go
// through the edge (`proxy`), never straight at the switch or a replica, so
// what they count is what a visitor sees: a 5xx, an edge 502/503/504, the
// maintenance page and an `UPSTREAM_UNAVAILABLE` answer are failures.

/** One answer a poller got, or the error in its place. */
export interface Sample {
  target: string;
  /** Milliseconds since the load started. */
  at: number;
  /** The HTTP status; 0 when the request itself failed. */
  status: number;
  ok: boolean;
  /** Why it failed, in a few words. */
  reason?: string;
}

/** A span a target answered nothing but failures. */
export interface Window {
  target: string;
  /** The first failure. */
  from: number;
  /** The first success after it; null when none came. */
  to: number | null;
  failures: number;
}

const MAINTENANCE = /maintenance|UPSTREAM_UNAVAILABLE/;

/** Whether an answer is what a visitor of a serving stack gets. */
export function judge(
  status: number,
  body: string,
): { ok: boolean; reason?: string } {
  if (status === 0) return { ok: false, reason: 'no answer' };
  if (status >= 500) return { ok: false, reason: `HTTP ${status}` };
  if (MAINTENANCE.test(body)) return { ok: false, reason: 'maintenance page' };
  if (status >= 400) return { ok: false, reason: `HTTP ${status}` };
  return { ok: true };
}

/**
 * The spans each target failed, in the order they began: from a failure to
 * the next success of the same target. A target that never failed has none.
 */
export function windowsOf(samples: readonly Sample[]): Window[] {
  const ordered = [...samples].sort((a, b) => a.at - b.at);
  const open = new Map<string, Window>();
  const windows: Window[] = [];
  for (const sample of ordered) {
    const current = open.get(sample.target);
    if (!sample.ok) {
      if (current === undefined) {
        const window: Window = {
          target: sample.target,
          from: sample.at,
          to: null,
          failures: 1,
        };
        open.set(sample.target, window);
        windows.push(window);
      } else current.failures += 1;
      continue;
    }
    if (current !== undefined) {
      current.to = sample.at;
      open.delete(sample.target);
    }
  }
  return windows;
}

/** A window's length in milliseconds; null while it never closed. */
export function lengthOf(window: Window): number | null {
  return window.to === null ? null : window.to - window.from;
}

export interface LoadTarget {
  name: string;
  url: string;
  /** Headers every request carries (the edge routes by `Host`). */
  headers?: Record<string, string>;
}

export interface Load {
  /** Stop asking and hand back every sample, in order. */
  stop(): Promise<Sample[]>;
}

/**
 * Ask every target every `intervalMs`, each request bounded by `timeoutMs`,
 * until `stop`. One request per target is in flight at a time, so a slow
 * answer delays the next sample instead of piling requests up.
 */
export function startLoad(
  targets: readonly LoadTarget[],
  options: {
    intervalMs?: number;
    timeoutMs?: number;
    fetch?: typeof fetch;
    now?: () => number;
  } = {},
): Load {
  const intervalMs = options.intervalMs ?? 100;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => performance.now());
  const started = now();
  const samples: Sample[] = [];
  const state = { running: true };

  const poll = async (target: LoadTarget) => {
    while (state.running) {
      const at = now() - started;
      let status = 0;
      let body = '';
      try {
        const response = await request(target.url, {
          headers: target.headers ?? {},
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        });
        status = response.status;
        body = (await response.text()).slice(0, 4096);
      } catch (error) {
        body = error instanceof Error ? error.message : String(error);
      }
      samples.push({ target: target.name, at, status, ...judge(status, body) });
      await Bun.sleep(intervalMs);
    }
  };
  const pollers = targets.map((target) => poll(target));
  return {
    async stop() {
      state.running = false;
      await Promise.all(pollers);
      return [...samples].sort((a, b) => a.at - b.at);
    },
  };
}
