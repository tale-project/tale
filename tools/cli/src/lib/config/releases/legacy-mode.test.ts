import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';

import JSZip from 'jszip';

import { unpack, type Entry } from './archive';
import { legacyStored } from './legacy';
import { gitTreeHash, legacyGitArchive } from './snapshot';

// NTFS exposes no POSIX executable bits. Drop modes only on source files in
// these owned temporary trees; directories and the real repository are intact.
const writeWithoutModes: typeof writeFileSync = (file, data) =>
  writeFileSync(file, data, { flag: 'wx', mode: 0o644 });
const entries: Entry[] = [
  {
    path: 'a/run.py',
    bytes: Buffer.from('print("retained")\n'),
    executable: true,
  },
  { path: 'a.txt', bytes: Buffer.from('plain\n'), executable: false },
  { path: 'Z.txt', bytes: Buffer.from('upper\n'), executable: false },
];

test('legacy Git archives retain declared executable modes when the filesystem loses them', async () => {
  const tree = gitTreeHash(entries);
  const canonical = legacyGitArchive(entries, 'retained', tree);
  const onModeLosingFilesystem = legacyGitArchive(
    entries,
    'retained',
    tree,
    writeWithoutModes,
  );
  expect(onModeLosingFilesystem).toEqual(canonical);
  const parsed = await unpack(onModeLosingFilesystem);
  expect(
    parsed.find((file) => file.path === 'retained/a/run.py')?.executable,
  ).toBe(true);
  expect(
    parsed.find((file) => file.path === 'retained/a.txt')?.executable,
  ).toBe(false);
}, 30_000);

test('compiler 1 stored ZIPs retain POSIX ordering and modes without filesystem metadata', async () => {
  const canonical = legacyStored(entries);
  const onModeLosingFilesystem = legacyStored(entries, writeWithoutModes);
  expect(onModeLosingFilesystem).toEqual(canonical);
  const parsed = await unpack(onModeLosingFilesystem);
  expect(
    Object.keys((await JSZip.loadAsync(onModeLosingFilesystem)).files),
  ).toEqual(['Z.txt', 'a/run.py', 'a.txt']);
  expect(parsed.map((file) => file.path)).toEqual([
    'Z.txt',
    'a.txt',
    'a/run.py',
  ]);
  expect(parsed.find((file) => file.path === 'a/run.py')?.executable).toBe(
    true,
  );
  expect(parsed.find((file) => file.path === 'a.txt')?.executable).toBe(false);
}, 30_000);
