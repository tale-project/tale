// Installing the Camoufox browser: whether it is there, which build the app
// works with, and `camoufox-js fetch` (the install step of the README) as a
// child process.
//
// camoufox-js reads `CAMOUFOX_INSTALL_DIR` into a constant when its modules are
// first loaded, and the app sets that variable at startup: nothing here loads
// camoufox-js before it is needed. The answers below are synchronous (the
// backend's `browserInstalled()` and `browserVersion` are), so they `require`
// the small modules they need instead of importing them asynchronously.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

import { isRecord } from '../../../lib/is-record.ts';
import { errorText } from '../../lib/error-text.ts';

/** How many lines of what the command printed an issue shows. */
const TAIL_LINES = 12;
/** A download prints a line per chunk: only the end of the output is kept. */
const MAX_OUTPUT_CHARS = 256 * 1024;
/** What `browserBuild` answers when the pin cannot be read. */
const UNKNOWN_BUILD = 'unknown';
/** Names of the errors that camoufox-js raises for a missing install. */
const NOT_INSTALLED = new Set(['CamoufoxNotInstalled', 'FileNotFoundError']);

const requireModule = createRequire(import.meta.url);

// -- is it installed, which build ----------------------------------------------

interface Pkgman {
  installedVerStr(): string;
}

function isPkgman(value: unknown): value is Pkgman {
  return isRecord(value) && typeof value.installedVerStr === 'function';
}

function installedVersion(): string {
  const pkgman: unknown = requireModule('camoufox-js/dist/pkgman.js');
  if (!isPkgman(pkgman)) {
    throw new Error('camoufox-js has no installedVerStr()');
  }
  return pkgman.installedVerStr();
}

/** The problems that were logged: the answer is asked for again and again. */
const reported = new Set<string>();

function warnOnce(what: string, error: unknown): void {
  const key = `${what}: ${errorText(error)}`;
  if (reported.has(key)) return;
  reported.add(key);
  console.warn(what, error);
}

/**
 * Whether the browser build that camoufox-js launches is installed (a version
 * file is enough: the files themselves are checked at launch).
 * `installedVersion` is for tests.
 */
export function isInstalled(version: () => string = installedVersion): boolean {
  try {
    version();
  } catch (error) {
    // `installedVerStr` raises FileNotFoundError for a missing version file,
    // `camoufoxPath` CamoufoxNotInstalled: both mean there is no install.
    if (error instanceof Error && NOT_INSTALLED.has(error.name)) return false;
    warnOnce('Could not tell whether the Camoufox browser is installed', error);
    return false;
  }
  return true;
}

interface BrowserPin {
  loadPin(): { version: string; build: string } | null;
  pinSpec(pin: { version: string; build: string }): string;
}

function isBrowserPin(value: unknown): value is BrowserPin {
  return (
    isRecord(value) &&
    typeof value.loadPin === 'function' &&
    typeof value.pinSpec === 'function'
  );
}

/**
 * The Camoufox build this release of camoufox-js is tested with and installs
 * (e.g. `152.0.4-beta.30`): the one `camoufox-js fetch` downloads, whatever else
 * is on the disk.
 */
export function browserBuild(): string {
  try {
    const module: unknown = requireModule('camoufox-js/dist/browser-pin.js');
    if (isBrowserPin(module)) {
      const pin = module.loadPin();
      if (pin !== null) return module.pinSpec(pin);
    }
  } catch (error) {
    warnOnce('Could not read the browser build camoufox-js pins', error);
  }
  return UNKNOWN_BUILD;
}

// -- camoufox-js fetch -------------------------------------------------------------

/** `camoufox-js fetch` of camoufox-js, run by the runtime that runs the app. */
export function fetchCommand(): readonly string[] {
  return [
    process.execPath,
    requireModule.resolve('camoufox-js/dist/__main__.js'),
    'fetch',
  ];
}

