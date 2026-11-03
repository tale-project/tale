// What the tests of the real-browser lane that go through the manager or the
// whole server share: the gate that skips them without a Camoufox build, a
// `CamoufoxBackend` that keeps hold of the browsers it launched, and a look at
// the host's processes (to see that no browser is left behind).
//
//     const backend = new RecordingBackend();
//     const session = backend.sessionIn(profileDir);   // the CamoufoxSession of a profile
//     const page = pageInFront(session, remote.tabs()); // its Playwright page in front
//
// The lane runs with `CAMOUFOX_INSTALL_DIR` set to a directory that holds the
// build (never the default one, which belongs to other programs).

import { execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Page } from 'playwright-core';

import { isRecord } from '../../lib/is-record.ts';
import type { LaunchSpec } from '../domains/browser/backend.ts';
import { CamoufoxBackend } from '../domains/browser/camoufox-backend.ts';
import type { CamoufoxDeps } from '../domains/browser/camoufox-backend.ts';
import type { CamoufoxSession } from '../domains/browser/camoufox-session.ts';
import { isInstalled } from '../domains/browser/install.ts';

/** `describe.skipIf(!REAL_BROWSER_READY)`: the build is configured and installed. */
export const REAL_BROWSER_READY: boolean =
  process.env.CAMOUFOX_INSTALL_DIR !== undefined && isInstalled();

type Prefs = Record<string, string | number | boolean>;

/**
 * `launchOptions` of camoufox-js without the default add-on: uBlock Origin is
 * downloaded when it is missing, and the lane has no network. `prefs` are
 * Firefox preferences on top of the ones the backend asks for.
 */
function launchOptionsWithoutAddons(
  prefs: Prefs = {},
): CamoufoxDeps['launchOptions'] {
  return async (args) => {
    const { launchOptions } = await import('camoufox-js');
    return launchOptions({
      ...args,
      exclude_addons: ['UBO'],
      firefox_user_prefs: { ...args.firefox_user_prefs, ...prefs },
    });
  };
}

export interface RecordingBackendOptions {
  /** The app's `SESSION_MANAGER_BLOCK_WEBRTC`; default off, as in the app. */
  blockWebrtc?: boolean;
  /** Firefox preferences added to every launch. */
  prefs?: Prefs;
}

/**
 * The real backend, which also remembers what it launched: every `LaunchSpec`
 * in order, and the browser of each profile. The tests get at a browser's pages
 * and at its process this way, as the manager hides the handle.
 */
export class RecordingBackend extends CamoufoxBackend {
  /** Every launch asked for, in order. */
  readonly launched: LaunchSpec[] = [];
  readonly #byProfile = new Map<string, CamoufoxSession>();

  constructor(options: RecordingBackendOptions = {}) {
    super({
      blockWebrtc: options.blockWebrtc ?? false,
      deps: { launchOptions: launchOptionsWithoutAddons(options.prefs) },
    });
  }

  override async launch(spec: LaunchSpec): Promise<CamoufoxSession> {
    this.launched.push(spec);
    const session = await super.launch(spec);
    this.#byProfile.set(resolve(spec.profileDir), session);
    return session;
  }

  /** The browser last launched in this profile directory. */
  sessionIn(profileDir: string): CamoufoxSession {
    const session = this.#byProfile.get(resolve(profileDir));
    if (session === undefined) {
      throw new Error(`no browser was launched in ${profileDir}`);
    }
    return session;
  }
}

/** Playwright's `Page`, of anything a session's context lists. */
function isPage(value: unknown): value is Page {
  return (
    isRecord(value) &&
    typeof value.goto === 'function' &&
    typeof value.evaluate === 'function' &&
    typeof value.url === 'function'
  );
}

/** The Playwright pages of a running browser, in tab order. */
function pagesOf(session: CamoufoxSession): Page[] {
  return session.context.pages().filter(isPage);
}

/** The Playwright page of the tab in front, given the tabs the remote lists. */
export function pageInFront(
  session: CamoufoxSession,
  tabs: readonly { active: boolean }[],
): Page {
  const page = pagesOf(session)[tabs.findIndex((tab) => tab.active)];
  if (page === undefined) throw new Error('no tab is in front');
  return page;
}

// -- processes -----------------------------------------------------------------------

export interface ProcessRow {
  pid: number;
  ppid: number;
  command: string;
}

/** Every process of the host: `ps -axww -o pid=,ppid=,command=`. */
export function processTable(): Promise<ProcessRow[]> {
  return new Promise<ProcessRow[]>((resolveTable, reject) => {
    execFile(
      'ps',
      ['-axww', '-o', 'pid=,ppid=,command='],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        const rows = stdout.split(/\r?\n/).flatMap((line) => {
          const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
          if (match === null) return [];
          return [
            {
              pid: Number(match[1]),
              ppid: Number(match[2]),
              command: match[3] ?? '',
            },
          ];
        });
        resolveTable(rows);
      },
    );
  });
}

/** The processes started by `pid`, and by those, and so on (not `pid` itself). */
function descendantsIn(
  table: readonly ProcessRow[],
  pid: number,
): ProcessRow[] {
  const found: ProcessRow[] = [];
  const seen = new Set<number>([pid]);
  let grew: boolean;
  do {
    grew = false;
    for (const row of table) {
      if (seen.has(row.ppid) && !seen.has(row.pid)) {
        seen.add(row.pid);
        found.push(row);
        grew = true;
      }
    }
  } while (grew);
  return found;
}

/**
 * The browser processes of this test run. Without a `marker`: the children (and
 * their children) of the test process whose command runs the Camoufox build. With
 * one: the processes, wherever they hang, whose command line has it (the name of
 * a temporary directory the browsers work in; an orphan that lost its parent is
 * not a child any more).
 */
export async function browserProcesses(
  marker: string | null = null,
): Promise<ProcessRow[]> {
  const table = await processTable();
  if (marker !== null) {
    return table.filter(
      (row) => row.pid !== process.pid && row.command.includes(marker),
    );
  }
  const mine = new Set(descendantsIn(table, process.pid).map((r) => r.pid));
  return table.filter(
    (row) =>
      mine.has(row.pid) && /camoufox|plugin-container/iu.test(row.command),
  );
}

/**
 * The files below `directory` (a browser's profile, say) that contain `needle`.
 * Sockets and the like are not read.
 */
export function filesContaining(directory: string, needle: string): string[] {
  const wanted = Buffer.from(needle);
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && readFileSync(path).includes(wanted)) {
        found.push(path);
      }
    }
  };
  walk(directory);
  return found;
}
