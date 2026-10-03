/**
 * Bounds of the live test's self-provisioner (`ytdlp_toolchain.ts`), proven
 * on SYNTHETIC stalls only — a loopback HTTP stub and fake `sh` children; no
 * real download, package manager or network. A stalled `apt-get` once held
 * the required Unit job for the hook's full 600 s and outlived it (#4073):
 * every stage must reject on its own deadline, name itself, and stop exactly
 * the processes it started.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ProvisioningClock,
  VIDEO_TOOLCHAIN_DEADLINES,
  VideoToolchainError,
  downloadTo,
  provisionToolchain,
  run,
} from './ytdlp_toolchain';

/**
 * Short bounds for the synthetic stalls. A stalled child gets 2 s, which a
 * loaded runner can spend before the child has even started: a test that
 * needs the child's processes running holds the module's timers
 * (`holdDeadlines`) until they have recorded themselves (`started`).
 */
const FAST = {
  ...VIDEO_TOOLCHAIN_DEADLINES,
  downloadResponseMs: 2_000,
  downloadBodyMs: 500,
  lookupMs: 2_000,
  unzipMs: 2_000,
  packageInstallMs: 2_000,
  killGraceMs: 200,
};

/** A zombie is already stopped, even before its parent reaps it. */
function isAlive(pid: number): boolean {
  if (fs.existsSync('/proc/self/stat')) {
    const state = procStat(pid)?.state;
    return state !== undefined && state !== '' && state !== 'Z';
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * `setsid` (util-linux) and `/proc`: the cases where a child's descendant
 * leaves its process group run on Linux, as CI does.
 */
const ON_LINUX = process.platform === 'linux';

/** Pipe and process handles keeping this worker's event loop alive. */
function liveChildHandles(): number {
  return process
    .getActiveResourcesInfo()
    .filter((type) => type === 'PipeWrap' || type === 'ProcessWrap').length;
}

async function waitUntilGone(pids: number[], ms = 3_000): Promise<number[]> {
  const until = Date.now() + ms;
  let alive = pids.filter(isAlive);
  while (alive.length > 0 && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 50));
    alive = pids.filter(isAlive);
  }
  return alive;
}

/** A process as `/proc/<pid>/stat` shows it: undefined once it is gone, or without `/proc`. */
function procStat(
  pid: number,
): { comm: string; state: string; sid: number; startTime: string } | undefined {
  let stat: string;
  try {
    stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ESRCH') return undefined;
    throw err;
  }
  // `comm` is parenthesised and may itself hold spaces or parentheses.
  const close = stat.lastIndexOf(')');
  const fields = stat.slice(close + 2).split(' ');
  return {
    comm: stat.slice(stat.indexOf('(') + 1, close),
    state: fields[0] ?? '',
    sid: Number(fields[3]),
    startTime: fields[19] ?? '',
  };
}

/**
 * A pid the cleanup may signal: a whole number above 1. To `kill`, 0 is this
 * worker's own process group and -1 every process it may signal; 1 is init.
 * An empty or blank marker reads as `Number('') === 0`.
 */
function isPid(value: number): boolean {
  return Number.isSafeInteger(value) && value > 1;
}

/**
 * The pids a marker file names. Each fake process appends its own pid as its
 * first command, before any trap, fork or `setsid`, so a process missing from
 * the file never started. Only a complete line holding a pid counts; one still
 * being written, an empty or blank one, or anything else names nothing.
 */
function markerPids(text: string): number[] {
  return (
    text
      .split('\n')
      // What follows the last newline: a line still being written, or nothing.
      .slice(0, -1)
      .filter((line) => /^\d+$/.test(line))
      .map(Number)
      .filter(isPid)
  );
}