export interface FetchOptions {
  /** What to run; default `fetchCommand()`. */
  command?: readonly string[];
  /** Asked after the command ended; default `isInstalled`. */
  installed?: () => boolean;
  /** Kills the command and rejects with the signal's reason. */
  signal?: AbortSignal;
}

type Ended =
  | { kind: 'unrunnable'; message: string }
  | {
      kind: 'exited';
      code: number | null;
      signal: string | null;
      output: string;
    };

function run(
  command: readonly string[],
  signal: AbortSignal | undefined,
): Promise<Ended> {
  return new Promise<Ended>((resolve, reject) => {
    const [program, ...args] = command;
    if (program === undefined) {
      resolve({ kind: 'unrunnable', message: 'there is no command to run' });
      return;
    }
    let output = '';
    let ended = false;
    const child = spawn(program, args, {
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stop = (): void => {
      child.kill('SIGKILL');
    };
    const finish = (settle: () => void): void => {
      if (ended) return;
      ended = true;
      signal?.removeEventListener('abort', stop);
      settle();
    };
    // Both streams go to one text, in the order they arrive.
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        output = (output + chunk).slice(-MAX_OUTPUT_CHARS);
      });
    }
    // Not `once`: an error event nobody listens to would end the app.
    child.on('error', (error) => {
      finish(() => resolve({ kind: 'unrunnable', message: error.message }));
    });
    child.once('close', (code, exitSignal) => {
      finish(() => {
        if (signal?.aborted) reject(signal.reason);
        else resolve({ kind: 'exited', code, signal: exitSignal, output });
      });
    });
    signal?.addEventListener('abort', stop, { once: true });
  });
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * The last distinct lines of a command's output; progress bars redraw one
 * line with carriage returns.
 */
export function outputTail(output: string, count = TAIL_LINES): string[] {
  const tail: string[] = [];
  for (const raw of output.replace(ANSI, '').split(/[\r\n]+/)) {
    const line = raw.trim();
    if (line === '' || tail.at(-1) === line) continue;
    tail.push(line);
    if (tail.length > count) tail.shift();
  }
  return tail;
}

export function issue(summary: string, lines: readonly string[]): string {
  return [summary, ...lines].join('\n');
}

/**
 * Runs `camoufox-js fetch`. Returns null once the browser is installed, else the
 * issue: the exit code and the last lines the command printed. Rejects when
 * `signal` aborts (the command is killed first).
 */
export async function fetchBrowser(
  options: FetchOptions = {},
): Promise<string | null> {
  const installed = options.installed ?? isInstalled;
  options.signal?.throwIfAborted();
  console.info(
    'The Camoufox browser is not installed: downloading it (about 1.3 GB)',
  );
  let ended: Ended;
  try {
    ended = await run(options.command ?? fetchCommand(), options.signal);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    // The runtime cannot find camoufox-js, say.
    return issue(
      `Could not run \`camoufox-js fetch\`: ${errorText(error)}`,
      [],
    );
  }
  if (ended.kind === 'unrunnable') {
    return issue(`Could not run \`camoufox-js fetch\`: ${ended.message}`, []);
  }
  const lines = outputTail(ended.output);
  const failed = ended.code !== 0;
  const how =
    ended.code === null
      ? `stopped by ${ended.signal}`
      : `exit code ${ended.code}`;
  // Also when a later step failed: Camoufox fetches what is missing at launch.
  if (installed()) {
    if (failed) {
      console.warn(`camoufox-js fetch ended (${how}):\n${lines.join('\n')}`);
    }
    return null;
  }
  console.error(
    `camoufox-js fetch did not install the browser (${how}):\n${lines.join('\n')}`,
  );
  if (failed) return issue(`\`camoufox-js fetch\` failed (${how}).`, lines);
  // It reports some problems (a version that is not found) in red and exits with 0.
  return issue(
    '`camoufox-js fetch` finished, but the browser is still not installed.',
    lines,
  );
}
