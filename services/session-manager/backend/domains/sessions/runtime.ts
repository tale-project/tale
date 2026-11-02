// In-memory lifecycle of the session browsers (nothing here is persisted).
//
// Each start gets one background task that owns the session from the proxy
// assignment to the browser's exit, so a profile is never launched twice ("A
// copy of Camoufox is already open") and every exit path ends in one place. A
// new task of a session first waits for the session's previous tasks (e.g. the
// browser that a rotation closes).
//
// The work that precedes the launch (`prepare`, `assign`) gets an
// `AbortSignal`: stopping aborts it, the task ends at once, and the work itself
// is expected to look at the signal after each await, before it changes
// anything. Once the browser is launching, a stop only asks it to close.

import type {
  MessageParams,
  SessionActivity,
  SessionStatus,
} from '../../../lib/api/schemas.ts';
import {
  Latch,
  abortable,
  cancel,
  isCancelled,
  sleep,
} from '../../lib/abort.ts';
import { firstLine } from '../../lib/error-text.ts';
import { DEFAULT_START_PAGE, EMPTY_LAYOUT } from '../../lib/web-url.ts';
import type { TabLayout } from '../../lib/web-url.ts';
import type {
  BrowserBackend,
  BrowserHandle,
  LaunchSpec,
} from '../browser/backend.ts';
import type { Identity, Location } from '../identity/types.ts';
import { ProxyBridge } from '../proxies/bridge.ts';
import { hasAuth, toPlaywrightProxy } from '../proxies/types.ts';
import type { ProxyConfig, RunningBridge } from '../proxies/types.ts';

/** The API's own values: a client switches on them. */
export type Status = SessionStatus;
export type Activity = SessionActivity;

/** How long a shutdown waits for the browsers to close. */
export const SHUTDOWN_TIMEOUT_MS = 30_000;

/** A session in one of these has work under way (a browser to close, at least). */
export const ACTIVE: ReadonlySet<Status> = new Set<Status>([
  'starting',
  'running',
  'stopping',
]);

/** What `prepare` has worked out: how to start the browser of a session. */
export interface Launch {
  name: string;
  identity: Identity;
  upstream: ProxyConfig;
  /** Where it says it is: that of the proxy's exit IP. */
  location: Location;
  /** Reopened; none: the start page. */
  tabs?: TabLayout;
  startPage?: string;
  /** Told which tabs are open. */
  onLayout?: (layout: TabLayout) => void;
}

/**
 * A start (or proxy change) that cannot go on; code and message are
 * user-facing. `extra` names what the page words the code with (a cause, a
 * count): it is shown with the error (`SessionState.errorExtra`).
 */
export class StartError extends Error {
  readonly code: string;
  readonly extra: MessageParams;

  constructor(code: string, message: string, extra: MessageParams = {}) {
    super(message);
    this.name = 'StartError';
    this.code = code;
    this.extra = extra;
  }
}

export interface SessionState {
  status: Status;
  activity: Activity | null;
  error: string | null;
  errorCode: string | null;
  /** What the page words `errorCode` with; none is null, never an empty object. */
  errorExtra: MessageParams | null;
}

/**
 * Works out what to launch. Gets the signal that a stop aborts: it must look
 * at it after each await, before it changes anything (a cancelled start leaves
 * no trace).
 */
export type Prepare = (signal: AbortSignal) => Promise<Launch>;
/** Assigns another proxy to a session (see `changeProxy`); gets the stop's signal too. */
export type Assign = (signal: AbortSignal) => Promise<unknown>;

export interface StartOptions {
  profileDir: string;
  prepare: Prepare;
  /**
   * Show the proxy assignment first (a rotation does; a restart with the same
   * proxy does not). Default: no for `start`, yes for `restart`.
   */
  assigning?: boolean;
}

export interface RuntimeOptions {
  /** Default `SHUTDOWN_TIMEOUT_MS`. */
  shutdownTimeoutMs?: number;
  /** Waits; resolves early when the signal aborts. Default: a timer. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Starts the bridge for a proxy with credentials. Default `ProxyBridge.start`. */
  startBridge?: (upstream: ProxyConfig) => Promise<RunningBridge>;
}

/** The work of one start, rotation or proxy change. */
interface Task {
  done: boolean;
  /** Resolves when it is over; never rejects. */
  finished: Promise<void>;
}

interface Run {
  status: Status;
  activity: Activity | null;
  error: string | null;
  errorCode: string | null;
  errorExtra: MessageParams | null;
  /** Nothing launched yet: a stop aborts the task. */
  preparing: boolean;
  handle: BrowserHandle | null;
  stopRequested: Latch;
  abort: AbortController;
  task: Task | null;
}

function newRun(status: Status, activity: Activity | null): Run {
  return {
    status,
    activity,
    error: null,
    errorCode: null,
    errorExtra: null,
    preparing: true,
    handle: null,
    stopRequested: new Latch(),
    abort: new AbortController(),
    task: null,
  };
}

