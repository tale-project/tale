/**
 * The helpers `backend/integration-check.ts` shares with the lanes that live
 * in modules of their own (`*.integration.ts`), so a lane never carries a
 * second copy of the suite's cookie handling or its throwaway sign-up.
 */
import { z } from 'zod';

/** The password every throwaway `itest-` user signs up with. */
export const ITEST_PASSWORD = 'itest-password-1';

/** How a lane records one check: the harness's `record`. */
export type RecordCheck = (name: string, ok: boolean, detail: string) => void;

/**
 * `ITEST_REQUIRE_ALL_LANES=1` asks for full coverage, the mode a gating run
 * uses: the harness refuses to start without what every lane needs
 * ({@link fullCoverageBlockers}), and a check that cannot run fails instead
 * of reporting a skip ({@link recordSkip}).
 */
export function everyLaneRequired(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.ITEST_REQUIRE_ALL_LANES === '1';
}

/** The lane names `ITEST_LANES` asks for, or null for the full run. */
export function requestedLanes(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> | null {
  const raw = env.ITEST_LANES?.trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );
}

/** The S3-compatible store the blob lanes write to. */
export interface ItestObjectStore {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * The run's object store (`ITEST_S3_ENDPOINT`), or null when it has none.
 * The credentials default to MinIO's own (`minioadmin`), so the endpoint
 * alone is the documented minimum.
 */
export function itestObjectStore(
  env: NodeJS.ProcessEnv = process.env,
): ItestObjectStore | null {
  const endpoint = env.ITEST_S3_ENDPOINT?.trim();
  if (!endpoint) return null;
  return {
    endpoint,
    accessKeyId: env.ITEST_S3_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: env.ITEST_S3_SECRET_KEY ?? 'minioadmin',
  };
}

/**
 * Why this run cannot cover every lane when it must, or nothing: a lane
 * filter, or an object-store variable left to its default. Only a run with
 * {@link everyLaneRequired} is judged; the harness refuses to start with any
 * blocker, before a single lane has run.
 */
export function fullCoverageBlockers(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (!everyLaneRequired(env)) return [];
  const blockers: string[] = [];
  const lanes = requestedLanes(env);
  if (lanes !== null) {
    blockers.push(
      `ITEST_LANES runs only ${[...lanes].join(', ')}, not every lane`,
    );
  }
  if (!env.ITEST_S3_ENDPOINT?.trim()) {
    blockers.push('ITEST_S3_ENDPOINT is unset, so no blob lane can run');
  }
  for (const name of ['ITEST_S3_ACCESS_KEY', 'ITEST_S3_SECRET_KEY']) {
    if (!env[name]?.trim()) {
      blockers.push(
        `${name} is unset, so the blob lanes would sign with MinIO's default credentials`,
      );
    }
  }
  return blockers;
}

/**
 * Records a check that cannot run here, and why. Every skip in the suite
 * goes through this. A local run reports it as a skip: a pass whose name
 * says `(SKIPPED)`, counted apart in the tally. A run with
 * {@link everyLaneRequired} records a failure instead, so a lane can never
 * drop out of a gating run unnoticed.
 */
export function recordSkip(
  record: RecordCheck,
  name: string,
  reason: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (everyLaneRequired(env)) {
    record(
      name,
      false,
      `DID NOT RUN: ${reason} (ITEST_REQUIRE_ALL_LANES=1 needs every lane to run)`,
    );
    return;
  }
  record(`${name} (SKIPPED)`, true, reason);
}

/** Does this check name mark a skip {@link recordSkip} reported? */
export function isSkippedCheck(name: string): boolean {
  return name.endsWith(' (SKIPPED)');
}

/** The `Cookie` header a browser would send after `response`. */
export function cookieHeaderFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0] ?? '')
    .filter((pair) => pair.length > 0)
    .join('; ');
}

/**
 * A fresh user signed up through Better Auth (with {@link ITEST_PASSWORD})
 * and a member of NO organization yet — what a lane needs when the
 * membership itself is what it exercises (the members API, an org the user
 * goes on to create and own) or when the probe is about the account alone.
 * `signUpOrgMember` builds on it; a lane that only needs another pair of
 * hands in the suite's org wants that one. `userId` is empty when the
 * sign-up was refused.
 */
export async function signUpUser(
  base: string,
  label: string,
): Promise<{ cookie: string; userId: string; email: string }> {
  const email = `itest-${label}-${Date.now()}@example.com`;
  const res = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({
      email,
      password: ITEST_PASSWORD,
      name: `Itest ${label}`,
    }),
  });
  const parsed = z
    .object({ user: z.object({ id: z.string() }) })
    .safeParse(await res.json());
  return {
    cookie: cookieHeaderFrom(res),
    userId: parsed.success ? parsed.data.user.id : '',
    email,
  };
}

