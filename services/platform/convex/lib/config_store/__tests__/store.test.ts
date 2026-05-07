import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';

import { createFileConfigStore } from '../store';

const testSchema = z
  .object({
    foo: z.string(),
    n: z.number().int().nonnegative().optional(),
  })
  .strict();

type TestConfig = z.infer<typeof testSchema>;

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'config-store-test-'));
  vi.stubEnv('TALE_CONFIG_DIR', tmpRoot);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('createFileConfigStore', () => {
  it('read returns null for missing file', async () => {
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    const result = await store.read('default');
    expect(result).toBeNull();
  });

  it('read parses + validates a valid file', async () => {
    const dir = path.join(tmpRoot, 'thing');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'default.json'),
      JSON.stringify({ foo: 'bar', n: 42 }),
    );
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    const result = await store.read('default');
    expect(result).toEqual({ foo: 'bar', n: 42 });
  });

  it('read throws on corrupted JSON', async () => {
    const dir = path.join(tmpRoot, 'thing');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'default.json'), '{ not valid json');
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    await expect(store.read('default')).rejects.toThrow();
  });

  it('read throws on schema violation', async () => {
    const dir = path.join(tmpRoot, 'thing');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'default.json'),
      JSON.stringify({ foo: 123 }), // foo must be string
    );
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    await expect(store.read('default')).rejects.toThrow();
  });

  it('write then read round-trips', async () => {
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    await store.write('marketing', { foo: 'hello', n: 7 });
    const result = await store.read('marketing');
    expect(result).toEqual({ foo: 'hello', n: 7 });
  });

  it('write rejects invalid input via Zod', async () => {
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- intentionally invalid for the test
    await expect(
      store.write('default', { foo: 999 } as unknown as TestConfig),
    ).rejects.toThrow(/Refusing to write invalid/);
  });

  it('list returns slugs of present *.json files', async () => {
    const dir = path.join(tmpRoot, 'thing');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'default.json'), '{}');
    await writeFile(path.join(dir, 'marketing.json'), '{}');
    await writeFile(path.join(dir, 'engineering.json'), '{}');
    // Non-json + dotfile should be ignored
    await writeFile(path.join(dir, 'notes.txt'), 'ignored');
    await writeFile(path.join(dir, '.history.json'), 'ignored');
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    const list = await store.list();
    const slugs = list.map((e) => e.orgSlug).sort();
    expect(slugs).toEqual(['default', 'engineering', 'marketing']);
  });

  it('list returns empty array when area dir does not exist', async () => {
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    const list = await store.list();
    expect(list).toEqual([]);
  });

  it('rejects path traversal in orgSlug', async () => {
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    await expect(store.read('../escape')).rejects.toThrow(/Invalid org slug/);
  });

  it('throws when TALE_CONFIG_DIR unset', async () => {
    vi.stubEnv('TALE_CONFIG_DIR', '');
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    await expect(store.read('default')).rejects.toThrow(/TALE_CONFIG_DIR/);
  });
});
