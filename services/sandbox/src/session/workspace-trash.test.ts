// The workspace trash on its own: one pass at a time, a removal that fails
// stays for the next pass, a name with nothing under it is nothing to do, and
// how far one name's deletion has come — never `done` while its bytes are
// still on disk. What a destroy does with the trash, and the start emptying
// it, are docker-session-backend.test.ts's.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { WorkspaceTrash, workspaceTrash } from './workspace-trash.ts';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tale-trash-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('still not so after 4 s');
    await Bun.sleep(5);
  }
}

describe('WorkspaceTrash', () => {
  test('one pass at a time: what is discarded while a pass runs goes after it, in the same pass', async () => {
    const gate = Promise.withResolvers<void>();
    const started: string[] = [];
    const trash = new WorkspaceTrash(root, async (path) => {
      started.push(basename(path).split('.')[0] ?? '');
      if (started.length === 1) await gate.promise;
      await rm(path, { recursive: true, force: true });
    });
    await mkdir(join(root, 'ses-first'));
    await mkdir(join(root, 'ses-second'));

    await trash.discard(join(root, 'ses-first'));
    await waitFor(() => started.length === 1);
    await trash.discard(join(root, 'ses-second'));
    // No second deletion beside the one under way: a burst of destroys must
    // not flood the disk under the sessions still running.
    await Bun.sleep(50);
    expect(started).toEqual(['ses-first']);

    gate.resolve();
    // A call while the pass runs shares it, and it ends only once the trash
    // read empty again.
    await trash.empty();
    expect(started).toEqual(['ses-first', 'ses-second']);
    expect(await readdir(trash.dir)).toEqual([]);
  });

  test('an entry that cannot be removed stays for the next pass', async () => {
    let failures = 1;
    const trash = new WorkspaceTrash(root, async (path) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('EIO: i/o error, rmdir');
      }
      await rm(path, { recursive: true, force: true });
    });
    // Left behind by a deletion a restart cut short.
    await mkdir(join(trash.dir, 'ses-stuck.1'), { recursive: true });
    await writeFile(join(trash.dir, 'ses-stuck.1', 'data.txt'), 'user data');

    await trash.empty();
    expect(await readdir(trash.dir)).toEqual(['ses-stuck.1']);
    // The next pass — a later destroy's, the periodic sweep's or the next
    // start's — takes it.
    await trash.empty();
    expect(await readdir(trash.dir)).toEqual([]);
  });

  test('a name with nothing under it is nothing to do', async () => {
    const removed: string[] = [];
    const trash = new WorkspaceTrash(root, async (path) => {
      removed.push(path);
    });
    await trash.discard(join(root, 'ses-never-made'));
    await trash.empty();
    expect(removed).toEqual([]);
    expect(await readdir(trash.dir)).toEqual([]);
  });

  test('a deletion is done only once its bytes are gone, never while they wait or are being deleted', async () => {
    const gate = Promise.withResolvers<void>();
    const trash = new WorkspaceTrash(root, async (path) => {
      await gate.promise;
      await rm(path, { recursive: true, force: true });
    });
    const workspace = join(root, 'ses-held');
    await mkdir(workspace);
    await writeFile(join(workspace, 'data.txt'), 'user data');

    expect(await trash.deletion(workspace)).toBe('done');
    await trash.discard(workspace);
    // Out of use at once, and still on disk.
    expect(await trash.deletion(workspace)).toBe('pending');
    const [entry = ''] = await readdir(trash.dir);
    expect(await readFile(join(trash.dir, entry, 'data.txt'), 'utf8')).toBe(
      'user data',
    );
    // A bounded wait answers on time instead of waiting for the bytes.
    const startedAtMs = Date.now();
    expect(await trash.settle(workspace, 100)).toBe('pending');
    expect(Date.now() - startedAtMs).toBeLessThan(2_000);

    gate.resolve();
    expect(await trash.settle(workspace, 4_000)).toBe('done');
    expect(await readdir(trash.dir)).toEqual([]);
  });

  test('a removal that keeps failing reads failed, and each settle has it tried again', async () => {
    let failing = true;
    let attempts = 0;
    const trash = new WorkspaceTrash(root, async (path) => {
      attempts += 1;
      if (failing) throw new Error('EIO: i/o error, rmdir');
      await rm(path, { recursive: true, force: true });
    });
    const workspace = join(root, 'ses-stuck');
    await mkdir(workspace);
    await writeFile(join(workspace, 'data.txt'), 'user data');

    await trash.discard(workspace);
    await trash.empty();
    expect(await trash.deletion(workspace)).toBe('failed');
    const before = attempts;
    expect(await trash.settle(workspace, 4_000)).toBe('failed');
    expect(attempts).toBeGreaterThan(before);
    const [entry = ''] = await readdir(trash.dir);
    expect(await readFile(join(trash.dir, entry, 'data.txt'), 'utf8')).toBe(
      'user data',
    );

    // The disk recovers: the next settle — a retried erasure's — deletes it.
    failing = false;
    expect(await trash.settle(workspace, 4_000)).toBe('done');
    expect(await readdir(trash.dir)).toEqual([]);
  });

  test('after a restart, what a deletion left on disk reads pending until a pass removes it', async () => {
    const before = new WorkspaceTrash(root, async () => {
      throw new Error('EIO: i/o error, rmdir');
    });
    const workspace = join(root, 'ses-restarted');
    await mkdir(workspace);
    await writeFile(join(workspace, 'data.txt'), 'user data');
    await before.discard(workspace);
    await before.empty();
    expect(await before.deletion(workspace)).toBe('failed');

    // A new process: no memory of the failure, and no claim of `done` either.
    const after = new WorkspaceTrash(root);
    expect(await after.deletion(workspace)).toBe('pending');
    // The boot sweep's pass.
    await after.empty();
    expect(await after.deletion(workspace)).toBe('done');
  });

  test("a fresh workspace under the same name never counts toward the old one's deletion", async () => {
    const gate = Promise.withResolvers<void>();
    const trash = new WorkspaceTrash(root, async (path) => {
      await gate.promise;
      if (basename(path).startsWith('ses-same2.')) {
        throw new Error('EIO: i/o error, rmdir');
      }
      await rm(path, { recursive: true, force: true });
    });
    const workspace = join(root, 'ses-same');
    await mkdir(workspace);
    await writeFile(join(workspace, 'old.txt'), 'the destroyed session');
    await trash.discard(workspace);
    // The next session under the id lays out a fresh workspace, and a
    // neighbour's name that only starts the same is another workspace.
    await mkdir(workspace);
    await writeFile(join(workspace, 'fresh.txt'), 'the new session');
    await mkdir(join(trash.dir, 'ses-same2.1'));
    expect(await trash.deletion(workspace)).toBe('pending');

    gate.resolve();
    // The neighbour's stuck deletion holds nobody else's.
    expect(await trash.settle(workspace, 4_000)).toBe('done');
    expect(await readdir(workspace)).toEqual(['fresh.txt']);
    await trash.empty();
    expect(await trash.deletion(join(root, 'ses-same2'))).toBe('failed');
    expect(await trash.deletion(workspace)).toBe('done');
  });

  test('one trash per session root, so every destroy and sweep shares its pass', () => {
    expect(workspaceTrash(root)).toBe(workspaceTrash(root));
    expect(workspaceTrash(join(root, 'other'))).not.toBe(workspaceTrash(root));
    expect(workspaceTrash(root).dir).toBe(join(root, '.trash'));
  });
});

