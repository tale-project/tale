import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listDir, readWorkspaceFile, stageFiles } from './file-ops.ts';

const ROOT = realpathSync(mkdtempSync(`${tmpdir()}/runnerd-fs-`));

beforeAll(() => {
  process.env.TALE_WORKSPACE_ROOT = ROOT;
  writeFileSync(join(ROOT, 'hello.txt'), 'hi there');
});
afterAll(() => {
  delete process.env.TALE_WORKSPACE_ROOT;
  rmSync(ROOT, { recursive: true, force: true });
});

describe('file-ops', () => {
  test('listDir returns entries under the workspace', async () => {
    const entries = await listDir('.');
    expect(
      entries?.some((e) => e.name === 'hello.txt' && e.type === 'file'),
    ).toBe(true);
  });

  test('listDir rejects a path outside the workspace', async () => {
    expect(await listDir('/etc')).toBeNull();
  });

  test('readWorkspaceFile reads bytes; rejects traversal + oversize', async () => {
    const buf = await readWorkspaceFile('hello.txt', 1_000);
    expect(buf?.toString()).toBe('hi there');
    expect(await readWorkspaceFile('../escape', 1_000)).toBeNull();
    expect(await readWorkspaceFile('hello.txt', 2)).toBeNull(); // oversize
  });

  test('stageFiles writes inline contentBase64 without a fetch', async () => {
    const result = await stageFiles([
      {
        path: '.runtime/tale/steer/exec-1/steer-1.json',
        contentBase64: Buffer.from('{"text":"hi"}', 'utf8').toString('base64'),
      },
      { path: 'no-source.txt' },
      {
        path: 'too-big.bin',
        contentBase64: Buffer.alloc(2 * 1024 * 1024).toString('base64'),
      },
    ]);
    expect(result.staged).toEqual([
      { path: '.runtime/tale/steer/exec-1/steer-1.json', bytes: 13 },
    ]);
    expect(result.skipped).toEqual([
      { path: 'no-source.txt', reason: 'no_source' },
      { path: 'too-big.bin', reason: 'too_large' },
    ]);
    expect(
      (
        await readWorkspaceFile(
          '.runtime/tale/steer/exec-1/steer-1.json',
          1_000,
        )
      )?.toString(),
    ).toBe('{"text":"hi"}');
  });

  // REGRESSION: a stage URL fetch had no deadline of its own — a server that
  // accepted and never answered (or trickled) pinned the handler and every
  // later item in the batch for undici's 300 s defaults, long after the
  // spawner's 30 s RPC bound had already reported a timeout.
  test('stageFiles gives up on a stalled URL within its deadline and moves on', async () => {
    const stalled = Bun.serve({
      port: 0,
      fetch: () => new Promise<Response>(() => {}), // never answers
    });
    const live = Bun.serve({
      port: 0,
      fetch: () => new Response('after-the-stall'),
    });
    try {
      const started = Date.now();
      const result = await stageFiles(
        [
          { path: 'stalled.txt', url: `http://127.0.0.1:${stalled.port}/x` },
          { path: 'later.txt', url: `http://127.0.0.1:${live.port}/x` },
        ],
        { fetchTimeoutMs: 200 },
      );
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(result.skipped).toEqual([
        { path: 'stalled.txt', reason: 'timeout' },
      ]);
      // The item behind the stall still stages.
      expect(result.staged).toEqual([{ path: 'later.txt', bytes: 15 }]);
    } finally {
      await stalled.stop(true);
      await live.stop(true);
    }
  });

  test('stageFiles fetches a URL and writes under the workspace', async () => {
    // Stand up a tiny server serving the file bytes.
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response('staged-content'),
    });
    try {
      const result = await stageFiles([
        { path: 'sub/dir/out.txt', url: `http://127.0.0.1:${server.port}/x` },
        { path: '../evil', url: `http://127.0.0.1:${server.port}/x` },
      ]);
      expect(result.staged).toEqual([{ path: 'sub/dir/out.txt', bytes: 14 }]);
      expect(result.skipped[0]).toMatchObject({
        path: '../evil',
        reason: 'unsafe_path',
      });
      expect(
        (await readWorkspaceFile('sub/dir/out.txt', 1_000))?.toString(),
      ).toBe('staged-content');
    } finally {
      await server.stop(true);
    }
  });
});