/** The pids `file` names so far: none before its first process has started. */
async function recorded(file: string): Promise<number[]> {
  try {
    return markerPids(await readFile(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

let scratch: string;
const servers: Server[] = [];

/** A process a test started, and the start time that tells it from a later one. */
interface Stray {
  pid: number;
  startTime: string;
}

/**
 * Processes a test started, each pinned to its start time: the cleanup
 * SIGKILLs one only while its pid still names that same process, never a pid
 * since handed to another. Without `/proc` (macOS) nothing pins a pid, so
 * nothing is signalled there; a leftover `sleep 30` ends by itself.
 */
const strays: Stray[] = [];

/** Leave `pid` to the cleanup, pinned to the process it names now. */
function own(pid: number): void {
  if (!isPid(pid)) throw new Error(`not a pid a test started: ${pid}`);
  const stat = procStat(pid);
  // Already gone: nothing to stop.
  if (stat !== undefined && stat.state !== 'Z') {
    strays.push({ pid, startTime: stat.startTime });
  }
}

/** True while `stray`'s pid still names the process it was pinned to. */
function stillOwned({ pid, startTime }: Stray): boolean {
  if (!isPid(pid)) return false;
  const stat = procStat(pid);
  return (
    stat !== undefined && stat.state !== 'Z' && stat.startTime === startTime
  );
}

/** The real `setTimeout`, to wait on a fixture while the module's timers are held. */
const realSetTimeout = globalThis.setTimeout;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, ms));
}

/**
 * Fake the module's own timers alone (its deadlines, its kill graces and the
 * poll that waits out an escaped process), so a stage's deadline runs only
 * when `expire` says. The fixture's processes, their I/O and
 * `performance.now()` keep real time.
 */
function holdDeadlines(): void {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
}

/**
 * Wait, on real time, until `count` fake processes have recorded themselves in
 * `file` and the last of them has exec'd its `sleep` (its trap and `setsid`
 * done) or is already gone. Each is left to the cleanup as soon as it is seen:
 * with the deadlines held, no signal of the stage has reached it yet, so its
 * pid still names it. `boundBy` names a process that bounds them on a real
 * clock of its own (GNU `timeout`): once it has ended, so have they, recorded
 * or not.
 */
async function startedIn(
  file: string,
  count: number,
  boundBy?: string,
): Promise<number[]> {
  const seen = new Set<number>();
  const until = performance.now() + 20_000;
  let ids: number[] = [];
  while (performance.now() < until) {
    ids = await recorded(file);
    for (const pid of ids) {
      if (!seen.has(pid)) {
        seen.add(pid);
        own(pid);
      }
    }
    if (ids.length >= count) {
      // Undefined once it is gone, or without `/proc` to tell.
      const last = procStat(ids[count - 1]);
      if (last === undefined || last.state === 'Z' || last.comm === 'sleep') {
        return ids;
      }
    }
    if (boundBy !== undefined) {
      const [bound] = await recorded(boundBy);
      const stat = bound === undefined ? undefined : procStat(bound);
      if (bound !== undefined && (stat === undefined || stat.state === 'Z')) {
        return ids;
      }
    }
    await pause(10);
  }
  throw new Error(`${file}: ${ids.length} of ${count} processes ready in 20 s`);
}

/**
 * Run the stage's deadline now (`deadlineMs` reaches it, not the grace after
 * it), then let the held timers follow real time until `pending` settles: the
 * kill graces take as long as they would unheld.
 */
async function expire<T>(pending: Promise<T>, deadlineMs: number): Promise<T> {
  await vi.advanceTimersByTimeAsync(deadlineMs);
  vi.setTimerTickMode('interval', 10);
  try {
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'video-toolchain-'));
});

afterEach(async () => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
  for (const stray of strays.splice(0)) {
    if (!stillOwned(stray)) continue;
    try {
      process.kill(stray.pid, 'SIGKILL');
    } catch (err) {
      // ESRCH: it ended after the check.
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
        console.warn(`[test cleanup] could not stop pid ${stray.pid}:`, err);
      }
    }
  }
});