/** None is `null`; a copy otherwise, so that a reader of the state cannot change the run's. */
function detailsOf(extra: MessageParams): MessageParams | null {
  return Object.keys(extra).length === 0 ? null : { ...extra };
}

export class SessionRuntime {
  readonly #backend: BrowserBackend;
  readonly #shutdownTimeoutMs: number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #startBridge: (upstream: ProxyConfig) => Promise<RunningBridge>;
  readonly #runs = new Map<number, Run>();
  readonly #tasks = new Map<number, Set<Task>>();

  constructor(backend: BrowserBackend, options: RuntimeOptions = {}) {
    this.#backend = backend;
    this.#shutdownTimeoutMs = options.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS;
    this.#sleep = options.sleep ?? sleep;
    this.#startBridge =
      options.startBridge ?? ((upstream) => ProxyBridge.start(upstream));
  }

  state(sessionId: number): SessionState {
    const run = this.#runs.get(sessionId);
    if (run === undefined) {
      return {
        status: 'stopped',
        activity: null,
        error: null,
        errorCode: null,
        errorExtra: null,
      };
    }
    return {
      status: run.status,
      activity: run.activity,
      error: run.error,
      errorCode: run.errorCode,
      errorExtra: run.errorExtra === null ? null : { ...run.errorExtra },
    };
  }

  isActive(sessionId: number): boolean {
    return ACTIVE.has(this.state(sessionId).status);
  }

  /** A task of the session is still at work (starting, running, stopping, changing its proxy). */
  isBusy(sessionId: number): boolean {
    return this.#unfinished(sessionId).length > 0;
  }

  /** The live browser (e.g. for automation), or `null` while none is up. */
  handle(sessionId: number): BrowserHandle | null {
    return this.#runs.get(sessionId)?.handle ?? null;
  }

  /**
   * Runs `prepare` (assign a proxy if `assigning`, look up the geo data), then
   * launches, all in the background: the status is "starting" until the
   * browser is up. Throws when the session is busy.
   */
  start(sessionId: number, options: StartOptions): void {
    this.#requireIdle(sessionId);
    this.#start(sessionId, options, options.assigning ?? false);
  }

  /**
   * Closes the running browser, then starts again (see `start`). A rotation
   * shows the proxy assignment first (`assigning`, the default); a restart
   * with the same proxy does not.
   */
  restart(sessionId: number, options: StartOptions): void {
    const run = this.#runs.get(sessionId);
    if (run !== undefined) requestStop(run);
    this.#start(sessionId, options, options.assigning ?? true);
  }

