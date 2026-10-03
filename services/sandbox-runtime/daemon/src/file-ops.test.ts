import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  symlinkSync,
} from 'node:fs';
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
    const release = Promise.withResolvers<Response>();
    const stalled = Bun.serve({
      port: 0,
      fetch: () => release.promise, // stalls until teardown, without a leaked handler
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
      release.resolve(new Response('released'));
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

describe('atomic bounded staging', () => {
  test('failed and cancelled uploads preserve the previous destination and remove temporary files', async () => {
    const target = join(ROOT, 'atomic.txt');
    writeFileSync(target, 'previous');
    const release = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const source = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(new TextEncoder().encode('partial'));
              entered.resolve();
              await release.promise;
              try {
                controller.close();
              } catch {
                /* cancelled */
              }
            },
          }),
        ),
    });
    const caller = new AbortController();
    try {
      const staged = stageFiles(
        [{ path: 'atomic.txt', url: `http://127.0.0.1:${source.port}` }],
        { signal: caller.signal },
      );
      await entered.promise;
      caller.abort();
      expect((await staged).skipped).toEqual([
        { path: 'atomic.txt', reason: 'cancelled' },
      ]);
      expect(readFileSync(target, 'utf8')).toBe('previous');
      expect(
        readdirSync(ROOT).filter((name) => name.startsWith('.tale-stage-')),
      ).toEqual([]);
    } finally {
      release.resolve();
      await source.stop(true);
    }
  });

  test('the batch deadline stops queued URLs instead of granting each a fresh full budget', async () => {
    const release = Promise.withResolvers<Response>();
    let calls = 0;
    const source = Bun.serve({
      port: 0,
      fetch: () => {
        calls++;
        return release.promise;
      },
    });
    try {
      const result = await stageFiles(
        [
          { path: 'batch-a', url: `http://127.0.0.1:${source.port}` },
          { path: 'batch-b', url: `http://127.0.0.1:${source.port}` },
          { path: 'batch-c', url: `http://127.0.0.1:${source.port}` },
        ],
        { batchTimeoutMs: 50 },
      );
      expect(calls).toBe(2);
      expect(result.skipped.map((item) => item.reason)).toEqual([
        'timeout',
        'timeout',
        'timeout',
      ]);
    } finally {
      release.resolve(new Response('released'));
      await source.stop(true);
    }
  });

  test('verified immutable sources skip downloads and restore locally modified files', async () => {
    let downloads = 0;
    const source = Bun.serve({
      port: 0,
      fetch: () => {
        downloads++;
        return new Response('immutable');
      },
    });
    const item = {
      path: 'cached.txt',
      url: `http://127.0.0.1:${source.port}`,
      cacheKey: 'org/blob-version',
    };
    try {
      expect((await stageFiles([item])).staged).toHaveLength(1);
      expect((await stageFiles([item])).staged).toHaveLength(1);
      expect(downloads).toBe(1);
      writeFileSync(join(ROOT, 'cached.txt'), 'changed');
      expect((await stageFiles([item])).staged).toHaveLength(1);
      expect(downloads).toBe(2);
      expect(readFileSync(join(ROOT, 'cached.txt'), 'utf8')).toBe('immutable');
    } finally {
      await source.stop(true);
    }
  });

  test('two batches share two transfer slots and duplicate normalized destinations are refused', async () => {
    let active = 0;
    let peak = 0;
    let calls = 0;
    const source = Bun.serve({
      port: 0,
      async fetch() {
        calls++;
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active--;
        return new Response('parallel');
      },
    });
    const item = (path: string) => ({
      path,
      url: `http://127.0.0.1:${source.port}`,
    });
    try {
      const results = await Promise.all([
        stageFiles([item('parallel-a'), item('parallel-b')]),
        stageFiles([
          item('parallel-c'),
          item('./parallel-c'),
          item('parallel-d'),
        ]),
      ]);
      expect(peak).toBe(2);
      expect(calls).toBe(4);
      expect(results[0]?.staged.map((entry) => entry.path)).toEqual([
        'parallel-a',
        'parallel-b',
      ]);
      expect(results[1]?.skipped).toEqual([
        { path: './parallel-c', reason: 'duplicate_path' },
      ]);
    } finally {
      await source.stop(true);
    }
  });

  test('digest mismatch leaves an existing file intact and unsafe parent links are refused', async () => {
    writeFileSync(join(ROOT, 'digest.txt'), 'old');
    expect(
      (
        await stageFiles([
          {
            path: 'digest.txt',
            contentBase64: Buffer.from('new').toString('base64'),
            sha256: createHash('sha256').update('different').digest('hex'),
          },
        ])
      ).skipped,
    ).toEqual([{ path: 'digest.txt', reason: 'digest_mismatch' }]);
    expect(readFileSync(join(ROOT, 'digest.txt'), 'utf8')).toBe('old');
    symlinkSync(tmpdir(), join(ROOT, 'outside'));
    expect(
      (await stageFiles([{ path: 'outside/nope/file', contentBase64: 'YQ==' }]))
        .skipped,
    ).toEqual([{ path: 'outside/nope/file', reason: 'unsafe_path' }]);
  });
});