/** Loopback stub: `mode` decides how far the response gets before stalling. */
async function stub(mode: 'no-headers' | 'stall-body' | 'ok' | 'not-found') {
  const server = createServer((_req, res) => {
    if (mode === 'no-headers') return;
    if (mode === 'not-found') {
      res.writeHead(404).end();
      return;
    }
    if (mode === 'ok') {
      res.writeHead(200, { 'content-length': '5' }).end('bytes');
      return;
    }
    res.writeHead(200, { 'content-length': '1000000' });
    res.write('partial');
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/asset`;
}

type Stall =
  | 'plain'
  | 'ignores-term'
  | 'leaves-a-term-proof-child'
  | 'escapes-its-group';

/**
 * A fake child that waits on a background child of its own; each appends its
 * pid to a marker file as its first command, and the background child ends in
 * `sleep 30`. `ignores-term`: both shrug off SIGTERM, so only the SIGKILL
 * escalation stops them. `leaves-a-term-proof-child`: the child dies on
 * SIGTERM but its own child ignores it, so only a group kill after the child's
 * exit stops that. `escapes-its-group`: that child also moves into a session
 * of its own (`setsid`), so no signal to the group reaches it.
 * `startsAfterSeconds`: a host too loaded to start the fake child in time.
 */
async function stallingScript(
  name: string,
  stall: Stall = 'plain',
  startsAfterSeconds = 0,
) {
  const pidFile = join(scratch, `${name}.pids`);
  const script = join(scratch, name);
  const termProof =
    stall === 'leaves-a-term-proof-child' || stall === 'escapes-its-group'
      ? 'trap "" TERM; '
      : '';
  const setsid = stall === 'escapes-its-group' ? 'setsid ' : '';
  await writeFile(
    script,
    [
      '#!/bin/sh',
      startsAfterSeconds > 0 ? `sleep ${startsAfterSeconds}` : '',
      `echo $$ >> '${pidFile}'`,
      stall === 'ignores-term' ? "trap '' TERM" : '',
      `sh -c 'echo $$ >> "${pidFile}"; ${termProof}exec ${setsid}sleep 30' &`,
      'wait',
    ].join('\n'),
  );
  await chmod(script, 0o755);
  return {
    script,
    /** Both of them, once started (`startedIn`). */
    started: () => startedIn(pidFile, 2),
    /** Those that have started, read once the run has settled. */
    pids: async (): Promise<number[]> => {
      const ids = await recorded(pidFile);
      ids.forEach(own);
      return ids;
    },
  };
}

describe('process liveness observations', () => {
  it.each(['ENOENT', 'ESRCH'])(
    'counts a child that disappears during the stat read as gone (%s)',
    (code) => {
      // Force the procfs path on every host. Even a successful existence
      // probe cannot guarantee the child remains alive until the read.
      const exists = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const read = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
        throw Object.assign(new Error('process disappeared'), { code });
      });
      try {
        expect(isAlive(12345)).toBe(false);
      } finally {
        read.mockRestore();
        exists.mockRestore();
      }
    },
  );

  it('does not report an unreadable live process as gone', () => {
    const error = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    const exists = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const read = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw error;
    });
    try {
      expect(() => isAlive(12345)).toThrow(error);
    } finally {
      read.mockRestore();
      exists.mockRestore();
    }
  });
});

describe('downloadTo bounds', () => {
  it('rejects a body that stops arriving, naming the body stage', async () => {
    const url = await stub('stall-body');
    const startedAt = Date.now();
    const err = await downloadTo(
      'yt-dlp download',
      url,
      join(scratch, 'yt-dlp'),
      new ProvisioningClock(FAST),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VideoToolchainError);
    expect(err).toMatchObject({ stage: 'yt-dlp download body' });
    expect((err as Error).message).toMatch(
      /^\[video-toolchain\] yt-dlp download body: timed out after \d+ ms \(deadline 500 ms\)$/,
    );
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(fs.existsSync(join(scratch, 'yt-dlp'))).toBe(false);
  });

  it('rejects a server that never answers, naming the response stage', async () => {
    const url = await stub('no-headers');
    await expect(
      downloadTo(
        'deno download',
        url,
        join(scratch, 'deno.zip'),
        new ProvisioningClock(FAST),
      ),
    ).rejects.toMatchObject({ stage: 'deno download response' });
  });

  it('writes the asset when the server answers in time (control)', async () => {
    const url = await stub('ok');
    const dest = join(scratch, 'asset');
    await downloadTo(
      'control download',
      url,
      dest,
      new ProvisioningClock(FAST),
    );
    expect(await readFile(dest, 'utf8')).toBe('bytes');
  });

  it('names the stage when the connection itself fails', async () => {
    const url = await stub('ok');
    servers.splice(0).forEach((server) => server.close());
    await new Promise((r) => setTimeout(r, 50));
    await expect(
      downloadTo(
        'bgutil plugin download',
        url,
        join(scratch, 'plugin.zip'),
        new ProvisioningClock(FAST),
      ),
    ).rejects.toThrow(
      /^\[video-toolchain\] bgutil plugin download: download failed: /,
    );
  });

  it('keeps the HTTP failure for a non-2xx answer (control)', async () => {
    const url = await stub('not-found');
    await expect(
      downloadTo(
        'control download',
        url,
        join(scratch, 'x'),
        new ProvisioningClock(FAST),
      ),
    ).rejects.toThrow(/control download: download failed \(404 Not Found\)/);
  });
});

describe('bounded children', () => {
  it('stops a stalled child and everything it started, then names the stage', async () => {
    const { script, started } = await stallingScript('stall');
    const clock = new ProvisioningClock(FAST);
    holdDeadlines();
    const pending = run(
      'deno unzip',
      script,
      [],
      clock.stage(FAST.unzipMs),
      clock,
    ).catch((e: unknown) => e);
    const pids = await started();
    const err = await expire(pending, FAST.unzipMs);
    expect(err).toBeInstanceOf(VideoToolchainError);
    expect(err).toMatchObject({ stage: 'deno unzip' });
    expect((err as Error).message).toMatch(
      /^\[video-toolchain\] deno unzip: timed out after \d+ ms \(deadline 2000 ms\)$/,
    );
    expect(await waitUntilGone(pids)).toEqual([]);
  });

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const { script, started } = await stallingScript(
      'stubborn',
      'ignores-term',
    );
    const clock = new ProvisioningClock(FAST);
    holdDeadlines();
    const pending = run(
      'ffmpeg install (apt-get)',
      script,
      [],
      clock.stage(FAST.packageInstallMs),
      clock,
    ).catch((e: unknown) => e);
    const pids = await started();
    expect(await expire(pending, FAST.packageInstallMs)).toMatchObject({
      stage: 'ffmpeg install (apt-get)',
    });
    expect(await waitUntilGone(pids)).toEqual([]);
  });

  it('stops what a stopped child left behind in its group', async () => {
    const { script, started } = await stallingScript(
      'orphaning',
      'leaves-a-term-proof-child',
    );
    const clock = new ProvisioningClock(FAST);
    holdDeadlines();
    const pending = run(
      'deno unzip',
      script,
      [],
      clock.stage(FAST.unzipMs),
      clock,
    ).catch((e: unknown) => e);
    const pids = await started();
    expect(await expire(pending, FAST.unzipMs)).toMatchObject({
      stage: 'deno unzip',
    });
    expect(await waitUntilGone(pids)).toEqual([]);
  });

  it('leaves processes it did not start alone', async () => {
    // One bystander shares this worker's process group, one has its own.
    const bystanders = [
      spawn('sleep', ['30'], { stdio: 'ignore' }),
      spawn('sleep', ['30'], { detached: true, stdio: 'ignore' }),
    ].map((child) => child.pid as number);
    bystanders.forEach(own);
    const { script, started } = await stallingScript('stall');
    const clock = new ProvisioningClock(FAST);
    holdDeadlines();
    const pending = run(
      'deno unzip',
      script,
      [],
      clock.stage(FAST.unzipMs),
      clock,
    ).catch((e: unknown) => e);
    const pids = await started();
    const err = await expire(pending, FAST.unzipMs);
    expect((err as Error).message).toMatch(/timed out/);
    expect(await waitUntilGone(pids)).toEqual([]);
    expect(bystanders.filter(isAlive)).toEqual(bystanders);
  });

  it.skipIf(!ON_LINUX)(
    'stops what the child started outside its process group',
    async () => {
      const { script, started } = await stallingScript(
        'escaping',
        'escapes-its-group',
      );
      const clock = new ProvisioningClock(FAST);
      holdDeadlines();
      const pending = run(
        'deno unzip',
        script,
        [],
        clock.stage(FAST.unzipMs),
        clock,
      ).catch((e: unknown) => e);
      const pids = await started();
      const [, escaped] = pids;
      // Readiness control: it has left the group before the deadline runs.
      expect(procStat(escaped)).toMatchObject({ sid: escaped });
      const err = await expire(pending, FAST.unzipMs);
      expect((err as Error).message).toMatch(
        /^\[video-toolchain\] deno unzip: timed out after \d+ ms \(deadline 2000 ms\)$/,
      );
      expect(await waitUntilGone(pids)).toEqual([]);
    },
  );

  it.skipIf(!ON_LINUX)(
    'leaves processes it did not start alone while it stops one outside the group',
    async () => {
      // One bystander shares this worker's process group; one has a session
      // of its own, as the escaped child does, but this stage never started it.
      const bystanders = [
        spawn('sleep', ['30'], { stdio: 'ignore' }),
        spawn('sleep', ['30'], { detached: true, stdio: 'ignore' }),
      ].map((child) => child.pid as number);
      bystanders.forEach(own);
      const { script, started } = await stallingScript(
        'escaping',
        'escapes-its-group',
      );
      const clock = new ProvisioningClock(FAST);
      holdDeadlines();
      const pending = run(
        'deno unzip',
        script,
        [],
        clock.stage(FAST.unzipMs),
        clock,
      ).catch((e: unknown) => e);
      const pids = await started();
      const [, escaped] = pids;
      expect(procStat(escaped)).toMatchObject({ sid: escaped });
      const err = await expire(pending, FAST.unzipMs);
      expect((err as Error).message).toMatch(/timed out/);
      expect(await waitUntilGone(pids)).toEqual([]);
      expect(bystanders.filter(isAlive)).toEqual(bystanders);
    },
  );

  it.skipIf(!ON_LINUX)(
    'holds the deadline for a child that starts late, then stops it outside the group',
    async () => {
      // A runner too loaded to start the fake child within its 2 s deadline:
      // its first line sleeps 3 s. On real timers the stage stops it before it
      // has recorded anything (ENOENT), and the escape goes untested.
      const { script, started } = await stallingScript(
        'late',
        'escapes-its-group',
        3,
      );
      const clock = new ProvisioningClock(FAST);
      holdDeadlines();
      let settled = false;
      const spawnedAt = performance.now();
      const pending = run(
        'deno unzip',
        script,
        [],
        clock.stage(FAST.unzipMs),
        clock,
      )
        .catch((e: unknown) => e)
        .finally(() => {
          settled = true;
        });
      const pids = await started();
      const [, escaped] = pids;
      // Readiness controls: past the deadline in real time, the stage has
      // not settled, and the escaped child has a session of its own.
      expect(performance.now() - spawnedAt).toBeGreaterThan(FAST.unzipMs);
      expect(settled).toBe(false);
      expect(procStat(escaped)).toMatchObject({ sid: escaped });
      const err = await expire(pending, FAST.unzipMs);
      expect((err as Error).message).toMatch(
        /^\[video-toolchain\] deno unzip: timed out after \d+ ms \(deadline 2000 ms\)$/,
      );
      expect(await waitUntilGone(pids)).toEqual([]);
    },
  );

  it('resolves on exit 0 and reports a nonzero exit without a timeout (controls)', async () => {
    const clock = new ProvisioningClock(FAST);
    await expect(
      run('control', 'sh', ['-c', 'exit 0'], clock.stage(5_000), clock),
    ).resolves.toBeUndefined();
    const err = await run(
      'control',
      'sh',
      ['-c', 'exit 3'],
      clock.stage(5_000),
      clock,
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ stage: 'control' });
    expect((err as Error).message).toBe(
      "[video-toolchain] control: 'sh -c exit 3' exited 3",
    );
  });

  it('names the stage when the command cannot start (control)', async () => {
    const clock = new ProvisioningClock(FAST);
    await expect(
      run(
        'bgutil plugin unzip',
        join(scratch, 'missing'),
        [],
        clock.stage(5_000),
        clock,
      ),
    ).rejects.toThrow(
      /^\[video-toolchain\] bgutil plugin unzip: could not start/,
    );
  });
});

describe('monotonic accounting', () => {
  // `vi.setSystemTime` without fake timers steps `Date` alone: a wall-clock
  // jump, while timers and `performance.now()` run on.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('spends no budget on a wall-clock step', () => {
    const clock = new ProvisioningClock(FAST);
    vi.setSystemTime(Date.now() + 3_600_000);
    expect(clock.stage(10_000)).toEqual({ ms: 10_000 });
  });

  it('reports the real elapsed time across a wall-clock step back', async () => {
    const { script, pids } = await stallingScript('stall');
    const clock = new ProvisioningClock(FAST);
    const pending = run(
      'deno unzip',
      script,
      [],
      clock.stage(FAST.unzipMs),
      clock,
    ).catch((e: unknown) => e);
    vi.setSystemTime(Date.now() - 3_600_000);
    const message = ((await pending) as Error).message;
    vi.useRealTimers();
    const elapsed = /timed out after (\d+) ms \(deadline 2000 ms\)$/.exec(
      message,
    )?.[1];
    expect(Number(elapsed)).toBeGreaterThanOrEqual(2_000);
    expect(Number(elapsed)).toBeLessThan(10_000);
    expect(await waitUntilGone(await pids())).toEqual([]);
  });
});

describe('provisionToolchain bounds', () => {
  const originalPath = process.env.PATH;
  afterEach(() => {
    process.env.PATH = originalPath;
  });

  /** A cache holding yt-dlp, deno and the plugin, so only the ffmpeg stages run. */
  async function warmCache(): Promise<string> {
    const cacheDir = join(scratch, 'cache');
    await mkdir(join(cacheDir, 'bin'), { recursive: true });
    await mkdir(join(cacheDir, 'plugins', 'bgutil', 'yt_dlp_plugins'), {
      recursive: true,
    });
    await writeFile(join(cacheDir, 'bin', 'yt-dlp'), '');
    await writeFile(join(cacheDir, 'bin', 'deno'), '');
    return cacheDir;
  }

  async function fakeOnPath(name: string, body: string): Promise<void> {
    const dir = join(scratch, 'fake-bin');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), `#!/bin/sh\n${body}\n`);
    await chmod(join(dir, name), 0o755);
    process.env.PATH = `${dir}:${originalPath}`;
  }

  it('rejects a stalled ffmpeg lookup by its stage and stops the lookup', async () => {
    const cacheDir = await warmCache();
    const { script, started } = await stallingScript('which-stall');
    await fakeOnPath('which', `exec '${script}'`);
    holdDeadlines();
    const pending = provisionToolchain({ cacheDir, deadlines: FAST }).catch(
      (e: unknown) => e,
    );
    const pids = await started();
    expect(await expire(pending, FAST.lookupMs)).toMatchObject({
      stage: 'ffmpeg lookup',
    });
    expect(await waitUntilGone(pids)).toEqual([]);
  });

  it('caps every stage by the rest of the provisioning budget', async () => {
    const cacheDir = await warmCache();
    const { script, started } = await stallingScript('which-stall');
    await fakeOnPath('which', `exec '${script}'`);
    const deadlines = { ...FAST, totalMs: 1_500, lookupMs: 60_000 };
    holdDeadlines();
    const pending = provisionToolchain({ cacheDir, deadlines }).catch(
      (e: unknown) => e,
    );
    const pids = await started();
    const err = await expire(pending, deadlines.totalMs);
    expect((err as Error).message).toMatch(
      /ffmpeg lookup: timed out after \d+ ms \(the rest of the 1500 ms provisioning budget, \d+ ms\)$/,
    );
    expect(await waitUntilGone(pids)).toEqual([]);
  });

  it.skipIf(!ON_LINUX)(
    'stops a lookup child holding its stdout outside the group, and keeps no handle open',
    async () => {
      const cacheDir = await warmCache();
      const pidFile = join(scratch, 'lookup.pids');
      // #4084's receipt: the lookup starts `setsid sleep` — a session of its
      // own, holding the captured stdout — and waits on it.
      await fakeOnPath(
        'which',
        [
          `echo $$ >> '${pidFile}'`,
          `sh -c 'echo $$ >> "${pidFile}"; exec setsid sleep 30' &`,
          'wait',
        ].join('\n'),
      );
      const handles = liveChildHandles();
      holdDeadlines();
      const pending = provisionToolchain({
        cacheDir,
        deadlines: FAST,
      }).catch((e: unknown) => e);
      const ids = await startedIn(pidFile, 2);
      const [, escaped] = ids;
      expect(procStat(escaped)).toMatchObject({ sid: escaped });
      const expiredAt = performance.now();
      const err = await expire(pending, FAST.lookupMs);
      const settledMs = performance.now() - expiredAt;
      expect((err as Error).message).toMatch(
        /^\[video-toolchain\] ffmpeg lookup: timed out after \d+ ms \(deadline 2000 ms\)$/,
      );
      // Within the deadline's two kill graces, plus scheduling slack.
      expect(settledMs).toBeLessThan(2 * FAST.killGraceMs + 2_000);
      expect(await waitUntilGone(ids)).toEqual([]);
      await expect.poll(liveChildHandles).toBeLessThanOrEqual(handles);
    },
  );

  it.skipIf(!ON_LINUX)(
    'reports a stdout holder it could not stop, and keeps no handle open',
    async () => {
      const cacheDir = await warmCache();
      const holder = join(scratch, 'holder.pid');
      // The lookup hands its stdout to a process that moves into a session of
      // its own (`setsid`), re-parented away as the lookup exits 0 at once.
      await fakeOnPath(
        'which',
        `sh -c 'echo $$ >> "${holder}"; exec setsid sleep 30' &\nexit 0`,
      );
      const handles = liveChildHandles();
      holdDeadlines();
      const pending = provisionToolchain({
        cacheDir,
        deadlines: FAST,
      }).catch((e: unknown) => e);
      const [held] = await startedIn(holder, 1);
      expect(procStat(held)).toMatchObject({ sid: held });
      const err = await expire(pending, FAST.lookupMs);
      expect(err).toMatchObject({ stage: 'ffmpeg lookup' });
      expect((err as Error).message).toMatch(
        /^\[video-toolchain\] ffmpeg lookup: timed out after \d+ ms \(deadline 2000 ms\); cleanup incomplete: pid \d+ exited with code 0, but a process it started still holds its stdout after the group SIGKILL$/,
      );
      await expect.poll(liveChildHandles).toBeLessThanOrEqual(handles);
    },
  );

  it.skipIf(!ON_LINUX)(
    'bounds the privileged install on its own side',
    async () => {
      const cacheDir = await warmCache();
      const argv = join(scratch, 'sudo.argv');
      const hidden = join(scratch, 'hidden.pid');
      const aptPid = join(scratch, 'apt.pid');
      await fakeOnPath(
        'which',
        'case "$1" in apt-get) echo /usr/bin/apt-get ;; *) exit 1 ;; esac',
      );
      // A STAND-IN for sudo across a privilege boundary — no root, no real
      // sudo: it runs its command in a session of its own, re-parented away,
      // as far out of this process's reach as the root child of a real sudo,
      // and relays SIGTERM alone, as sudo does. Only a bound on that side can
      // stop the command.
      await fakeOnPath(
        'sudo',
        [
          '[ "$1" = "-n" ] && shift',
          `echo "$*" > '${argv}'`,
          `( setsid "$@" < /dev/null & echo $! > '${hidden}' )`,
          `trap 'kill -TERM "$(cat '${hidden}')" 2>/dev/null' TERM`,
          'while :; do sleep 0.1; done',
        ].join('\n'),
      );
      // A stalled apt-get that ignores SIGTERM.
      await fakeOnPath(
        'apt-get',
        `echo $$ >> '${aptPid}'\ntrap '' TERM\nexec sleep 30`,
      );
      holdDeadlines();
      const pending = provisionToolchain({
        cacheDir,
        deadlines: FAST,
      }).catch((e: unknown) => e);
      // `timeout` (its pid in `hidden`) keeps real time: on a runner too
      // loaded to start apt-get within its 2 s, it ends apt-get unrecorded.
      const pids = await startedIn(aptPid, 1, hidden);
      const err = await expire(pending, FAST.packageInstallMs);
      expect(await readFile(argv, 'utf8')).toBe(
        'timeout -k 0.2s 2s apt-get install -y ffmpeg\n',
      );
      expect((err as Error).message).toMatch(
        /^\[video-toolchain\] ffmpeg not found and could not be auto-installed \(\[video-toolchain\] ffmpeg install \(apt-get\): timed out after \d+ ms \(deadline 2000 ms\)\)/,
      );
      expect(await waitUntilGone(pids)).toEqual([]);
    },
  );

  it('returns the resolved toolchain when every stage answers (control)', async () => {
    const cacheDir = await warmCache();
    await fakeOnPath('which', 'echo /opt/fake/ffmpeg');
    await expect(
      provisionToolchain({ cacheDir, deadlines: FAST }),
    ).resolves.toEqual({
      binDir: join(cacheDir, 'bin'),
      ffmpegLocation: '/opt/fake/ffmpeg',
      pluginDir: join(cacheDir, 'plugins'),
    });
  });
});

