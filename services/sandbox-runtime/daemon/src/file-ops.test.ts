import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
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

describe('atomic bounded staging', () => {
  test('a cancelled download preserves the old target and removes its partial file', async () => {
    const sent = Promise.withResolvers<void>();
    const source = createServer((_req, res) => {
      res.writeHead(200);
      res.write('partial replacement');
      sent.resolve();
    });
    await new Promise<void>((resolve) =>
      source.listen(0, '127.0.0.1', resolve),
    );
    const address = source.address();
    if (address === null || typeof address === 'string')
      throw new Error('no port');
    writeFileSync(join(ROOT, 'atomic.txt'), 'original');
    const controller = new AbortController();
    try {
      const staging = stageFiles(
        [{ path: 'atomic.txt', url: `http://127.0.0.1:${address.port}` }],
        { signal: controller.signal },
      );
      await sent.promise;
      controller.abort();
      expect((await staging).skipped).toEqual([
        { path: 'atomic.txt', reason: 'cancelled' },
      ]);
      expect(await readFile(join(ROOT, 'atomic.txt'), 'utf8')).toBe('original');
      expect(
        (await readdir(ROOT)).filter((name) => name.startsWith('.tale-stage-')),
      ).toEqual([]);
    } finally {
      source.closeAllConnections();
      await new Promise<void>((resolve) => source.close(() => resolve()));
    }
  });

  test('a batch deadline stops later downloads as well as its current item', async () => {
    let requests = 0;
    const source = createServer((_req, _res) => {
      requests += 1;
    });
    await new Promise<void>((resolve) =>
      source.listen(0, '127.0.0.1', resolve),
    );
    const address = source.address();
    if (address === null || typeof address === 'string')
      throw new Error('no port');
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const result = await stageFiles(
        [
          { path: 'slow-a', url },
          { path: 'slow-b', url },
        ],
        { fetchTimeoutMs: 1_000, batchTimeoutMs: 50 },
      );
      expect(result.skipped).toEqual([
        { path: 'slow-a', reason: 'timeout' },
        { path: 'slow-b', reason: 'timeout' },
      ]);
      expect(requests).toBe(1);
    } finally {
      source.closeAllConnections();
      await new Promise<void>((resolve) => source.close(() => resolve()));
    }
  });

  test('streaming oversize rejection preserves the target and releases the upstream', async () => {
    let closed = false;
    const source = createServer((_req, res) => {
      res.on('close', () => {
        closed = true;
      });
      res.writeHead(200);
      res.write('x'.repeat(4096));
    });
    await new Promise<void>((resolve) =>
      source.listen(0, '127.0.0.1', resolve),
    );
    const address = source.address();
    if (address === null || typeof address === 'string')
      throw new Error('no port');
    writeFileSync(join(ROOT, 'oversize.txt'), 'original');
    try {
      const result = await stageFiles(
        [{ path: 'oversize.txt', url: `http://127.0.0.1:${address.port}` }],
        { fetchMaxBytes: 1024 },
      );
      expect(result.skipped).toEqual([
        { path: 'oversize.txt', reason: 'too_large' },
      ]);
      expect(await readFile(join(ROOT, 'oversize.txt'), 'utf8')).toBe(
        'original',
      );
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline) {
        if (closed) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(closed).toBe(true);
    } finally {
      source.closeAllConnections();
      await new Promise<void>((resolve) => source.close(() => resolve()));
    }
  });
  test('rejects an escaping parent symlink and replaces a destination symlink without following it', async () => {
    const outside = realpathSync(
      mkdtempSync(`${tmpdir()}/runnerd-stage-outside-`),
    );
    writeFileSync(join(outside, 'target'), 'outside original');
    symlinkSync(outside, join(ROOT, 'outside-parent'));
    symlinkSync(join(outside, 'target'), join(ROOT, 'destination-link'));
    try {
      const result = await stageFiles([
        { path: 'outside-parent/new-file', contentBase64: 'bmV3' },
        { path: 'destination-link', contentBase64: 'bmV3' },
      ]);
      expect(result.skipped).toEqual([
        { path: 'outside-parent/new-file', reason: 'unsafe_path' },
      ]);
      expect(result.staged).toEqual([{ path: 'destination-link', bytes: 3 }]);
      expect(await readFile(join(outside, 'target'), 'utf8')).toBe(
        'outside original',
      );
      expect(await readdir(outside)).toEqual(['target']);
      expect(await readFile(join(ROOT, 'destination-link'), 'utf8')).toBe(
        'new',
      );
    } finally {
      rmSync(join(ROOT, 'outside-parent'));
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
