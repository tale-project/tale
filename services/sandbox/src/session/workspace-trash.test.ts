// The workspace trash on its own: one pass at a time, a removal that fails
// stays for the next pass, and a name with nothing under it is nothing to do.
// What a destroy does with the trash, and the start emptying it, are
// docker-session-backend.test.ts's.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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

  test('one trash per session root, so every destroy and sweep shares its pass', () => {
    expect(workspaceTrash(root)).toBe(workspaceTrash(root));
    expect(workspaceTrash(join(root, 'other'))).not.toBe(workspaceTrash(root));
    expect(workspaceTrash(root).dir).toBe(join(root, '.trash'));
  });
});