  /**
   * Shows why a start was refused before anything ran (the next start or
   * rotation clears it). `extra` is what the page words `code` with.
   */
  fail(
    sessionId: number,
    code: string,
    message: string,
    extra: MessageParams = {},
  ): void {
    this.#requireIdle(sessionId);
    this.#runs.set(sessionId, {
      ...newRun('error', null),
      error: message,
      errorCode: code,
      errorExtra: detailsOf(extra),
      preparing: false,
    });
  }

  /** Assigns another proxy to a stopped session in the background; it stays "stopped". */
  changeProxy(sessionId: number, assign: Assign): void {
    this.#requireIdle(sessionId);
    const run = newRun('stopped', 'assigning_proxy');
    this.#begin(sessionId, run, () => this.#changeProxy(run, assign));
  }

  /**
   * Cancels a start or proxy change that has not launched anything yet, else
   * asks the browser to close and returns at once (the status is "stopping"
   * until it has).
   */
  async stop(sessionId: number): Promise<void> {
    const run = this.#runs.get(sessionId);
    if (run === undefined || run.task === null) return;
    requestStop(run);
    if (run.preparing) await run.task.finished;
  }

  async stopAndWait(sessionId: number): Promise<void> {
    await this.stop(sessionId);
    await Promise.all(this.#unfinished(sessionId).map((task) => task.finished));
  }

  forget(sessionId: number): void {
    this.#runs.delete(sessionId);
    this.#tasks.delete(sessionId);
  }

  /**
   * Closes every browser gracefully, and cancels the starts that are still
   * preparing. Waits for them at most the bound: a browser that has not closed
   * by then is left to itself, as the app is going down.
   */
  async shutdown(): Promise<void> {
    for (const run of this.#runs.values()) requestStop(run);
    const pending: Task[] = [];
    for (const tasks of this.#tasks.values()) {
      for (const task of tasks) {
        if (!task.done) pending.push(task);
      }
    }
    if (pending.length === 0) return;
    const timer = new AbortController();
    const finished = Promise.all(pending.map((task) => task.finished)).then(
      () => true,
    );
    const expired = this.#sleep(this.#shutdownTimeoutMs, timer.signal).then(
      () => false,
    );
    const inTime = await Promise.race([finished, expired]);
    timer.abort();
    if (inTime) return;
    // A browser that is closing or launching cannot be interrupted: it is left to itself.
    for (const sessionId of this.#tasks.keys()) {
      if (this.isBusy(sessionId)) {
        console.warn(
          `session ${sessionId} did not stop within ${this.#shutdownTimeoutMs} ms`,
        );
      }
    }
  }

  #requireIdle(sessionId: number): void {
    if (this.isBusy(sessionId)) throw new Error(`session ${sessionId} is busy`);
  }

  #unfinished(sessionId: number): Task[] {
    return [...(this.#tasks.get(sessionId) ?? [])].filter((task) => !task.done);
  }

  #start(
    sessionId: number,
    { profileDir, prepare }: StartOptions,
    assigning: boolean,
  ): void {
    const run = newRun('starting', assigning ? 'assigning_proxy' : 'launching');
    // The tasks that are over before this one begins: not this one itself.
    const previous = this.#unfinished(sessionId);
    this.#begin(sessionId, run, () =>
      this.#launch(run, previous, profileDir, prepare),
    );
  }

  #begin(sessionId: number, run: Run, body: () => Promise<void>): void {
    this.#runs.set(sessionId, run);
    const tasks = this.#tasks.get(sessionId) ?? new Set<Task>();
    this.#tasks.set(sessionId, tasks);
    const task: Task = { done: false, finished: Promise.resolve() };
    run.task = task;
    tasks.add(task);
    task.finished = (async () => {
      try {
        await body();
      } catch (error) {
        // The bodies handle everything themselves: this is a bug, not a state.
        console.error('a session task failed', error);
      } finally {
        task.done = true;
        tasks.delete(task);
      }
    })();
  }

  async #launch(
    run: Run,
    previous: readonly Task[],
    profileDir: string,
    prepare: Prepare,
  ): Promise<void> {
    const { signal } = run.abort;
    try {
      await abortable(
        Promise.all(previous.map((task) => task.finished)),
        signal,
      );
      const launch = await abortable(prepare(signal), signal);
      // Stopped while `prepare` finished: its result is of no use.
      signal.throwIfAborted();
      run.preparing = false;
      run.activity = 'launching';
      await this.#runBrowser(run, launch, profileDir);
      run.status = 'stopped';
    } catch (error) {
      if (isCancelled(error)) {
        // `stop` has set the state. A cancellation from elsewhere (the proxy
        // checks closed) ends the run as stopped.
        if (!signal.aborted) run.status = 'stopped';
      } else if (error instanceof StartError) {
        run.status = 'error';
        run.error = error.message;
        run.errorCode = error.code;
        run.errorExtra = detailsOf(error.extra);
      } else {
        console.error(`browser session in ${profileDir} failed`, error);
        run.status = 'error';
        run.error = firstLine(error);
      }
    } finally {
      run.handle = null;
      run.activity = null;
    }
  }

  /** The browser and, for a proxy with credentials, its bridge: closed in the opposite order. */
  async #runBrowser(
    run: Run,
    launch: Launch,
    profileDir: string,
  ): Promise<void> {
    let bridge: RunningBridge | null = null;
    let handle: BrowserHandle | null = null;
    try {
      let proxy: LaunchSpec['proxy'];
      if (hasAuth(launch.upstream)) {
        // The browser talks to a local bridge that adds the credentials.
        bridge = await this.#startBridge(launch.upstream);
        proxy = bridge.playwrightProxy;
      } else {
        proxy = toPlaywrightProxy(launch.upstream);
      }
      handle = await this.#backend.launch({
        profileDir,
        name: launch.name,
        identity: launch.identity,
        proxy,
        location: launch.location,
        tabs: launch.tabs ?? EMPTY_LAYOUT,
        startPage: launch.startPage ?? DEFAULT_START_PAGE,
        onLayout: launch.onLayout,
      });
      run.handle = handle;
      run.activity = null;
      if (!run.stopRequested.isSet) run.status = 'running';
      await Promise.race([
        closedOf(handle, profileDir),
        run.stopRequested.wait(),
      ]);
    } finally {
      try {
        if (handle !== null) await handle.close();
      } finally {
        if (bridge !== null) await bridge.close();
      }
    }
  }

  async #changeProxy(run: Run, assign: Assign): Promise<void> {
    const { signal } = run.abort;
    try {
      await abortable(assign(signal), signal);
    } catch (error) {
      // `stop` has set the state.
      if (isCancelled(error)) return;
      if (error instanceof StartError) {
        run.error = error.message;
        run.errorCode = error.code;
        run.errorExtra = detailsOf(error.extra);
      } else {
        console.error('changing the proxy failed', error);
        run.error = firstLine(error);
      }
    } finally {
      run.activity = null;
    }
  }
}

function requestStop(run: Run): void {
  if (run.task === null || run.task.done) return;
  if (run.preparing) {
    run.status = 'stopped';
    run.activity = null;
    cancel(run.abort, 'stopped');
  } else if (ACTIVE.has(run.status)) {
    run.status = 'stopping';
    run.stopRequested.set();
  }
}

/** Resolves when the browser is gone; one that cannot say so is taken for gone. */
async function closedOf(
  handle: BrowserHandle,
  profileDir: string,
): Promise<void> {
  try {
    await handle.waitClosed();
  } catch (error) {
    console.warn(`could not wait for the browser in ${profileDir}`, error);
  }
}