describe('moving a tree in without deleting it in place', () => {
  test('a tree goes in under its name for the pass to delete, and counts toward that name', async () => {
    const gate = Promise.withResolvers<void>();
    const trash = new WorkspaceTrash(root, async (path) => {
      await gate.promise;
      await rm(path, { recursive: true, force: true });
    });
    const tmp = join(root, 'ses-a', '.runtime', 'tmp');
    await mkdir(join(tmp, 'pip-staging'), { recursive: true });
    await writeFile(join(tmp, 'pip-staging', 'wheel'), 'bytes');

    expect(await trash.moveIn(tmp, 'ses-a.tmp')).toBe(true);
    expect(await readdir(join(root, 'ses-a', '.runtime'))).toEqual([]);
    const [entry, ...others] = await readdir(trash.dir);
    expect(others).toEqual([]);
    expect(entry).toMatch(/^ses-a\.tmp\.[0-9a-f-]{36}$/);
    // The session's data, so an erasure of the workspace waits for it too.
    expect(await trash.deletion(join(root, 'ses-a'))).toBe('pending');
    gate.resolve();
    await trash.empty();
    expect(await trash.deletion(join(root, 'ses-a'))).toBe('done');
  });

  test('nothing there is nothing to do; a rename that fails leaves the tree and deletes nothing', async () => {
    const removed: string[] = [];
    const trash = new WorkspaceTrash(root, async (path) => {
      removed.push(path);
      await rm(path, { recursive: true, force: true });
    });
    expect(await trash.moveIn(join(root, 'absent'), 'absent.tmp')).toBe(false);
    // A root whose trash dir is a file: no rename into it can land.
    const blocked = join(root, 'blocked');
    await mkdir(blocked);
    await writeFile(join(blocked, '.trash'), '');
    const blockedTrash = new WorkspaceTrash(blocked, async (path) => {
      removed.push(path);
      await rm(path, { recursive: true, force: true });
    });
    const tmp = join(blocked, 'ses-b', '.runtime', 'tmp');
    await mkdir(tmp, { recursive: true });
    await writeFile(join(tmp, 'spool'), 'replay');
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      expect(await blockedTrash.moveIn(tmp, 'ses-b.tmp')).toBe(false);
    } finally {
      console.warn = warn;
    }
    expect(warnings).toHaveLength(1);
    expect(await readFile(join(tmp, 'spool'), 'utf8')).toBe('replay');
    expect(removed).toEqual([]);
  });
});
