import { afterEach, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquireLock } from './acquire-lock';
import { ownsGuard, releaseGuard } from './lock-guard';
import { releaseLock } from './release-lock';

const roots: string[] = [];
const held: string[] = [];
function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), 'tale-lock-paths-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const directory of held.splice(0)) await releaseLock(directory);
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test.each(['state', 'metadata-directory'] as const)(
  'refuses a %s symlink without writing into its target',
  async (kind) => {
    const root = temporary();
    const state = join(root, 'state');
    const foreign = join(root, 'foreign');
    mkdirSync(foreign);
    if (kind === 'state') symlinkSync(foreign, state, 'dir');
    else {
      mkdirSync(state);
      symlinkSync(foreign, join(state, '.tale'), 'dir');
    }
    await expect(acquireLock(state, 'deploy')).rejects.toThrow('symlink');
    expect(readdirSync(foreign)).toEqual([]);
  },
);

test.each(['deployment-lock.sqlite', 'deployment-lock'] as const)(
  'refuses a %s symlink before creating or rewriting either lock',
  async (name) => {
    const root = temporary();
    const state = join(root, 'state');
    const metadata = join(state, '.tale');
    const foreign = join(root, 'foreign');
    mkdirSync(metadata, { recursive: true });
    writeFileSync(foreign, 'preserve-existing-user-bytes');
    symlinkSync(foreign, join(metadata, name));
    await expect(acquireLock(state, 'deploy')).rejects.toThrow('symlink');
    expect(readFileSync(foreign, 'utf8')).toBe('preserve-existing-user-bytes');
    expect(readdirSync(metadata)).toEqual([name]);
  },
);

test.each(['deployment-lock.sqlite', 'deployment-lock'] as const)(
  'refuses a dangling %s symlink without creating its destination',
  async (name) => {
    const root = temporary();
    const state = join(root, 'state');
    const metadata = join(state, '.tale');
    const foreign = join(root, 'missing');
    mkdirSync(metadata, { recursive: true });
    symlinkSync(foreign, join(metadata, name));
    await expect(acquireLock(state, 'deploy')).rejects.toThrow('symlink');
    expect(existsSync(foreign)).toBe(false);
    expect(readdirSync(metadata)).toEqual([name]);
  },
);

test('ownership and release checks do not create an absent state directory', async () => {
  const state = join(temporary(), 'absent', 'state');
  expect(await ownsGuard(state)).toBe(false);
  await releaseGuard(state);
  await releaseLock(state);
  expect(existsSync(state)).toBe(false);
});

test('an ancestor alias preserves one canonical lock identity', async () => {
  const root = temporary();
  const canonical = join(root, 'actual');
  const alias = join(root, 'alias');
  mkdirSync(canonical);
  symlinkSync(canonical, alias, 'dir');
  const throughAlias = join(alias, 'state');
  const throughCanonical = join(canonical, 'state');
  expect(await acquireLock(throughAlias, 'deploy')).toBe(true);
  held.push(throughCanonical);
  expect(await ownsGuard(throughCanonical)).toBe(true);
  expect(await acquireLock(throughCanonical, 'backup')).toBe(false);
  await releaseLock(throughCanonical);
  held.splice(held.indexOf(throughCanonical), 1);
  expect(await ownsGuard(throughAlias)).toBe(false);
  expect(
    existsSync(join(throughCanonical, '.tale/deployment-lock.sqlite')),
  ).toBe(true);
});
