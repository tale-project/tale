// A running Camoufox persistent context, as the `BrowserHandle` of one session.
//
// The browser process exiting (quit, crash, kill) fires the context's "close"
// event. Closing the last tab does not end the process, so after a short grace
// period that also ends the session, and the owner closes the context. The
// tabs that were open are kept for the next start, except when the user closed
// the last one (then the next start opens the start page) or the browser died
// (its tabs closing then does not count).

import { execFile } from 'node:child_process';

import { describeError } from '../../lib/error-text.ts';
import type { BrowserHandle } from './backend.ts';
import type { Remote } from './remote.ts';

/** How long a session without pages waits before it ends. */
export const NO_PAGES_GRACE_MS = 1500;
/** How long a graceful close may take before the browser is killed. */
const CLOSE_TIMEOUT_MS = 15_000;
/** How long the killed browser has to report that it is gone. */
const KILL_WAIT_MS = 10_000;
/** A process listing of a busy host is long. */
const MAX_LISTING_BYTES = 64 * 1024 * 1024;

/** The part of Playwright's `Page` that a session uses. */
export interface SessionPage {
  on(event: 'close', listener: () => void): unknown;
}

/** The part of Playwright's `BrowserContext` that a session uses. */
export interface SessionContext {
  pages(): readonly SessionPage[];
  on(event: 'close', listener: () => void): unknown;
  on(event: 'page', listener: (page: SessionPage) => void): unknown;
  setGeolocation(position: {
    latitude: number;
    longitude: number;
  }): Promise<void>;
  close(): Promise<void>;
}

/** A `Remote` that a session also winds up (`PlaywrightRemote`). */
export interface RemoteLifecycle extends Remote {
  readonly closed: boolean;
  /** Open these addresses as the tabs of a new browser. */
  restore(urls: readonly string[], active?: number): Promise<void>;
  /** The user closed the last tab: the next start opens the start page. */
  forgetLayout(): void;
  /** No more changes to the layout: reported now (`flush`) or left as last reported. */
  freeze(options: { flush: boolean }): void;
  /** The browser is closing or gone: stop everything that touches it. */
  aclose(): Promise<void>;
}

export interface SessionOptions {
  profileDir: string;
  /** Default `NO_PAGES_GRACE_MS`. */
  noPagesGraceMs?: number;
  /** The output of `listProcesses`, for `findBrowserPid`. */
  listProcesses?: () => Promise<string>;
  /** Default: SIGKILL through `process.kill`. */
  kill?: (pid: number) => void;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The process listing, `ps -axo pid=,command=` (`ww`: whole command lines,
 * whatever the width of the terminal). Needs `ps` on the host: a slim
 * container image has it in procps.
 */
export function listProcesses(): Promise<string> {
  return new Promise<string>((resolve) => {
    execFile(
      'ps',
      ['-axww', '-o', 'pid=,command='],
      { maxBuffer: MAX_LISTING_BYTES },
      (error, stdout) => {
        // Without a listing there is no process to find: the caller says so.
        if (error)
          console.warn(`could not list the processes: ${error.message}`);
        resolve(stdout);
      },
    );
  });
}

/**
 * The main browser process of a profile (its arguments have
 * `-profile <dir>`); Playwright exposes no PID.
 */
export async function findBrowserPid(
  profileDir: string,
  list: () => Promise<string> = listProcesses,
): Promise<number | null> {
  // The next character must end the path: not .../1 for .../10.
  const argument = new RegExp(`-profile ${escapeRegExp(profileDir)}(\\s|$)`);
  for (const line of (await list()).split(/\r?\n/)) {
    const trimmed = line.trim();
    const space = trimmed.indexOf(' ');
    if (space < 0) continue;
    const command = trimmed.slice(space + 1);
    // The browser's other processes carry the profile too. On macOS they are
    // not marked "-contentproc", but they all have a parent.
    if (
      argument.test(command) &&
      !command.includes('-contentproc') &&
      !command.includes('-parentPid')
    ) {
      const pid = Number(trimmed.slice(0, space));
      if (Number.isInteger(pid)) return pid;
    }
  }
  return null;
}

export function killProcess(pid: number): void {
  process.kill(pid, 'SIGKILL');
}

/**
 * `promise`, or a rejection after `ms`. The promise is left to itself then:
 * what it fails with later is of no interest.
 */
async function within<T>(
  promise: Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${what} took more than ${ms} ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

export class CamoufoxSession implements BrowserHandle {
  readonly context: SessionContext;
  readonly remote: RemoteLifecycle;

  readonly #profileDir: string;
  readonly #graceMs: number;
  readonly #listProcesses: () => Promise<string>;
  readonly #kill: (pid: number) => void;
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  readonly #ended = Promise.withResolvers<void>();
  readonly #contextClosed = Promise.withResolvers<void>();
  #isContextClosed = false;
  #isEnded = false;
  #remoteClosing: Promise<void> | null = null;
  #closing: Promise<void> | null = null;

  constructor(
    context: SessionContext,
    remote: RemoteLifecycle,
    options: SessionOptions,
  ) {
    this.context = context;
    this.remote = remote;
    this.#profileDir = options.profileDir;
    this.#graceMs = options.noPagesGraceMs ?? NO_PAGES_GRACE_MS;
    this.#listProcesses = options.listProcesses ?? listProcesses;
    this.#kill = options.kill ?? killProcess;
    context.on('close', this.#onContextClosed);
    context.on('page', this.#watchPage);
    for (const page of context.pages()) this.#watchPage(page);
  }

  readonly #onContextClosed = (): void => {
    this.#isContextClosed = true;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    // The tabs closing with the browser say nothing about what the user wants.
    void this.#windUpRemote(false);
    this.#isEnded = true;
    this.#contextClosed.resolve();
    this.#ended.resolve();
  };

  /**
   * The remote's last word on the tabs (`flush`: reported now, else left as
   * last reported), then it stops. Done once, by whoever comes first: a browser
   * that exits during a close has been wound up by the close already.
   */
  #windUpRemote(flush: boolean): Promise<void> {
    this.#remoteClosing ??= (async () => {
      // Whatever fails, the remote has to stop and the browser to close.
      try {
        this.remote.freeze({ flush });
      } catch (error) {
        console.error(
          `could not freeze the tabs of ${this.#profileDir}`,
          error,
        );
      }
      try {
        await this.remote.aclose();
      } catch (error) {
        console.error(
          `could not close the remote of ${this.#profileDir}`,
          error,
        );
      }
    })();
    return this.#remoteClosing;
  }

