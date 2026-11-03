// The real manager over fakes, for tests of the rules and of everything that
// sits on top of them (the HTTP routes, the live view, the MCP tools).
//
//     const app = createTestManager();
//     afterEach(() => app.close());
//
//     addProxy(app.manager, '192.0.2.1:8080');
//     const created = await createSession(app.manager, 'a');
//     const running = await waitForStatus(app.manager, created.id, 'running');
//     app.backend.latest().crash(); // the FakeBackend's browser
//     app.checker.setError('192.0.2.1:8080', 'boom'); // the FakeExitIpChecker
//
// `createTestManager(options?)` returns
//
//   manager   the `Manager` (`createManager`) over `store`, `backend`, `checker`
//   store     the real `Store` (`:memory:` by default); a test may add proxies to it
//             directly, which queues no check: the only checks are the ones the
//             rules make
//   backend   the `FakeBackend` (`../testing/fake-browser.ts`: read its header)
//   checker   the `FakeExitIpChecker` (`../testing/fake-exit-ip.ts`)
//   dataDir   a temporary directory: `profiles/<session id>` lives in it
//   dbPath    `<dataDir>/manager.db` with `store: 'file'`, else null
//   close()   closes the manager (every browser) and the store, and removes the
//             temporary directory; `close({ keepData: true })` keeps it, for a
//             test that opens the same directory again (`dataDir` option). The
//             `backend` is a fake: closing it is not needed.
//
// Options: `store` ('memory' | 'file'), `dataDir` (use this directory; it is
// never removed), `version`, your own `backend` / `checker`, and the manager's
// seams (`now`, `monotonic`, `sleep`, `shutdownTimeoutMs`, `checkConcurrency`,
// `startBridge`: see `ManagerDeps`).
//
// The helpers wrap the manager like `tests/helpers/api.py` wrapped the API:
//
//   addProxy(manager, text, options?)         adds a proxy (checked in the background)
//   createSession(manager, name?, options?)   creates, and so starts, a session
//   getSession(manager, id)                   the session as the list shows it
//   waitFor(manager, id, done, timeoutMs?)    polls until `done(session)`
//   waitForStatus(manager, id, status, ...)   until it has the status and no background
//                                             activity ("starting" with "launching" is not "running" yet)
//   settled(manager, id, timeoutMs?)          until its background work is over
//   waitForChecks(manager, timeoutMs?)        until no proxy check is queued or running
//   seedProxy(store, n, options?)             adds 192.0.2.<n>:8080 through the store, with no check
//                                             queued (`ok`: true/false stores a check result; the fake
//                                             checker sees it exit through 203.0.113.<n>); returns its id
//   refusalOf(action)                         the `AppError` an action (sync or async) is refused with
//
// Waits poll the manager with a real timer taken before any test replaces the
// clock, so they also work next to `vi.useFakeTimers()`; they fail with the
// state the session was in after `timeoutMs` (5 s).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  Proxy,
  Scheme,
  Session,
  SessionStatus,
} from '../../lib/api/schemas.ts';
import { openStore } from '../db/store.ts';
import type { Store } from '../db/store.ts';
import { parseProxy } from '../domains/proxies/parsing.ts';
import type { Manager } from '../domains/sessions/manager.ts';
import { createManager } from '../domains/sessions/service.ts';
import type { ManagerDeps } from '../domains/sessions/service.ts';
import { AppError } from '../errors.ts';
import { FakeBackend } from './fake-browser.ts';
import { FakeExitIpChecker } from './fake-exit-ip.ts';

// Taken now: a test that fakes the timers later must not stop the polls.
const realSetTimeout = globalThis.setTimeout;
const realNow = Date.now.bind(Date);

const POLL_MS = 2;
const DEFAULT_TIMEOUT_MS = 5000;

type Seams = Pick<
  ManagerDeps,
  | 'now'
  | 'monotonic'
  | 'sleep'
  | 'shutdownTimeoutMs'
  | 'checkConcurrency'
  | 'startBridge'
>;

export interface TestManagerOptions extends Seams {
  /** Default `memory`. `file`: `<dataDir>/manager.db`. */
  store?: 'memory' | 'file';
  /** Use this directory (it must exist). It is never removed. */
  dataDir?: string;
  version?: string;
  backend?: FakeBackend;
  checker?: FakeExitIpChecker;
}

export interface TestManager {
  manager: Manager;
  store: Store;
  backend: FakeBackend;
  checker: FakeExitIpChecker;
  dataDir: string;
  /** The database file; `null` for `:memory:`. */
  dbPath: string | null;
  close(options?: { keepData?: boolean }): Promise<void>;
}

