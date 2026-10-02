/**
 * Bounds of the live test's self-provisioner (`ytdlp_toolchain.ts`), proven
 * on SYNTHETIC stalls only — a loopback HTTP stub and fake `sh` children; no
 * real download, package manager or network. A stalled `apt-get` once held
 * the required Unit job for the hook's full 600 s and outlived it (#4073):
 * every stage must reject on its own deadline, name itself, and stop exactly
 * the processes it started.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
 * Short bounds for the synthetic stalls. A stalled child gets 2 s, so even a
 * loaded runner has started it (and it has written its pid file) before the
 * deadline stops it.
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

/** Alive and not a zombie: an unreaped orphan must not count as stopped. */
function isAlive(pid: number): boolean {
  const stat = `/proc/${pid}/stat`;
  if (existsSync('/proc/self/stat')) {
    if (!existsSync(stat)) return false;
    const state = readFileSync(stat, 'utf8').split(') ')[1]?.[0];
    return state !== undefined && state !== 'Z';
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

let scratch: string;
const servers: Server[] = [];
const strays: number[] = [];

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'video-toolchain-'));
});

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone — the expected case.
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

type Stall = 'plain' | 'ignores-term' | 'leaves-a-term-proof-child';

/**
 * A fake child that records its own pid and a background child's, then waits.
 * `ignores-term`: both shrug off SIGTERM, so only the SIGKILL escalation stops
 * them. `leaves-a-term-proof-child`: the child dies on SIGTERM but its own
 * child ignores it, so only a group kill after the child's exit stops that.
 */
async function stallingScript(name: string, stall: Stall = 'plain') {
  const pidFile = join(scratch, `${name}.pids`);
  const script = join(scratch, name);
  const background =
    stall === 'leaves-a-term-proof-child'
      ? `sh -c "trap '' TERM; exec sleep 30" &`
      : 'sleep 30 &';
  await writeFile(
    script,
    [
      '#!/bin/sh',
      stall === 'ignores-term' ? "trap '' TERM" : '',
      background,
      `echo "$$ $!" > '${pidFile}'`,
      'wait',
    ].join('\n'),
  );
  await chmod(script, 0o755);
  const pids = async (): Promise<number[]> => {
    const ids = (await readFile(pidFile, 'utf8')).trim().split(' ').map(Number);
    strays.push(...ids);
    return ids;
  };
  return { script, pids };
}

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
    expect(existsSync(join(scratch, 'yt-dlp'))).toBe(false);
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
    const { script, pids } = await stallingScript('stall');
    const clock = new ProvisioningClock(FAST);
    const err = await run(
      'deno unzip',
      script,
      [],
      clock.stage(FAST.unzipMs),
      clock,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VideoToolchainError);
    expect(err).toMatchObject({ stage: 'deno unzip' });
    expect((err as Error).message).toMatch(
      /^\[video-toolchain\] deno unzip: timed out after \d+ ms \(deadline 2000 ms\)$/,
    );
    expect(await waitUntilGone(await pids())).toEqual([]);
  });

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const { script, pids } = await stallingScript('stubborn', 'ignores-term');
    const clock = new ProvisioningClock(FAST);
    await expect(
      run(
        'ffmpeg install (apt-get)',
        script,
        [],
        clock.stage(FAST.packageInstallMs),
        clock,
      ),
    ).rejects.toMatchObject({ stage: 'ffmpeg install (apt-get)' });
    expect(await waitUntilGone(await pids())).toEqual([]);
  });

  it('stops what a stopped child left behind in its group', async () => {
    const { script, pids } = await stallingScript(
      'orphaning',
      'leaves-a-term-proof-child',
    );
    const clock = new ProvisioningClock(FAST);
    await expect(
      run('deno unzip', script, [], clock.stage(FAST.unzipMs), clock),
    ).rejects.toMatchObject({ stage: 'deno unzip' });
    expect(await waitUntilGone(await pids())).toEqual([]);
  });

  it('leaves processes it did not start alone', async () => {
    // One bystander shares this worker's process group, one has its own.
    const bystanders = [
      spawn('sleep', ['30'], { stdio: 'ignore' }),
      spawn('sleep', ['30'], { detached: true, stdio: 'ignore' }),
    ].map((child) => child.pid as number);
    strays.push(...bystanders);
    const { script, pids } = await stallingScript('stall');
    const clock = new ProvisioningClock(FAST);
    await expect(
      run('deno unzip', script, [], clock.stage(FAST.unzipMs), clock),
    ).rejects.toThrow(/timed out/);
    expect(await waitUntilGone(await pids())).toEqual([]);
    expect(bystanders.filter(isAlive)).toEqual(bystanders);
  });

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
    const { script, pids } = await stallingScript('which-stall');
    await fakeOnPath('which', `exec '${script}'`);
    await expect(
      provisionToolchain({ cacheDir, deadlines: FAST }),
    ).rejects.toMatchObject({ stage: 'ffmpeg lookup' });
    expect(await waitUntilGone(await pids())).toEqual([]);
  });

  it('caps every stage by the rest of the provisioning budget', async () => {
    const cacheDir = await warmCache();
    const { script, pids } = await stallingScript('which-stall');
    await fakeOnPath('which', `exec '${script}'`);
    const err = await provisionToolchain({
      cacheDir,
      deadlines: { ...FAST, totalMs: 1_500, lookupMs: 60_000 },
    }).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(
      /ffmpeg lookup: timed out after \d+ ms \(the rest of the 1500 ms provisioning budget, \d+ ms\)$/,
    );
    expect(await waitUntilGone(await pids())).toEqual([]);
  });

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