  readonly #watchPage = (page: SessionPage): void => {
    page.on('close', this.#onPageClosed);
  };

  readonly #onPageClosed = (): void => {
    if (this.#isContextClosed) return;
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      this.#endIfNoPages();
    }, this.#graceMs);
    this.#timers.add(timer);
  };

  #endIfNoPages(): void {
    // Each tab that closed set a timer: the first to run is the one that counts.
    if (this.#isEnded || this.context.pages().length > 0) return;
    this.#isEnded = true;
    try {
      this.remote.forgetLayout();
    } catch (error) {
      console.error(`could not forget the tabs of ${this.#profileDir}`, error);
    }
    this.#ended.resolve();
  }

  waitClosed(): Promise<void> {
    return this.#ended.promise;
  }

  /** Resolves when the browser process is gone (`waitClosed` may be earlier). */
  get contextClosed(): Promise<void> {
    return this.#contextClosed.promise;
  }

  /**
   * Graceful close (flushes cookies and storage), SIGKILL as the fallback.
   * Closing twice is one close.
   */
  close(timeoutMs = CLOSE_TIMEOUT_MS): Promise<void> {
    if (this.#closing === null) {
      const closing = this.#close(timeoutMs);
      this.#closing = closing;
      // A close that failed can be tried again.
      closing.catch(() => {
        if (this.#closing === closing) this.#closing = null;
      });
    }
    return this.#closing;
  }

  async #close(timeoutMs: number): Promise<void> {
    await this.#windUpRemote(true);
    if (this.#isContextClosed) return;
    try {
      await within(
        Promise.resolve().then(() => this.context.close()),
        timeoutMs,
        'closing the browser',
      );
    } catch (error) {
      console.warn(
        `graceful close of ${this.#profileDir} failed (${describeError(error)}); killing the browser`,
      );
      const pid = await findBrowserPid(this.#profileDir, this.#listProcesses);
      if (pid !== null) this.#killBrowser(pid);
      await within(
        this.#contextClosed.promise,
        KILL_WAIT_MS,
        'the killed browser exiting',
      );
    }
  }

  #killBrowser(pid: number): void {
    try {
      this.#kill(pid);
    } catch (error) {
      // It exited on its own in the meantime: that is what was wanted.
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
      ) {
        throw error;
      }
    }
  }
}
