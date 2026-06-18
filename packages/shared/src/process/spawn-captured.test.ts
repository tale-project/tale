import { describe, expect, it } from 'vitest';

import type { ClassifiedLine } from '../classify/index.ts';
import { spawnCaptured } from './spawn-captured.ts';

// Spawn the same runtime that's executing this test (node under vitest) with a
// `-e` one-liner — no dependency on `bun` being on PATH, and it exercises the
// node backend the dev orchestrator uses.
const RUNTIME = process.execPath;

describe('spawnCaptured (node backend)', () => {
  it('captures classified stdout + stderr, the exit code, and the ring', async () => {
    const lines: ClassifiedLine[] = [];
    const proc = spawnCaptured({
      cmd: RUNTIME,
      args: [
        '-e',
        'console.log("hello"); console.error("oops"); process.exit(3)',
      ],
      backend: 'node',
      now: () => 4242,
      onClassified: (c) => lines.push(c),
    });
    const code = await proc.exited;

    expect(code).toBe(3);
    const raws = lines.map((l) => l.raw);
    expect(raws).toContain('hello');
    expect(raws).toContain('oops');
    expect(lines[0].receivedAt).toBe(4242);
    expect(proc.ring()).toContain('hello');
  }, 15_000);

  it('mirrors raw lines to the injected writer in verbose mode', async () => {
    const written: string[] = [];
    const proc = spawnCaptured({
      cmd: RUNTIME,
      args: ['-e', 'console.log("trace-me")'],
      backend: 'node',
      verbose: true,
      write: (s) => written.push(s),
    });
    await proc.exited;
    expect(written.join('')).toContain('trace-me');
  }, 15_000);

  it('kill() resolves without throwing and the process exits', async () => {
    const proc = spawnCaptured({
      cmd: RUNTIME,
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      backend: 'node',
    });
    await proc.kill('SIGTERM');
    await expect(proc.exited).resolves.toBeTypeOf('number');
  }, 15_000);

  it('honors ringSize, retaining only the newest lines', async () => {
    const proc = spawnCaptured({
      cmd: RUNTIME,
      args: ['-e', 'for (let i = 0; i < 50; i++) console.log(i)'],
      backend: 'node',
      ringSize: 10,
    });
    await proc.exited;
    const ring = proc.ring();
    expect(ring).toHaveLength(10);
    expect(ring[0]).toBe('40');
    expect(ring[9]).toBe('49');
  }, 15_000);

  it('stamps receivedAt from the injected clock on EVERY line', async () => {
    const lines: ClassifiedLine[] = [];
    const proc = spawnCaptured({
      cmd: RUNTIME,
      args: ['-e', 'console.log("a"); console.log("b"); console.log("c")'],
      backend: 'node',
      now: () => 7,
      onClassified: (c) => lines.push(c),
    });
    await proc.exited;
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.every((l) => l.receivedAt === 7)).toBe(true);
  }, 15_000);

  it('applies the injected classifier to each line', async () => {
    const lines: ClassifiedLine[] = [];
    const proc = spawnCaptured({
      cmd: RUNTIME,
      args: ['-e', 'console.log("BOOM")'],
      backend: 'node',
      classifier: (line) => ({
        kind: line === 'BOOM' ? 'error' : 'info',
        text: line,
        raw: line,
        source: 'generic',
      }),
      onClassified: (c) => lines.push(c),
    });
    await proc.exited;
    expect(lines.some((l) => l.kind === 'error' && l.raw === 'BOOM')).toBe(
      true,
    );
  }, 15_000);

  it('routes the kill through the injected treeKill, not the raw process kill', async () => {
    const calls: Array<[number, string]> = [];
    const proc = spawnCaptured({
      cmd: RUNTIME,
      args: ['-e', 'setTimeout(() => {}, 400)'],
      backend: 'node',
      treeKill: (pid, signal) => {
        calls.push([pid, signal]);
      },
    });
    await proc.kill('SIGTERM');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(proc.pid);
    expect(calls[0][1]).toBe('SIGTERM');
    await proc.exited; // exits on its own (no orphan)
  }, 15_000);

  it('is best-effort: a throwing treeKill is reported via onError, not rethrown', async () => {
    const errors: string[] = [];
    const proc = spawnCaptured({
      cmd: RUNTIME,
      args: ['-e', 'setTimeout(() => {}, 400)'],
      backend: 'node',
      treeKill: () => {
        throw new Error('nope');
      },
      onError: (m) => errors.push(m),
    });
    await expect(proc.kill('SIGTERM')).resolves.toBeUndefined();
    expect(errors.join('')).toContain('kill');
    await proc.exited;
  }, 15_000);

  it('rejects `exited` when the child fails to spawn (ENOENT)', async () => {
    const proc = spawnCaptured({
      cmd: 'tale-definitely-not-a-real-binary-xyz',
      backend: 'node',
    });
    await expect(proc.exited).rejects.toBeDefined();
  }, 15_000);

  it('REPLACES the environment when env is provided (does not merge the host env)', async () => {
    const lines: ClassifiedLine[] = [];
    const proc = spawnCaptured({
      cmd: RUNTIME,
      args: [
        '-e',
        'console.log(process.env.FOO + "/" + (process.env.PATH ? "haspath" : "nopath"))',
      ],
      backend: 'node',
      env: { FOO: 'bar' },
      onClassified: (c) => lines.push(c),
    });
    await proc.exited;
    expect(lines.map((l) => l.raw).join('\n')).toContain('bar/nopath');
  }, 15_000);
});
