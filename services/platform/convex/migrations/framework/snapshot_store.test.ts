// @vitest-environment node

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreFsTree, snapshotFsTree } from './snapshot_store';

const MIGRATION_ID = '9.9.9/01_x';
// `/` and `.` flattened to `_` — one path segment for the whole id.
const SAFE_SEGMENT = '9_9_9_01_x';
const ORG = 'org1';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tale-mig-snapstore-'));
  vi.stubEnv('TALE_CONFIG_DIR', root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

function orgDir(): string {
  return path.join(root, ORG, 'branding');
}

describe('snapshotFsTree / restoreFsTree', () => {
  it('round-trips a nested tree byte-for-byte and drops files added after the snapshot', async () => {
    const dir = orgDir();
    await mkdir(path.join(dir, 'nested'), { recursive: true });
    await writeFile(path.join(dir, 'a.json'), '{"a":1}');
    await writeFile(path.join(dir, 'nested', 'b.txt'), 'bee');

    const ref = await snapshotFsTree(MIGRATION_ID, ORG, dir);
    expect(ref).toBe(
      path.join(root, '.migration-snapshots', SAFE_SEGMENT, ORG),
    );

    // Mutate the live tree: overwrite, delete a nested file, add an extra.
    await writeFile(path.join(dir, 'a.json'), '{"a":2}');
    await rm(path.join(dir, 'nested'), { recursive: true });
    await writeFile(path.join(dir, 'c.txt'), 'post-snapshot noise');

    await restoreFsTree(MIGRATION_ID, ORG, dir);

    expect(await readFile(path.join(dir, 'a.json'), 'utf-8')).toBe('{"a":1}');
    expect(await readFile(path.join(dir, 'nested', 'b.txt'), 'utf-8')).toBe(
      'bee',
    );
    // The restore replaces the tree wholesale: post-snapshot files are gone.
    await expect(stat(path.join(dir, 'c.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('captures an empty snapshot for a missing source dir and the ref still resolves', async () => {
    const missing = path.join(root, ORG, 'never-created');
    const ref = await snapshotFsTree(MIGRATION_ID, ORG, missing);
    const info = await stat(ref);
    expect(info.isDirectory()).toBe(true);
    expect(await readdir(ref)).toEqual([]);
  });

  it('warns and leaves the target intact when the snapshot ref was never captured', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const dir = orgDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'live.json'), '{"live":true}');

    await restoreFsTree('9.9.9/99_never_captured', ORG, dir);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('snapshot ref not found'),
    );
    expect(await readFile(path.join(dir, 'live.json'), 'utf-8')).toBe(
      '{"live":true}',
    );
  });

  it('replaces the prior snapshot content on re-snapshot', async () => {
    const dir = orgDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'old.txt'), 'v1');
    const ref = await snapshotFsTree(MIGRATION_ID, ORG, dir);
    expect(await readFile(path.join(ref, 'old.txt'), 'utf-8')).toBe('v1');

    await rm(path.join(dir, 'old.txt'));
    await writeFile(path.join(dir, 'new.txt'), 'v2');
    const ref2 = await snapshotFsTree(MIGRATION_ID, ORG, dir);

    expect(ref2).toBe(ref);
    expect(await readFile(path.join(ref, 'new.txt'), 'utf-8')).toBe('v2');
    // The stale v1 file did not survive into the fresh snapshot.
    await expect(stat(path.join(ref, 'old.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects an invalid org slug', async () => {
    const dir = orgDir();
    await expect(
      snapshotFsTree(MIGRATION_ID, 'Bad Slug!', dir),
    ).rejects.toThrow(/Invalid org slug/);
    await expect(restoreFsTree(MIGRATION_ID, '../escape', dir)).rejects.toThrow(
      /Invalid org slug/,
    );
  });

  it('flattens the migration id into a single sidecar path segment', async () => {
    const ref = await snapshotFsTree(MIGRATION_ID, ORG, orgDir());
    const segments = path.relative(root, ref).split(path.sep);
    expect(segments).toEqual(['.migration-snapshots', SAFE_SEGMENT, ORG]);
  });
});
