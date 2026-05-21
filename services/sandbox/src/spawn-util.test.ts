// spawn-util tests — runDocker drains pipes with hard byte caps so a
// runaway runtime container can't OOM the spawner heap.
//
// We exercise the wrapper end-to-end against `bash` (always present on the
// runtime image used in CI), not a mock, so the test catches Bun.spawn /
// ReadableStream API drift along with the cap semantics.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { runDocker } from './spawn-util.ts';

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
    // Produce ~5 MiB of stdout from a 1-line script.
    const result = await runDocker(
      [
        '-c',
        // 5_000 lines × ~1 KB each ≈ 5 MB
        'for i in $(seq 1 5000); do printf "%.0s_" {1..1024}; echo; done',
      ],
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
      [
        '-c',
        'for i in $(seq 1 5000); do printf "%.0s_" {1..1024} >&2; echo >&2; done',
      ],
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