export function createTestManager(
  options: TestManagerOptions = {},
): TestManager {
  const {
    store: kind = 'memory',
    dataDir: given,
    version = 'test',
    backend = new FakeBackend(),
    checker = new FakeExitIpChecker(),
    ...seams
  } = options;
  const dataDir = given ?? mkdtempSync(join(tmpdir(), 'session-manager-test-'));
  const dbPath = kind === 'file' ? join(dataDir, 'manager.db') : null;
  const store = openStore(dbPath ?? ':memory:', { now: seams.now });
  const manager = createManager({
    dataDir,
    version,
    store,
    backend,
    checker,
    ...seams,
  });
  let closed = false;
  return {
    manager,
    store,
    backend,
    checker,
    dataDir,
    dbPath,
    async close(closeOptions = {}) {
      if (closed) return;
      closed = true;
      try {
        await manager.close();
      } finally {
        store.close();
        if (given === undefined && closeOptions.keepData !== true) {
          rmSync(dataDir, { recursive: true, force: true });
        }
      }
    },
  };
}

// -- driving the manager --------------------------------------------------------

/** Adds a proxy; its first check runs in the background. */
export function addProxy(
  manager: Manager,
  text: string,
  options: { defaultScheme?: Scheme } = {},
): Proxy {
  return manager.addProxy(text, options);
}

/** Creates (and so starts) a session; it is "starting" with a proxy assignment ahead. */
export function createSession(
  manager: Manager,
  name: string | null = null,
  options: { os?: string } = {},
): Promise<Session> {
  return manager.createSession({ name, ...options });
}

/** The session, as the list of sessions shows it. */
export function getSession(manager: Manager, sessionId: number): Session {
  const session = manager.listSessions().find((s) => s.id === sessionId);
  if (session === undefined) {
    throw new Error(`session ${sessionId} does not exist`);
  }
  return session;
}

function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    realSetTimeout(resolve, ms);
  });
}

/** Polls until `done(session)`; throws with `describe`'s words after `timeoutMs`. */
export async function waitFor(
  manager: Manager,
  sessionId: number,
  done: (session: Session) => boolean,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  describe: (session: Session) => string = (session) =>
    `session is ${session.status}/${session.activity} (${session.error})`,
): Promise<Session> {
  const deadline = realNow() + timeoutMs;
  for (;;) {
    const session = getSession(manager, sessionId);
    if (done(session)) return session;
    if (realNow() >= deadline) {
      throw new Error(
        `session ${sessionId} did not get there in ${timeoutMs} ms: ${describe(session)}`,
      );
    }
    await pause(POLL_MS);
  }
}

/** Until the session has the status and no background activity. */
export function waitForStatus(
  manager: Manager,
  sessionId: number,
  status: SessionStatus,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Session> {
  return waitFor(
    manager,
    sessionId,
    (session) => session.status === status && session.activity === null,
    timeoutMs,
    (session) =>
      `session is ${session.status}/${session.activity} (${session.error}), expected ${status}`,
  );
}

/** Until the session's background work is over: running, stopped or in error. */
export function settled(
  manager: Manager,
  sessionId: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Session> {
  return waitFor(
    manager,
    sessionId,
    (session) => session.activity === null && session.status !== 'starting',
    timeoutMs,
  );
}

/** Until no proxy check is queued or running. */
export async function waitForChecks(
  manager: Manager,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const deadline = realNow() + timeoutMs;
  while (manager.meta().counts.checkingProxies > 0) {
    if (realNow() >= deadline) {
      throw new Error(`proxy checks were still running after ${timeoutMs} ms`);
    }
    await pause(POLL_MS);
  }
}

/**
 * Adds the proxy 192.0.2.<n>:8080 to the pool through the store, so that no
 * check is queued: the only checks are the ones the rules under test make.
 * `ok: true` stores a working check (exit IP `options.exitIp`, default
 * 203.0.113.<n>, which is what the fake checker will find too), `ok: false` a
 * failed one.
 */
export function seedProxy(
  store: Store,
  n: number,
  options: { ok?: boolean | null; exitIp?: string; credentials?: string } = {},
): number {
  const text = `192.0.2.${n}:8080${options.credentials ?? ''}`;
  const { id } = store.addProxy(parseProxy(text));
  if (options.ok === true) {
    store.recordCheckOk(id, {
      ip: options.exitIp ?? `203.0.113.${n}`,
      country: 'US',
      latencyMs: 10,
    });
  } else if (options.ok === false) {
    store.recordCheckFailed(id, 'proxy refused the connection');
  }
  return id;
}

/** The `AppError` that `action` is refused with (it may throw at once, or reject). */
export async function refusalOf(action: () => unknown): Promise<AppError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected the action to be refused');
}
