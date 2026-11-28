// The host's processes as the raw backend sees and ends them. Everything that
// asks the operating system goes through {@link RawProcesses}, so the
// backend's rules are tested against a fake process table.

import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

/** One row of the process table. */
export interface ProcessEntry {
  pid: number;
  ppid: number;
  pgid: number;
  uid: number;
  /** Ended and waiting for its parent (or init) to reap it: nothing runs,
   * and no signal reaches it. */
  zombie?: boolean;
}

/** What starting runnerd needs. */
export interface RunnerdLaunch {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  /** Where its output goes (opened for appending). */
  logPath: string;
  /** Written to the descriptor runnerd reads its token from (3), then closed. */
  token: string;
  /** The account it runs as; absent: the spawner's own. */
  uid?: number;
  gid?: number;
}

export interface RawProcesses {
  /** The whole process table now. THROWS when it cannot be read. */
  list(): Promise<ProcessEntry[]>;
  /** What tells this process from a later one with the same pid (its start
   * time); null when it does not run. */
  identity(pid: number): Promise<string | null>;
  /** Send a signal; false when there was no such process. */
  signal(pid: number, signal: NodeJS.Signals): boolean;
  /** Start runnerd detached in a process group of its own; resolves with its
   * pid once it was started, rejects when it could not be. */
  launch(launch: RunnerdLaunch): Promise<number>;
  /** Run a host program; resolves with its exit code and output. */
  run(
    argv: string[],
    options?: { timeoutMs?: number },
  ): Promise<{ code: number; stdout: string; stderr: string }>;
}

function isMissing(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err.code === 'ESRCH' || err.code === 'ENOENT')
  );
}

/** Parse `ps -axo pid=,ppid=,pgid=,uid=,stat=` (the same columns on Linux
 * and macOS). */
export function parseProcessTable(text: string): ProcessEntry[] {
  const out: ProcessEntry[] = [];
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4 && fields.length !== 5) continue;
    const state = fields[4];
    const [pid, ppid, pgid, uid] = fields.slice(0, 4).map(Number);
    if (
      pid === undefined ||
      ppid === undefined ||
      pgid === undefined ||
      uid === undefined ||
      ![pid, ppid, pgid, uid].every(Number.isInteger)
    )
      continue;
    out.push({
      pid,
      ppid,
      pgid,
      uid,
      ...(state !== undefined && state.startsWith('Z') ? { zombie: true } : {}),
    });
  }
  return out;
}

/** The start time in `/proc/<pid>/stat` (field 22, after the name, which may
 * itself hold spaces and parentheses). */
export function procStartTime(stat: string): string | null {
  const end = stat.lastIndexOf(')');
  if (end < 0) return null;
  const fields = stat.slice(end + 2).split(' ');
  // fields[0] is field 3 (state); the start time is field 22.
  const start = fields[19];
  return start !== undefined && /^\d+$/.test(start) ? start : null;
}

async function run(
  argv: string[],
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const [program, ...args] = argv;
  if (program === undefined) throw new Error('nothing to run');
  return await new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({
        code: code ?? (signal === null ? 1 : 128),
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
  });
}