/** A thrown value as `Name: message`, whatever was thrown. */
export function errorText(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

/** `ms` as the harness names a deadline: whole minutes, else seconds. */
function deadlineText(ms: number): string {
  return ms >= 60_000 && ms % 60_000 === 0
    ? `${ms / 60_000} min`
    : `${ms / 1_000} s`;
}

/**
 * Settles `work`, or rejects naming `what` once `ms` have passed — so a
 * lane (or a probe between lanes) that never settles truncates the run
 * under its own name instead of holding the job until CI's wall clock
 * kills it 30 minutes later, with nothing in the log to say which lane.
 */
export async function withinDeadline<T>(
  work: Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${what} did not settle within ${deadlineText(ms)}`));
    }, ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** One server-sent event, as {@link connectSse} collects it. */
export interface SseEvent {
  event: string;
  id: string | null;
  data: string;
}

/** An open SSE tail, collecting events until it is closed. */
export interface SseTail {
  /** Every event so far, in arrival order. */
  readonly events: SseEvent[];
  /** Settles once the stream has ended: the server ended it, or
   * {@link SseTail.close} did. Rejects only with another failure. */
  readonly done: Promise<void>;
  /** Ends the tail and waits for {@link SseTail.done}, at most
   * {@link SSE_CLOSE_DEADLINE_MS}: a tail that does not end fails the lane
   * in seconds, naming the stream. */
  close: () => Promise<void>;
}

/** How long a closed tail may take to settle; a healthy one ends at once. */
const SSE_CLOSE_DEADLINE_MS = 5_000;

/**
 * Minimal SSE client for the lanes: collects events until closed.
 *
 * `close` cancels the body reader before it aborts the request, so the read
 * ends on this side whether or not the abort reaches the connection. An
 * abort alone travels the signal chain fetch builds, and a wrapper that drops
 * a link in it (the harness boundary once did, see `routeVendorFetch`) left a
 * closed `/events` tail reading heartbeats forever: its lane waited on
 * `done` until the lane deadline, and the open socket then held the
 * harness's own teardown (#4112).
 */
export function connectSse(
  url: string,
  headers: Record<string, string>,
  options: {
    fetch?: (url: string, init: RequestInit) => Promise<Response>;
    closeWithinMs?: number;
  } = {},
): SseTail {
  const fetchSse = options.fetch ?? ((at, init) => globalThis.fetch(at, init));
  const closeWithinMs = options.closeWithinMs ?? SSE_CLOSE_DEADLINE_MS;
  const parsed = new URL(url);
  const name = `the SSE tail ${parsed.pathname}${parsed.search}`;
  const controller = new AbortController();
  const events: SseEvent[] = [];
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const done = (async () => {
    const response = await fetchSse(url, {
      signal: controller.signal,
      headers,
    });
    const body = response.body;
    if (!body) {
      throw new Error('SSE response has no body');
    }
    reader = body.getReader();
    if (controller.signal.aborted) {
      // Closed while the response was on its way: nothing more to read.
      await reader.cancel();
      return;
    }
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = 'message';
        let id: string | null = null;
        const dataLines: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          } else if (line.startsWith('id:')) {
            id = line.slice(3).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }
        events.push({ event, id, data: dataLines.join('\n') });
        boundary = buffer.indexOf('\n\n');
      }
    }
  })().catch((error: unknown) => {
    if (!(error instanceof Error && error.name === 'AbortError')) {
      throw error;
    }
  });

  const close = async (): Promise<void> => {
    // Cancel first: the pending read ends at once, and the abort below then
    // finds no live body to error.
    reader?.cancel().catch((error: unknown) => {
      console.warn(`[itest] cancelling ${name} failed: ${errorText(error)}`);
    });
    controller.abort();
    await withinDeadline(done, closeWithinMs, `closing ${name}`);
  };

  return { events, done, close };
}

/** One step of the harness's teardown: what it does, and the work. */
export type TeardownStep = readonly [what: string, run: () => Promise<unknown>];

/** The longest one teardown step may take. Each is a close or one query. */
const TEARDOWN_STEP_DEADLINE_MS = 60_000;

/**
 * Runs the harness's teardown steps in order, each bounded by `stepMs`. A
 * step that throws or does not settle is recorded as a failed check naming
 * it, and the next step runs anyway: a run a lane left hanging (an open
 * `/events` tail, a held connection) still reaches its tally and its exit
 * code, instead of CI's step timeout with no tally at all (#4112).
 */
export async function settleTeardown(
  steps: readonly TeardownStep[],
  record: RecordCheck,
  stepMs: number = TEARDOWN_STEP_DEADLINE_MS,
): Promise<void> {
  for (const [what, run] of steps) {
    try {
      await withinDeadline(run(), stepMs, `the teardown step that ${what}`);
    } catch (error) {
      record(
        `harness: the teardown step that ${what} settles`,
        false,
        `${errorText(error)} — the harness went on to its tally regardless`,
      );
    }
  }
}
