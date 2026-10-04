import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  constants,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  mkdirSync,
  openSync,
  statSync,
} from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  listDir,
  readWorkspaceFile,
  stageFiles,
  streamWorkspaceFile,
} from './file-ops.ts';

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
  test('stageFiles shares one deadline across the batch and never starts later downloads after it expires', async () => {
    const stalled = Bun.serve({
      port: 0,
      fetch: () => new Promise<Response>(() => {}), // never answers
    });
    let laterRequests = 0;
    const live = Bun.serve({
      port: 0,
      fetch: () => {
        laterRequests += 1;
        return new Response('after-the-stall');
      },
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
        { path: 'later.txt', reason: 'timeout' },
      ]);
      expect(result.staged).toEqual([]);
      expect(laterRequests).toBe(0);
    } finally {
      await stalled.stop(true);
      await live.stop(true);
    }
  });

  test('one batch deadline stops later files and leaves the staging slot reusable', async () => {
    let requests = 0;
    const stalled = Bun.serve({
      port: 0,
      fetch: () => {
        requests += 1;
        return new Promise<Response>(() => {});
      },
    });
    try {
      const result = await stageFiles(
        [
          { path: 'batch-first', url: stalled.url.href },
          { path: 'batch-second', url: stalled.url.href },
          { path: 'batch-inline', contentBase64: 'YQ==' },
        ],
        { fetchTimeoutMs: 50 },
      );
      expect(requests).toBe(1);
      expect(result.staged).toEqual([]);
      expect(result.skipped).toEqual([
        { path: 'batch-first', reason: 'timeout' },
        { path: 'batch-second', reason: 'timeout' },
        { path: 'batch-inline', reason: 'timeout' },
      ]);
      expect(
        (await stageFiles([{ path: 'batch-recovered', contentBase64: 'YQ==' }]))
          .staged,
      ).toEqual([{ path: 'batch-recovered', bytes: 1 }]);
    } finally {
      await stalled.stop(true);
    }
  });

  test('a cached destination replaced by a FIFO cannot block source verification or its deadline', async () => {
    const path = 'cached-fifo';
    const sourceId = 'cached-fifo-source';
    await stageFiles([{ path, sourceId, contentBase64: 'YQ==' }]);
    rmSync(join(ROOT, path));
    expect(spawnSync('mkfifo', [join(ROOT, path)]).status).toBe(0);
    const pending = stageFiles([{ path, sourceId }], { fetchTimeoutMs: 50 });
    try {
      const result = await Promise.race([
        pending,
        Bun.sleep(300).then(() => 'blocked'),
      ]);
      expect(result).toEqual({
        staged: [],
        skipped: [{ path, reason: 'no_source' }],
      });
    } finally {
      // Release the baseline's blocking open even when the regression fails.
      const release = openSync(
        join(ROOT, path),
        constants.O_RDWR | constants.O_NONBLOCK,
      );
      await pending;
      closeSync(release);
      rmSync(join(ROOT, path));
    }
  });

  test('streamed reads reject a FIFO without waiting for a writer', async () => {
    const path = join(ROOT, 'stream-fifo');
    expect(spawnSync('mkfifo', [path]).status).toBe(0);
    const pending = streamWorkspaceFile('stream-fifo', 1024);
    try {
      expect(
        await Promise.race([pending, Bun.sleep(300).then(() => 'blocked')]),
      ).toBeNull();
    } finally {
      const release = openSync(path, constants.O_RDWR | constants.O_NONBLOCK);
      await pending;
      closeSync(release);
      rmSync(path);
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

describe('bounded atomic staging', () => {
  test('atomic replacement preserves executable permissions and new files stay private', async () => {
    const path = join(ROOT, 'executable.sh');
    writeFileSync(path, 'old');
    chmodSync(path, 0o750);
    const result = await stageFiles([
      { path: 'executable.sh', contentBase64: 'bmV3' },
      { path: 'new-mode.txt', contentBase64: 'bmV3' },
    ]);
    expect(result.skipped).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe('new');
    expect(statSync(path).mode & 0o777).toBe(0o750);
    expect(statSync(join(ROOT, 'new-mode.txt')).mode & 0o777).toBe(0o600);
  });

  test('a streamed transfer preserves the old destination until complete and cancels cleanly', async () => {
    const release = Promise.withResolvers<void>();
    const seen = Promise.withResolvers<void>();
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(32 * 1024).fill(65));
              seen.resolve();
              void release.promise.then(() => {
                try {
                  controller.enqueue(new TextEncoder().encode('END'));
                  controller.close();
                } catch {}
                return undefined;
              });
            },
          }),
        );
      },
    });
    const destination = join(ROOT, 'atomic.txt');
    writeFileSync(destination, 'previous');
    const controller = new AbortController();
    try {
      const transfer = stageFiles(
        [{ path: 'atomic.txt', url: `http://127.0.0.1:${server.port}/file` }],
        { signal: controller.signal },
      );
      await seen.promise;
      expect(readFileSync(destination, 'utf8')).toBe('previous');
      controller.abort();
      expect((await transfer).skipped).toEqual([
        { path: 'atomic.txt', reason: 'cancelled' },
      ]);
      expect(readFileSync(destination, 'utf8')).toBe('previous');
      expect(
        readdirSync(ROOT).some((name) => name.startsWith('.tale-stage-')),
      ).toBe(false);
      release.resolve();
      const complete = await stageFiles([
        { path: 'atomic.txt', url: `http://127.0.0.1:${server.port}/file` },
      ]);
      expect(complete.staged).toEqual([
        { path: 'atomic.txt', bytes: 32 * 1024 + 3 },
      ]);
      expect(readFileSync(destination, 'utf8')).toEndWith('END');
    } finally {
      release.resolve();
      await server.stop(true);
    }
  });

  test('oversized downloads preserve files and release upstream bodies', async () => {
    const cancelled = Promise.withResolvers<void>();
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-length': String(101 * 1024 * 1024) });
      res.flushHeaders();
      res.write(Buffer.alloc(64 * 1024));
      res.once('close', () => cancelled.resolve());
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('missing port');
    writeFileSync(join(ROOT, 'too-large.txt'), 'previous');
    try {
      const result = await stageFiles(
        [
          {
            path: 'too-large.txt',
            url: `http://127.0.0.1:${address.port}/file`,
          },
        ],
        { fetchTimeoutMs: 2_000 },
      );
      expect(result.skipped).toEqual([
        { path: 'too-large.txt', reason: 'too_large' },
      ]);
      expect(readFileSync(join(ROOT, 'too-large.txt'), 'utf8')).toBe(
        'previous',
      );
      await Promise.race([
        cancelled.promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('upstream not cancelled')), 1_000),
        ),
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('chunked bodies cannot bypass the byte limit without content-length', async () => {
    const chunk = Buffer.alloc(64 * 1024);
    const server = createServer((_req, res) => {
      let sent = 0;
      const pump = () => {
        while (!res.destroyed && sent < 101 * 1024 * 1024) {
          sent += chunk.length;
          if (!res.write(chunk)) return;
        }
        if (!res.destroyed) res.end();
      };
      res.on('drain', pump);
      pump();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('missing port');
    writeFileSync(join(ROOT, 'chunked-too-large.txt'), 'previous');
    try {
      const result = await stageFiles([
        {
          path: 'chunked-too-large.txt',
          url: `http://127.0.0.1:${address.port}/file`,
        },
      ]);
      expect(result.skipped).toEqual([
        { path: 'chunked-too-large.txt', reason: 'too_large' },
      ]);
      expect(readFileSync(join(ROOT, 'chunked-too-large.txt'), 'utf8')).toBe(
        'previous',
      );
      expect(
        readdirSync(ROOT).some((name) => name.startsWith('.tale-stage-')),
      ).toBe(false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15_000);

  test('concurrent staging has an aggregate ceiling and a cancelled slot is reusable', async () => {
    let requested = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        requested++;
        return new Promise<Response>(() => {});
      },
    });
    const controllers = [new AbortController(), new AbortController()];
    try {
      const transfers = controllers.map((controller, index) =>
        stageFiles(
          [
            {
              path: `parallel-${index}`,
              url: `http://127.0.0.1:${server.port}/file`,
            },
          ],
          { signal: controller.signal },
        ),
      );
      const deadline = Date.now() + 2000;
      const ready = () => requested === 2;
      while (Date.now() < deadline && !ready())
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(requested).toBe(2);
      expect(
        (
          await stageFiles([
            { path: 'parallel-refused', contentBase64: 'YQ==' },
          ])
        ).skipped,
      ).toEqual([{ path: 'parallel-refused', reason: 'busy' }]);
      controllers.forEach((controller) => controller.abort());
      await Promise.all(transfers);
      expect(
        (await stageFiles([{ path: 'parallel-after', contentBase64: 'YQ==' }]))
          .staged,
      ).toEqual([{ path: 'parallel-after', bytes: 1 }]);
    } finally {
      controllers.forEach((controller) => controller.abort());
      await server.stop(true);
    }
  });

  test('parent symlinks cannot stage or reconcile outside the workspace', async () => {
    const outside = realpathSync(mkdtempSync(`${tmpdir()}/runnerd-outside-`));
    try {
      writeFileSync(join(outside, 'keep.txt'), 'outside');
      symlinkSync(outside, join(ROOT, 'outside-link'));
      const result = await stageFiles([
        { path: 'outside-link/keep.txt', contentBase64: 'YQ==' },
      ]);
      expect(result.skipped).toEqual([
        { path: 'outside-link/keep.txt', reason: 'unsafe_path' },
      ]);
      const reconciled = await stageFiles([], {
        replaceRoots: ['outside-link'],
        keepPaths: [],
      });
      expect(reconciled.reconciled).toBeUndefined();
      expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('outside');
    } finally {
      rmSync(join(ROOT, 'outside-link'), { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('immutable source reuse rehashes the actual file and repairs tampering', async () => {
    let fetched = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        fetched++;
        return new Response('trusted');
      },
    });
    const source = {
      path: 'source.txt',
      url: `http://127.0.0.1:${server.port}/file`,
      sourceId: 'blob:immutable',
    };
    try {
      await stageFiles([source]);
      expect(
        (await stageFiles([{ path: source.path, sourceId: source.sourceId }]))
          .staged,
      ).toEqual([{ path: 'source.txt', bytes: 7 }]);
      expect(fetched).toBe(1);
      writeFileSync(join(ROOT, 'source.txt'), 'changed');
      expect(
        (await stageFiles([{ path: source.path, sourceId: source.sourceId }]))
          .skipped,
      ).toEqual([{ path: 'source.txt', reason: 'no_source' }]);
      await stageFiles([source]);
      expect(fetched).toBe(2);
      expect(readFileSync(join(ROOT, 'source.txt'), 'utf8')).toBe('trusted');
    } finally {
      await server.stop(true);
    }
  });

  test('a cache probe rejects an old descriptor after its ancestor is replaced', async () => {
    const parent = join(ROOT, 'source-replaced-parent');
    const parked = `${parent}-old`;
    const path = 'source-replaced-parent/source-leaf.txt';
    await stageFiles([
      { path, contentBase64: 'dHJ1c3RlZA==', sourceId: 'source-replaced' },
    ]);
    const originalOpen = fsPromises.open;
    let swapped = false;
    const opening = spyOn(fsPromises, 'open').mockImplementation(
      async (...args) => {
        const file = await originalOpen(...args);
        if (String(args[0]).endsWith('/source-leaf.txt') && !swapped) {
          swapped = true;
          renameSync(parent, parked);
          mkdirSync(parent);
          writeFileSync(join(ROOT, path), 'changed');
        }
        return file;
      },
    );
    try {
      expect(await stageFiles([{ path, sourceId: 'source-replaced' }])).toEqual(
        {
          staged: [],
          skipped: [{ path, reason: 'no_source' }],
        },
      );
      expect(swapped).toBe(true);
    } finally {
      opening.mockRestore();
    }
  });

  test('cache probes and streamed reads reject named pipes without blocking a worker', async () => {
    const path = 'cached-fifo';
    const absolute = join(ROOT, path);
    await stageFiles([
      { path, contentBase64: 'dHJ1c3RlZA==', sourceId: 'source-fifo' },
    ]);
    rmSync(absolute);
    expect(spawnSync('mkfifo', [absolute]).status).toBe(0);
    let rescue: number | undefined;
    // Ensure a regression does not strand a filesystem worker or the suite.
    const timer = setTimeout(() => {
      rescue = openSync(absolute, constants.O_RDWR | constants.O_NONBLOCK);
    }, 500);
    try {
      const [probe, read] = await Promise.all([
        stageFiles([{ path, sourceId: 'source-fifo' }]),
        streamWorkspaceFile(path, 1000),
      ]);
      expect(read).toBeNull();
      expect(probe).toEqual({
        staged: [],
        skipped: [{ path, reason: 'no_source' }],
      });
      expect(rescue).toBeUndefined();
    } finally {
      clearTimeout(timer);
      if (rescue !== undefined) closeSync(rescue);
      rmSync(absolute, { force: true });
    }
  });

  test('only a successful explicit final manifest removes stale managed files', async () => {
    mkdirSync(join(ROOT, 'managed'), { recursive: true });
    writeFileSync(join(ROOT, 'managed', 'stale'), 'stale');
    writeFileSync(join(ROOT, 'managed', 'current'), 'current');
    writeFileSync(join(ROOT, 'unrelated'), 'unrelated');
    const failed = await stageFiles([{ path: 'managed/missing' }], {
      replaceRoots: ['managed'],
      keepPaths: ['managed/current'],
    });
    expect(failed.reconciled).toBeUndefined();
    expect(readFileSync(join(ROOT, 'managed', 'stale'), 'utf8')).toBe('stale');
    const final = await stageFiles([], {
      replaceRoots: ['managed'],
      keepPaths: ['managed/current'],
    });
    expect(final.reconciled).toBe(true);
    expect(readdirSync(join(ROOT, 'managed'))).toEqual(['current']);
    expect(readFileSync(join(ROOT, 'unrelated'), 'utf8')).toBe('unrelated');
    expect(
      (await stageFiles([], { replaceRoots: ['.'], keepPaths: [] })).reconciled,
    ).toBeUndefined();
  });

  test.skipIf(process.platform !== 'linux')(
    'streamed reads keep the opened parent when its pathname becomes an outside symlink',
    async () => {
      const parent = join(ROOT, 'read-parent');
      const parked = join(ROOT, 'read-parent-parked');
      const outside = realpathSync(
        mkdtempSync(`${tmpdir()}/runnerd-read-outside-`),
      );
      mkdirSync(parent);
      writeFileSync(join(parent, 'anchored-leaf.txt'), 'inside');
      writeFileSync(join(outside, 'anchored-leaf.txt'), 'outside');
      const originalOpen = fsPromises.open;
      let swapped = false;
      // Swap at the exact final-file open boundary, after any containment check
      // and ancestor traversal. Both trees are this test's temporary fixtures.
      const open = spyOn(fsPromises, 'open').mockImplementation(
        async (...args) => {
          if (String(args[0]).endsWith('/anchored-leaf.txt') && !swapped) {
            renameSync(parent, parked);
            symlinkSync(outside, parent);
            swapped = true;
          }
          return originalOpen(...args);
        },
      );
      try {
        const stream = await streamWorkspaceFile(
          'read-parent/anchored-leaf.txt',
          100,
        );
        let text = '';
        if (stream) for await (const chunk of stream) text += chunk.toString();
        expect(swapped).toBe(true);
        expect(text).toBe('inside');
      } finally {
        open.mockRestore();
        rmSync(parent, { force: true });
        rmSync(parked, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  test('a streamed read never creates missing ancestor directories', async () => {
    expect(
      await streamWorkspaceFile('not-created/missing.txt', 100),
    ).toBeNull();
    expect(readdirSync(ROOT)).not.toContain('not-created');
  });

  test('streamed reads retain their opened file range and reject oversize', async () => {
    writeFileSync(join(ROOT, 'range.txt'), 'original');
    const stream = await streamWorkspaceFile('range.txt', 8);
    expect(stream).not.toBeNull();
    writeFileSync(join(ROOT, 'range.txt'), 'original-appended');
    let text = '';
    if (stream) for await (const chunk of stream) text += chunk.toString();
    expect(text).toBe('original');
    expect(await streamWorkspaceFile('range.txt', 8)).toBeNull();
  });
});
