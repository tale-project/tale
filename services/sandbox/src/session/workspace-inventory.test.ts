import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  listWorkspaceDirs,
  workspaceSessionId,
} from './workspace-inventory.ts';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tale-inventory-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function ids(dirs: Array<{ sessionId: string }>): string[] {
  return dirs.map((dir) => dir.sessionId).sort();
}

describe('workspaceSessionId', () => {
  test('reads the id a workspace dir carries', () => {
    expect(workspaceSessionId('ses-pa-agent_1')).toBe('pa-agent_1');
  });

  test('refuses names no create could have made', () => {
    expect(workspaceSessionId('ses-')).toBeNull();
    expect(workspaceSessionId('ses-has space')).toBeNull();
    expect(workspaceSessionId(`ses-${'a'.repeat(65)}`)).toBeNull();
    expect(workspaceSessionId('blue')).toBeNull();
  });
});

describe('listWorkspaceDirs', () => {
  test('lists flat and legacy colour-rooted workspaces, nothing else', async () => {
    await mkdir(join(root, 'ses-flat'));
    await mkdir(join(root, 'blue', 'ses-legacy'), { recursive: true });
    await mkdir(join(root, 'blue', 'one-shot-exec'));
    await mkdir(join(root, '.pins'));
    await mkdir(join(root, '.pins', 'ses-not-a-workspace'));
    await mkdir(join(root, 'with space'));
    await mkdir(join(root, 'with space', 'ses-hidden'));
    await writeFile(join(root, 'ses-file'), 'not a dir');
    await writeFile(join(root, '.spawner.lock'), '{}');

    expect(ids(await listWorkspaceDirs(root))).toEqual(['flat', 'legacy']);
  });

  test('reports the newest change of the workspace dir itself', async () => {
    const dir = join(root, 'ses-dated');
    await mkdir(dir);
    const old = new Date('2020-01-01T00:00:00Z');
    await utimes(dir, old, old);
    const [entry] = await listWorkspaceDirs(root);
    // ctime cannot be set back, so the entry is at least as new as the
    // utimes call — which is exactly what a resume's chown relies on.
    expect(entry?.touchedAtMs).toBeGreaterThan(old.getTime());
  });

  test('a session with data in both layouts is reported once', async () => {
    await mkdir(join(root, 'ses-twice'));
    await mkdir(join(root, 'green', 'ses-twice'), { recursive: true });
    const found = await listWorkspaceDirs(root);
    expect(ids(found)).toEqual(['twice']);
  });

  test('a missing root is an empty inventory', async () => {
    expect(await listWorkspaceDirs(join(root, 'absent'))).toEqual([]);
  });

  test('an unreadable root fails the inventory instead of reading empty', async () => {
    const file = join(root, 'not-a-dir');
    await writeFile(file, '');
    let failure: unknown = null;
    try {
      await listWorkspaceDirs(file);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
  });
});
