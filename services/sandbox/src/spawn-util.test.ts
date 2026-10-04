// spawn-util tests — runDocker drains pipes with hard byte caps so a
// runaway runtime container can't OOM the spawner heap.
//
// We exercise the wrapper end-to-end against `bash` (always present on the
// runtime image used in CI), not a mock, so the test catches Bun.spawn /
// ReadableStream API drift along with the cap semantics.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  outsideOperationBudget,
  waitWithinOperation,
  withOperationBudget,
} from './operation-budget.ts';
import {
  DOCKER_CLI_CONCURRENCY,
  DOCKER_CLI_PRIORITY_CONCURRENCY,
  IMAGE_PULL_TIMEOUT_MS,
  RUN_DOCKER_DEFAULT_TIMEOUT_MS,
  dockerCliLoad,
  ensureImage,
  resolveDockerTimeoutMs,
  runDocker,
} from './spawn-util.ts';

// Override the docker binary for the duration of these tests. spawn-util
// reads DOCKER_BIN lazily on each invocation so this override works after
// module load.
const ORIGINAL_DOCKER_BIN = process.env.DOCKER_BIN;
async function rejection(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
beforeAll(() => {
  process.env.DOCKER_BIN = '/bin/bash';
});
afterAll(() => {
  if (ORIGINAL_DOCKER_BIN !== undefined) {
    process.env.DOCKER_BIN = ORIGINAL_DOCKER_BIN;
  } else {
    delete process.env.DOCKER_BIN;
  }
});

describe('runDocker — byte caps', () => {
  test('one lifecycle deadline cancels a slow CLI and forbids a later launch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tale-docker-budget-'));
    const marker = join(dir, 'late-start');
    try {
      expect(
        await rejection(
          withOperationBudget(50, async () => {
            await runDocker(['-c', 'sleep 0.3'], { timeoutMs: 5_000 });
            const late = await runDocker([
              '-c',
              'echo late > "$1"',
              'late',
              marker,
            ]);
            expect(late.exitCode).toBe(-1);
          }),
        ),
      ).toContain('deadline');
      expect(await Bun.file(marker).exists()).toBe(false);
      expect(dockerCliLoad()).toEqual({ running: 0, waiting: 0 });
      // Cleanup remains possible after a cancelled create.
      const cleaned = await outsideOperationBudget(() =>
        runDocker(['-c', 'true']),
      );
      expect(cleaned.exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('an optional helper stops waiting for another operation at its own deadline', async () => {
    const other = Promise.withResolvers<void>();
    const keepAlive = setTimeout(() => other.resolve(), 1_000);
    try {
      expect(
        await rejection(
          withOperationBudget(20, () => waitWithinOperation(other.promise)),
        ),
      ).toContain('deadline');
      // Cancelling the waiter never cancels its shared producer.
      other.resolve();
      await other.promise;
    } finally {
      clearTimeout(keepAlive);
    }
  });
  test('caps stdout at stdoutMaxBytes and marks truncated', async () => {
    // ~256 KiB of stdout — exceeds the 64 KiB cap by 4× (so truncation
    // definitely fires) but is small enough to finish well inside bun's
    // 5 s per-test budget on shared CI runners. `head -c … /dev/zero | tr`
    // is byte-efficient in C; previously a 5 MiB bash brace-expansion
    // loop intermittently timed out under CI load.
    const result = await runDocker(
      ['-c', `head -c ${256 * 1024} /dev/zero | tr '\\0' '_'`],
      { stdoutMaxBytes: 64 * 1024 },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdout.length).toBeGreaterThan(0);
    // Total buffered should be <= cap + one chunk overhang (~64 KiB max).
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(64 * 1024);
  });

  test('caps stderr at stderrMaxBytes', async () => {
    const result = await runDocker(
      ['-c', `head -c ${128 * 1024} /dev/zero | tr '\\0' '_' >&2`],
      { stderrMaxBytes: 32 * 1024 },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderrTruncated).toBe(true);
    expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(32 * 1024);
  });

  test('no truncation when output is within cap', async () => {
    const result = await runDocker(['-c', 'echo "hello world"'], {
      stdoutMaxBytes: 1024,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTruncated).toBe(false);
    expect(result.stderrTruncated).toBe(false);
    expect(result.stdout).toBe('hello world\n');
  });

  test('onStdoutChunk fires even for bytes past the cap (phase parsing)', async () => {
    const chunks: Uint8Array[] = [];
    const result = await runDocker(
      [
        '-c',
        // Emit 200 lines × 1 KB. With a 4 KB cap the buffered output ≈ 4
        // KB but we should still receive callbacks for all chunks so phase
        // markers aren't silently dropped by truncation.
        'for i in $(seq 1 200); do printf "%.0s_" {1..1024}; echo; done',
      ],
      {
        stdoutMaxBytes: 4 * 1024,
        onStdoutChunk: (c) => chunks.push(c),
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTruncated).toBe(true);
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    expect(total).toBeGreaterThan(4 * 1024); // post-cap chunks still fired
  });
});

describe('runDocker — timeout race', () => {
  test('timeout fires and exits within budget', async () => {
    // Use `exec` so bash replaces itself with sleep — SIGKILL then targets a
    // single process whose pipes close on exit. Without `exec`, bash forks
    // sleep as a child and the inherited stdout pipe stays open until sleep
    // also dies (an OS-level pipe-inheritance quirk, not relevant to the
    // docker CLI which doesn't fork subprocesses that inherit its stdio).
    const start = Date.now();
    const result = await runDocker(['-c', 'echo started; exec sleep 10'], {
      timeoutMs: 250,
    });
    const elapsed = Date.now() - start;
    expect(result.exitCode).toBe(124);
    expect(elapsed).toBeLessThan(3_000);
  });
});

// REGRESSION: the kill timer used to arm only when a caller passed timeoutMs,
// so the health probe, the sweeps and the cache-volume setup ran unbounded
// against a wedged daemon. Every call now carries a budget unless it opts out.
describe('runDocker — default timeout', () => {
  test('no timeoutMs ⇒ the default budget; an explicit one wins; Infinity opts out', () => {
    expect(resolveDockerTimeoutMs(undefined)).toBe(
      RUN_DOCKER_DEFAULT_TIMEOUT_MS,
    );
    expect(resolveDockerTimeoutMs(5_000)).toBe(5_000);
    expect(resolveDockerTimeoutMs(Infinity)).toBeNull();
  });

  test('the default is a real bound, not a formality', () => {
    expect(RUN_DOCKER_DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isFinite(RUN_DOCKER_DEFAULT_TIMEOUT_MS)).toBe(true);
  });

  // REGRESSION: the default once bounded the boot-time pull of the multi-GB
  // runtime image too, so on any host without a pre-pull the CLI was killed at
  // 60 s on all three attempts and no session could ever start. The pull has
  // its own budget — minutes, not seconds — and it is still a real bound.
  test('the image pull outlives the default by minutes and stays bounded', () => {
    expect(IMAGE_PULL_TIMEOUT_MS).toBeGreaterThanOrEqual(
      10 * RUN_DOCKER_DEFAULT_TIMEOUT_MS,
    );
    expect(Number.isFinite(IMAGE_PULL_TIMEOUT_MS)).toBe(true);
    expect(resolveDockerTimeoutMs(IMAGE_PULL_TIMEOUT_MS)).toBe(
      IMAGE_PULL_TIMEOUT_MS,
    );
  });

  test('ensureImage: an inspect miss pulls exactly once, under the pull budget', async () => {
    // A recording runner in place of runDocker: pins BOTH the boot path's
    // argv sequence and that the pull actually carries IMAGE_PULL_TIMEOUT_MS
    // while `image inspect` keeps the default (runDocker's kill timer itself
    // is exercised by the race test above).
    const calls: Array<{ args: string[]; timeoutMs: number | undefined }> = [];
    const run: typeof runDocker = async (args, opts) => {
      calls.push({ args, timeoutMs: opts?.timeoutMs });
      return {
        exitCode: args[0] === 'image' ? 1 : 0,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    };
    expect(await ensureImage('tale/runtime:test', { run })).toBe(true);
    expect(calls).toEqual([
      { args: ['image', 'inspect', 'tale/runtime:test'], timeoutMs: undefined },
      { args: ['pull', 'tale/runtime:test'], timeoutMs: IMAGE_PULL_TIMEOUT_MS },
    ]);
  });
});

describe('docker CLI concurrency', () => {
  test('at most DOCKER_CLI_CONCURRENCY docker processes run at once; the rest wait their turn', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tale-docker-slots-'));
    const bin = join(dir, 'docker');
    await writeFile(bin, '#!/bin/sh\nsleep 0.3\necho done\n');
    await chmod(bin, 0o755);
    const previous = process.env.DOCKER_BIN;
    process.env.DOCKER_BIN = bin;
    try {
      const calls = Array.from({ length: DOCKER_CLI_CONCURRENCY + 6 }, () =>
        runDocker(['info']),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(dockerCliLoad()).toEqual({
        running: DOCKER_CLI_CONCURRENCY,
        waiting: 6,
      });
      const results = await Promise.all(calls);
      expect(results.every((result) => result.stdout.trim() === 'done')).toBe(
        true,
      );
      expect(dockerCliLoad()).toEqual({ running: 0, waiting: 0 });
    } finally {
      if (previous === undefined) delete process.env.DOCKER_BIN;
      else process.env.DOCKER_BIN = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a call that waits past its budget for a slot answers as a timeout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tale-docker-slots-'));
    const bin = join(dir, 'docker');
    await writeFile(bin, '#!/bin/sh\nsleep "$2"\necho done\n');
    await chmod(bin, 0o755);
    const previous = process.env.DOCKER_BIN;
    process.env.DOCKER_BIN = bin;
    try {
      // Long pulls hold every slot.
      const holders = Array.from({ length: DOCKER_CLI_CONCURRENCY }, () =>
        runDocker(['pull', '1.5'], { timeoutMs: 10_000 }),
      );
      const startedAtMs = Date.now();
      const probe = await runDocker(['inspect', '0'], { timeoutMs: 300 });
      expect(probe.exitCode).toBe(124);
      expect(probe.noSlot).toBe(true);
      expect(Date.now() - startedAtMs).toBeLessThan(1_000);
      expect(dockerCliLoad().waiting).toBe(0);
      // A call whose wait used part of its budget runs on what is left.
      const late = runDocker(['inspect', '1'], { timeoutMs: 1_800 });
      expect((await late).exitCode).toBe(124);
      const results = await Promise.all(holders);
      expect(results.every((result) => result.exitCode === 0)).toBe(true);
      expect(results.some((result) => result.noSlot === true)).toBe(false);
      expect(dockerCliLoad()).toEqual({ running: 0, waiting: 0 });
    } finally {
      if (previous === undefined) delete process.env.DOCKER_BIN;
      else process.env.DOCKER_BIN = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a short call never queues behind long ones holding every shared slot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tale-docker-slots-'));
    const bin = join(dir, 'docker');
    await writeFile(bin, '#!/bin/sh\nsleep "$2"\necho done\n');
    await chmod(bin, 0o755);
    const previous = process.env.DOCKER_BIN;
    process.env.DOCKER_BIN = bin;
    try {
      const holders = Array.from({ length: DOCKER_CLI_CONCURRENCY }, () =>
        runDocker(['pull', '3'], { timeoutMs: 10_000 }),
      );
      // Queued behind them, an ordinary call waits for the first to end.
      const queued = runDocker(['inspect', '0'], { timeoutMs: 10_000 });
      const short = await runDocker(['inspect', '0'], {
        timeoutMs: 2_000,
        priority: true,
      });
      // It ran, and ended while every shared slot was still held and the
      // ordinary call still waited.
      expect(short.exitCode).toBe(0);
      expect(dockerCliLoad()).toEqual({
        running: DOCKER_CLI_CONCURRENCY,
        waiting: 1,
      });
      await Promise.all([...holders, queued]);
      expect(dockerCliLoad('priority')).toEqual({ running: 0, waiting: 0 });
    } finally {
      if (previous === undefined) delete process.env.DOCKER_BIN;
      else process.env.DOCKER_BIN = previous;
      await rm(dir, { recursive: true, force: true });
    }
  }, 10_000);

  test('short calls take a free shared slot first, and their own lane is bounded too', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tale-docker-slots-'));
    const bin = join(dir, 'docker');
    await writeFile(bin, '#!/bin/sh\nsleep "$2"\necho done\n');
    await chmod(bin, 0o755);
    const previous = process.env.DOCKER_BIN;
    process.env.DOCKER_BIN = bin;
    try {
      const calls = Array.from(
        { length: DOCKER_CLI_CONCURRENCY + DOCKER_CLI_PRIORITY_CONCURRENCY },
        () =>
          runDocker(['inspect', '1'], { timeoutMs: 10_000, priority: true }),
      );
      expect(dockerCliLoad()).toEqual({
        running: DOCKER_CLI_CONCURRENCY,
        waiting: 0,
      });
      expect(dockerCliLoad('priority')).toEqual({
        running: DOCKER_CLI_PRIORITY_CONCURRENCY,
        waiting: 0,
      });
      const late = await runDocker(['inspect', '0'], {
        timeoutMs: 300,
        priority: true,
      });
      expect(late.exitCode).toBe(124);
      expect(late.noSlot).toBe(true);
      const results = await Promise.all(calls);
      expect(results.every((result) => result.exitCode === 0)).toBe(true);
      expect(dockerCliLoad()).toEqual({ running: 0, waiting: 0 });
      expect(dockerCliLoad('priority')).toEqual({ running: 0, waiting: 0 });
    } finally {
      if (previous === undefined) delete process.env.DOCKER_BIN;
      else process.env.DOCKER_BIN = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runDocker — cancellation before spawn', () => {
  test.each([false, true])(
    'an already-aborted call does not take a slot or spawn (priority %p)',
    async (priority) => {
      const dir = await mkdtemp(join(tmpdir(), 'tale-docker-cancel-'));
      const marker = join(dir, 'started');
      const aborter = new AbortController();
      aborter.abort();
      const cancelled = runDocker(
        ['-c', 'echo started > "$1"', 'cancelled', marker],
        { priority, signal: aborter.signal },
      );
      const completed = Promise.allSettled([cancelled]);
      try {
        expect(dockerCliLoad()).toEqual({ running: 0, waiting: 0 });
        expect(dockerCliLoad('priority')).toEqual({ running: 0, waiting: 0 });
        const result = await cancelled;
        expect(result.exitCode).toBe(-1);
        expect(result.noSlot).toBeUndefined();
        expect(result.stderr).toContain('aborted');
        expect(await Bun.file(marker).exists()).toBe(false);
      } finally {
        await completed;
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  test('cancellation between a free slot grant and spawn releases the slot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tale-docker-cancel-'));
    const marker = join(dir, 'started');
    const aborter = new AbortController();
    try {
      const cancelled = runDocker(
        ['-c', 'echo started > "$1"', 'cancelled', marker],
        { signal: aborter.signal },
      );
      expect(dockerCliLoad()).toEqual({ running: 1, waiting: 0 });
      aborter.abort();
      expect((await cancelled).exitCode).toBe(-1);
      expect(await Bun.file(marker).exists()).toBe(false);
      expect(dockerCliLoad()).toEqual({ running: 0, waiting: 0 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test.each([false, true])(
    'a cancelled waiter leaves its queue immediately without spawning (priority %p)',
    async (priority) => {
      const dir = await mkdtemp(join(tmpdir(), 'tale-docker-cancel-'));
      const release = join(dir, 'release');
      const marker = join(dir, 'started');
      const aborter = new AbortController();
      const holders = Array.from(
        {
          length:
            DOCKER_CLI_CONCURRENCY +
            (priority ? DOCKER_CLI_PRIORITY_CONCURRENCY : 0),
        },
        () =>
          runDocker(
            [
              '-c',
              'while [ ! -e "$1" ]; do sleep 0.01; done',
              'holder',
              release,
            ],
            { timeoutMs: 10_000, priority },
          ),
      );
      // Exercise both finite-budget cleanup and the unbounded wait's abort.
      const cancelled = runDocker(
        ['-c', 'echo started > "$1"', 'cancelled', marker],
        {
          timeoutMs: priority ? Infinity : 10_000,
          priority,
          signal: aborter.signal,
        },
      );
      const next = runDocker(['-c', 'echo next'], {
        timeoutMs: 10_000,
        priority,
      });
      const completed = Promise.allSettled([...holders, cancelled, next]);
      const lane = priority ? 'priority' : 'shared';
      try {
        expect(dockerCliLoad(lane).waiting).toBe(2);
        aborter.abort();
        expect(dockerCliLoad(lane).waiting).toBe(1);
        const result = await cancelled;
        expect(result.exitCode).toBe(-1);
        expect(result.noSlot).toBeUndefined();
        expect(result.stderr).toContain('aborted');
        expect(await Bun.file(marker).exists()).toBe(false);
        // The holders still own every slot; cancellation did not release one.
        expect(dockerCliLoad()).toEqual({
          running: DOCKER_CLI_CONCURRENCY,
          waiting: priority ? 0 : 1,
        });
        if (priority) {
          expect(dockerCliLoad('priority')).toEqual({
            running: DOCKER_CLI_PRIORITY_CONCURRENCY,
            waiting: 1,
          });
        }
        await writeFile(release, '');
        expect((await next).stdout).toBe('next\n');
        expect(
          (await Promise.all(holders)).every((r) => r.exitCode === 0),
        ).toBe(true);
        expect(await Bun.file(marker).exists()).toBe(false);
        expect(dockerCliLoad()).toEqual({ running: 0, waiting: 0 });
        expect(dockerCliLoad('priority')).toEqual({ running: 0, waiting: 0 });
      } finally {
        await writeFile(release, '');
        await completed;
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
