// The staged-files manifest across runnerd restarts: each "restart" is a fresh
// instance of file-ops.ts (a new module, empty memory) over the same
// workspace, as after an idle stop. A file's stat is only trusted once its
// ctime has settled, so the clock is moved past that settling time instead
// of waiting it out.
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  setSystemTime,
  spyOn,
  test,
} from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type FileOps = typeof import('./file-ops.ts');

const ROOT = realpathSync(mkdtempSync(`${tmpdir()}/runnerd-manifest-`));
const MANIFEST = join(ROOT, '.runtime/staged-sources.json');
let fetched = 0;
const server = Bun.serve({
  port: 0,
  fetch() {
    fetched += 1;
    return new Response('trusted');
  },
});
const URL_ = `http://127.0.0.1:${server.port}/blob`;

let restarts = 0;
function isFileOps(module: unknown): module is FileOps {
  return (
    typeof module === 'object' &&
    module !== null &&
    'stageFiles' in module &&
    typeof module.stageFiles === 'function'
  );
}

/** A runnerd started afresh over the same workspace. */
async function restart(): Promise<FileOps> {
  restarts += 1;
  const module: unknown = await import(`./file-ops.ts?restart=${restarts}`);
  if (!isFileOps(module)) throw new Error('file-ops did not load');
  return module;
}

/** The entries of the manifest on disk. */
function manifestEntries(): unknown[] {
  const manifest: unknown = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  return manifest !== null &&
    typeof manifest === 'object' &&
    'entries' in manifest &&
    Array.isArray(manifest.entries)
    ? manifest.entries
    : [];
}

/** Counts the times a file under the workspace is read through, as hashing
 * it does. */
function countReads(): { reads: () => number; restore: () => void } {
  let reads = 0;
  const originalOpen = fsPromises.open;
  const opening = spyOn(fsPromises, 'open').mockImplementation(
    async (...args) => {
      const file = await originalOpen(...args);
      if (String(args[0]).includes('inputs')) {
        const stream = file.createReadStream.bind(file);
        file.createReadStream = (...options) => {
          reads += 1;
          return stream(...options);
        };
      }
      return file;
    },
  );
  return { reads: () => reads, restore: () => opening.mockRestore() };
}

beforeAll(() => {
  process.env.TALE_WORKSPACE_ROOT = ROOT;
  process.env.TALE_RUNNERD_TOKEN = 'manifest-test-token';
});
afterEach(() => {
  setSystemTime();
});
afterAll(async () => {
  delete process.env.TALE_WORKSPACE_ROOT;
  delete process.env.TALE_RUNNERD_TOKEN;
  await server.stop(true);
  rmSync(ROOT, { recursive: true, force: true });
});

describe('staged files across runnerd restarts', () => {
  test('a restarted runnerd reuses a verified file without fetching or reading it', async () => {
    const path = 'inputs/task-1/a.txt';
    const first = await restart();
    fetched = 0;
    await first.stageFiles([{ path, url: URL_, sourceId: 'blob:a' }]);
    expect(fetched).toBe(1);
    // The next turn verifies it by hash once its ctime has settled; that
    // verification is what the manifest keeps.
    setSystemTime(new Date(Date.now() + 10_000));
    expect(
      (await first.stageFiles([{ path, sourceId: 'blob:a' }])).staged,
    ).toEqual([{ path, bytes: 7 }]);
    expect(readFileSync(MANIFEST, 'utf8')).toContain('"inputs/task-1/a.txt"');

    const second = await restart();
    const counted = countReads();
    try {
      expect(
        await second.stageFiles([{ path, url: URL_, sourceId: 'blob:a' }]),
      ).toEqual({ staged: [{ path, bytes: 7 }], skipped: [] });
      expect(fetched).toBe(1);
      expect(counted.reads()).toBe(0);
    } finally {
      counted.restore();
    }
  });

  test('a file changed since its hash was verified is hashed again and repaired', async () => {
    const path = 'inputs/task-2/b.txt';
    const first = await restart();
    fetched = 0;
    await first.stageFiles([{ path, url: URL_, sourceId: 'blob:b' }]);
    setSystemTime(new Date(Date.now() + 10_000));
    await first.stageFiles([{ path, sourceId: 'blob:b' }]);
    // Same size, other bytes: only the stat (ctime, mtime) tells.
    writeFileSync(join(ROOT, path), 'changed');

    const second = await restart();
    expect(
      (await second.stageFiles([{ path, sourceId: 'blob:b' }])).skipped,
    ).toEqual([{ path, reason: 'no_source' }]);
    await second.stageFiles([{ path, url: URL_, sourceId: 'blob:b' }]);
    expect(fetched).toBe(2);
    expect(readFileSync(join(ROOT, path), 'utf8')).toBe('trusted');
  });

  test('a file written a moment ago is not trusted by its stat', async () => {
    const path = 'inputs/task-3/c.txt';
    const first = await restart();
    await first.stageFiles([{ path, url: URL_, sourceId: 'blob:c' }]);
    await first.stageFiles([{ path, sourceId: 'blob:c' }]);
    const entry = manifestEntries().find(
      (candidate) => Array.isArray(candidate) && candidate[0] === path,
    );
    // Source and digest, but no stat to trust yet.
    expect(entry).toHaveLength(3);

    const second = await restart();
    const counted = countReads();
    try {
      expect(
        (await second.stageFiles([{ path, sourceId: 'blob:c' }])).staged,
      ).toEqual([{ path, bytes: 7 }]);
      expect(counted.reads()).toBeGreaterThan(0);
    } finally {
      counted.restore();
    }
  });

  test('a manifest that does not verify is ignored, and staging fetches as before', async () => {
    const path = 'inputs/task-4/d.txt';
    const first = await restart();
    fetched = 0;
    await first.stageFiles([{ path, url: URL_, sourceId: 'blob:d' }]);
    setSystemTime(new Date(Date.now() + 10_000));
    await first.stageFiles([{ path, sourceId: 'blob:d' }]);
    const text = readFileSync(MANIFEST, 'utf8');
    writeFileSync(MANIFEST, text.replace('blob:d', 'blob:e'));

    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const second = await restart();
      expect(
        (await second.stageFiles([{ path, sourceId: 'blob:e' }])).skipped,
      ).toEqual([{ path, reason: 'no_source' }]);
      expect(
        warn.mock.calls.some((call) =>
          String(call[0]).includes('does not verify'),
        ),
      ).toBe(true);
      // The file itself is still staged afresh, the old way.
      await second.stageFiles([{ path, url: URL_, sourceId: 'blob:d' }]);
      expect(readFileSync(join(ROOT, path), 'utf8')).toBe('trusted');
    } finally {
      warn.mockRestore();
    }
  });
});
