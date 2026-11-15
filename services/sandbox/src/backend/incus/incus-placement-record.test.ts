// The placement record's file: written whole and atomically, read back as
// written, and an unreadable one kept aside for the rebuild.

import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FilePlacementStore,
  parsePlacementRecord,
  PLACEMENT_RECORD_FILE,
} from './incus-placement-record.ts';
import { rejection } from './incus-test-support.ts';

let directory: string;
let error: ReturnType<typeof spyOn<typeof console, 'error'>>;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tale-placement-'));
  error = spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  error.mockRestore();
  await rm(directory, { recursive: true, force: true });
});

const RECORD = {
  complete: false,
  listed: ['node-1'],
  sessions: { a: 'node-1' },
};

test('no file is no record yet', async () => {
  expect(await new FilePlacementStore(directory).load()).toBeUndefined();
});

test('reads back what it wrote, and leaves no temporary file', async () => {
  const store = new FilePlacementStore(join(directory, 'made'));
  await store.save(RECORD);
  await store.save({ ...RECORD, sessions: { a: 'node-1', b: 'node-2' } });
  expect(await store.load()).toEqual({
    ...RECORD,
    sessions: { a: 'node-1', b: 'node-2' },
  });
  expect(await readdir(join(directory, 'made'))).toEqual([
    PLACEMENT_RECORD_FILE,
  ]);
  expect(
    JSON.parse(
      await readFile(join(directory, 'made', PLACEMENT_RECORD_FILE), 'utf8'),
    ),
  ).toMatchObject({ version: 1 });
});

test('an unreadable record is kept aside and read as none, for the rebuild', async () => {
  await writeFile(join(directory, PLACEMENT_RECORD_FILE), '{"version":1,');
  const store = new FilePlacementStore(directory);
  expect(await store.load()).toBeUndefined();
  const files = await readdir(directory);
  expect(files).toHaveLength(1);
  expect(files[0]).toStartWith(`${PLACEMENT_RECORD_FILE}.unreadable-`);
  expect(String(error.mock.calls[0]?.[0])).toContain(
    "rebuilt from the hosts' listings",
  );
});

test('a write into a directory that cannot be made fails', async () => {
  await writeFile(join(directory, 'file'), '');
  const store = new FilePlacementStore(join(directory, 'file', 'below'));
  expect(await rejection(store.save(RECORD))).toBeInstanceOf(Error);
});

test('holds a record to its shape', () => {
  expect(
    parsePlacementRecord(JSON.stringify({ version: 1, ...RECORD })),
  ).toEqual(RECORD);
  for (const bad of [
    { ...RECORD },
    { version: 2, ...RECORD },
    { version: 1, ...RECORD, complete: 'yes' },
    { version: 1, ...RECORD, listed: [1] },
    { version: 1, ...RECORD, sessions: { a: 1 } },
    { version: 1, ...RECORD, sessions: [] },
  ]) {
    expect(() => parsePlacementRecord(JSON.stringify(bad))).toThrow();
  }
});
