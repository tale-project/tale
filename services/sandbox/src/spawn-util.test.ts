// spawn-util tests — runDocker drains pipes with hard byte caps so a
// runaway runtime container can't OOM the spawner heap.
//
// We exercise the wrapper end-to-end against `bash` (always present on the
// runtime image used in CI), not a mock, so the test catches Bun.spawn /
// ReadableStream API drift along with the cap semantics.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  IMAGE_PULL_TIMEOUT_MS,
  RUN_DOCKER_DEFAULT_TIMEOUT_MS,
  ensureImage,
  resolveDockerTimeoutMs,
  runDocker,
} from './spawn-util.ts';

// Override the docker binary for the duration of these tests. spawn-util
// reads DOCKER_BIN lazily on each invocation so this override works after
// module load.
const ORIGINAL_DOCKER_BIN = process.env.DOCKER_BIN;
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

  test('ensureImage: an inspect miss pulls exactly once and reports success', async () => {
    // A fake docker that fails `image inspect` and records every call. This
    // pins the boot path that carries IMAGE_PULL_TIMEOUT_MS (the budget itself
    // is pinned above; runDocker's kill timer is exercised by the race test).
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spawn-util-'));
    const log = path.join(dir, 'calls.log');
    const fake = path.join(dir, 'docker');
    await fs.writeFile(
      fake,
      `#!/bin/bash\necho "$*" >> "${log}"\nif [ "$1" = "image" ]; then exit 1; fi\nexit 0\n`,
      { mode: 0o755 },
    );
    const prev = process.env.DOCKER_BIN;
    process.env.DOCKER_BIN = fake;
    try {
      expect(await ensureImage('tale/runtime:test')).toBe(true);
      expect((await fs.readFile(log, 'utf8')).trim().split('\n')).toEqual([
        'image inspect tale/runtime:test',
        'pull tale/runtime:test',
      ]);
    } finally {
      process.env.DOCKER_BIN = prev;
      await fs.rm(dir, { recursive: true, force: true }).catch((err) => {
        console.warn('[spawn-util.test] tmp cleanup failed:', err);
      });
    }
  });
});
