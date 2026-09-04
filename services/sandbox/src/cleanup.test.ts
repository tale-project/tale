// Host-dir sweep layout safety. The invariant under test: the sweep removes
// ONLY genuinely expired legacy one-shot exec dirs and NEVER a session
// workspace — in the flat layout (`<root>/ses-<id>`) OR the legacy
// colour-rooted layout (`<root>/<colour>/ses-<id>`) that resolveWorkspaceDir
// still resumes from. A deleted live/stopped workspace is user data loss; an
// un-swept unknown dir is a small leak, so anything the sweep cannot classify
// is left alone.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sweepHostSessionDirs } from './cleanup.ts';

const OLD = new Date('2020-01-01T00:00:00Z');
// Everything older than "now minus one hour" counts as stale.
const threshold = () => Date.now() - 3_600_000;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tale-sweep-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Create a dir (with an optional marker file) under root. */
async function dir(rel: string, withFile = true): Promise<string> {
  const abs = join(root, rel);
  await mkdir(abs, { recursive: true });
  if (withFile) await writeFile(join(abs, 'data.txt'), rel);
  return abs;
}

/** Age paths to 2020. Parents LAST: creating a child bumps the parent mtime. */
async function age(...rels: string[]): Promise<void> {
  for (const rel of rels) await utimes(join(root, rel), OLD, OLD);
}

const exists = (rel: string) =>
  stat(join(root, rel)).then(
    () => true,
    () => false,
  );

describe('sweepHostSessionDirs', () => {
  test('never removes a flat session workspace, however old', async () => {
    await dir('ses-flat');
    await age('ses-flat');

    const removed = await sweepHostSessionDirs(root, threshold());

    expect(removed).toBe(0);
    expect(await exists('ses-flat/data.txt')).toBe(true);
  });

  test('never removes a legacy colour-rooted session workspace or its root', async () => {
    await dir('blue/ses-legacy');
    await age('blue/ses-legacy', 'blue');

    const removed = await sweepHostSessionDirs(root, threshold());

    expect(removed).toBe(0);
    expect(await exists('blue/ses-legacy/data.txt')).toBe(true);
  });

  test('removes stale one-shot dirs in both layouts, keeps the sessions beside them', async () => {
    await dir('stale-exec_1');
    await dir('blue/ses-legacy');
    await dir('blue/oldexec');
    await age('stale-exec_1', 'blue/ses-legacy', 'blue/oldexec', 'blue');

    const removed = await sweepHostSessionDirs(root, threshold());

    expect(removed).toBe(2);
    expect(await exists('stale-exec_1')).toBe(false);
    expect(await exists('blue/oldexec')).toBe(false);
    expect(await exists('blue/ses-legacy/data.txt')).toBe(true);
  });

  test('removes an empty legacy root once its last session is gone', async () => {
    await dir('green', false);
    await age('green');

    const removed = await sweepHostSessionDirs(root, threshold());

    expect(removed).toBe(1);
    expect(await exists('green')).toBe(false);
  });

  test('keeps fresh one-shot dirs and dirs still in flight', async () => {
    await dir('fresh-exec');
    await dir('live-exec');
    await age('live-exec');

    const removed = await sweepHostSessionDirs(
      root,
      threshold(),
      (id) => id === 'live-exec',
    );

    expect(removed).toBe(0);
    expect(await exists('fresh-exec/data.txt')).toBe(true);
    expect(await exists('live-exec/data.txt')).toBe(true);
  });

  test('leaves files and unclassifiable dirs alone', async () => {
    await writeFile(join(root, '.spawner.lock'), '{}');
    await dir('weird+name');
    await dir('.hidden');
    await dir('has spaces');
    await age('weird+name', '.hidden', 'has spaces', '.spawner.lock');

    const removed = await sweepHostSessionDirs(root, threshold());

    expect(removed).toBe(0);
    expect(await exists('.spawner.lock')).toBe(true);
    expect(await exists('weird+name/data.txt')).toBe(true);
    expect(await exists('.hidden/data.txt')).toBe(true);
    expect(await exists('has spaces/data.txt')).toBe(true);
  });

  test('a missing root is not an error', async () => {
    expect(await sweepHostSessionDirs(join(root, 'nope'), threshold())).toBe(0);
  });
});