describe('fixture pids', () => {
  // The cleanup SIGKILLs what these name. A marker read while its process was
  // still writing it once parsed as pid 0: to `kill`, this worker's own group.
  it('reads no pid from an empty, blank or unfinished marker, or a line that is not one', () => {
    for (const text of [
      '',
      ' ',
      '\n',
      ' \n',
      '123',
      '0\n',
      '1\n',
      '-1\n',
      '12 34\n',
      '1.5\n',
      'x\n',
    ]) {
      expect(markerPids(text), JSON.stringify(text)).toEqual([]);
    }
    expect(markerPids('123\n4567\n89')).toEqual([123, 4567]);
  });

  it('leaves the cleanup only whole pids above 1', () => {
    for (const value of [0, 1, -1, 1.5, Number.NaN, Number(''), Number(' ')]) {
      expect(isPid(value), String(value)).toBe(false);
    }
    expect(isPid(process.pid)).toBe(true);
  });

  it.skipIf(!ON_LINUX)(
    'leaves the cleanup a pid only while it names the process it was pinned to',
    () => {
      own(spawn('sleep', ['30'], { stdio: 'ignore' }).pid as number);
      const pinned = strays[strays.length - 1];
      expect(stillOwned(pinned)).toBe(true);
      // The same pid, handed to a process that started at another time.
      expect(
        stillOwned({ pid: pinned.pid, startTime: `${pinned.startTime}0` }),
      ).toBe(false);
      expect(stillOwned({ pid: 0, startTime: pinned.startTime })).toBe(false);
    },
  );
});