export const hostProcesses: RawProcesses = {
  async list() {
    const result = await run(['ps', '-axo', 'pid=,ppid=,pgid=,uid=,stat='], {
      timeoutMs: 15_000,
    });
    if (result.code !== 0) {
      throw new Error(`ps failed (${result.code}): ${result.stderr.trim()}`);
    }
    return parseProcessTable(result.stdout);
  },

  async identity(pid) {
    if (process.platform === 'linux') {
      try {
        return procStartTime(await readFile(`/proc/${pid}/stat`, 'utf8'));
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    }
    const result = await run(['ps', '-o', 'lstart=', '-p', String(pid)], {
      timeoutMs: 10_000,
    });
    const started = result.stdout.trim();
    // ps exits 1 for a pid that does not run.
    return result.code === 0 && started !== '' ? started : null;
  },

  signal(pid, signal) {
    try {
      process.kill(pid, signal);
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  },

  async launch(launch) {
    const [program, ...args] = launch.argv;
    if (program === undefined) throw new Error('runnerd has no program');
    const log = openSync(launch.logPath, 'a', 0o600);
    try {
      return await new Promise<number>((resolve, reject) => {
        const child = spawn(program, args, {
          cwd: launch.cwd,
          env: launch.env,
          detached: true,
          // fd 3 carries the token (TALE_RUNNERD_TOKEN_FD=3), never the
          // environment every process of the uid could read.
          stdio: ['ignore', log, log, 'pipe'],
          ...(launch.uid === undefined
            ? {}
            : { uid: launch.uid, gid: launch.gid ?? launch.uid }),
        });
        child.once('error', reject);
        child.once('spawn', () => {
          const pid = child.pid;
          const tokenPipe = child.stdio[3];
          if (
            pid === undefined ||
            tokenPipe === null ||
            tokenPipe === undefined
          ) {
            reject(new Error('runnerd started without a pid or token pipe'));
            return;
          }
          if (!('end' in tokenPipe)) {
            reject(new Error('runnerd token pipe is not writable'));
            return;
          }
          tokenPipe.on('error', (err: Error) => {
            console.warn(
              `[sandbox.raw] handing runnerd ${pid} its token failed:`,
              err.message,
            );
          });
          tokenPipe.end(`${launch.token}\n`);
          // runnerd outlives the spawner: a restart re-adopts it.
          child.unref();
          resolve(pid);
        });
      });
    } finally {
      closeSync(log);
    }
  },

  run,
};

/** Every process below `root` in the table (not `root` itself). */
export function descendantsOf(
  table: readonly ProcessEntry[],
  root: number,
): ProcessEntry[] {
  const children = new Map<number, ProcessEntry[]>();
  for (const entry of table) {
    const list = children.get(entry.ppid);
    if (list === undefined) children.set(entry.ppid, [entry]);
    else list.push(entry);
  }
  const out: ProcessEntry[] = [];
  const queue = [root];
  const seen = new Set<number>([root]);
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const child of children.get(next) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      out.push(child);
      queue.push(child.pid);
    }
  }
  return out;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** How often a kill looks again for what it has not ended yet. */
const KILL_ROUNDS = 20;
const KILL_ROUND_MS = 100;

/**
 * End every process `select` picks from the table: SIGTERM first when there
 * is a grace (and wait for them that long), then SIGKILL until none is left.
 * Resolves with how many it signalled; THROWS when some still run after the
 * last round, so a caller never hands the slot on with a process of it left.
 */
export async function endProcesses(
  processes: RawProcesses,
  select: (table: readonly ProcessEntry[]) => ProcessEntry[],
  { graceMs = 0, what }: { graceMs?: number; what: string },
): Promise<number> {
  const self = process.pid;
  // A zombie has ended already: init (or its parent) reaps it, and no
  // signal would.
  const pick = async () =>
    select(await processes.list()).filter(
      (entry) => entry.pid !== self && entry.zombie !== true,
    );
  let signalled = 0;
  if (graceMs > 0) {
    const first = await pick();
    for (const entry of first) {
      if (processes.signal(entry.pid, 'SIGTERM')) signalled += 1;
    }
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
      if ((await pick()).length === 0) return signalled;
      await sleep(Math.min(250, Math.max(10, deadline - Date.now())));
    }
  }
  for (let round = 0; round < KILL_ROUNDS; round += 1) {
    const left = await pick();
    if (left.length === 0) return signalled;
    for (const entry of left) {
      if (processes.signal(entry.pid, 'SIGKILL')) signalled += 1;
    }
    await sleep(KILL_ROUND_MS);
  }
  const left = await pick();
  if (left.length > 0) {
    throw new Error(
      `${left.length} process(es) of ${what} still run after SIGKILL: ${left
        .slice(0, 8)
        .map((entry) => entry.pid)
        .join(', ')}`,
    );
  }
  return signalled;
}
