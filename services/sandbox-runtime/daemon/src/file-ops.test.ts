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
