import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';

import { createFileConfigStore } from './store';

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

// Org-first layout: each org's area file lives at
// `<root>/<orgSlug>/<area>.json`.
async function writeOrgAreaFile(
  orgSlug: string,
  area: string,
  content: string,
): Promise<void> {
  const dir = path.join(tmpRoot, orgSlug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${area}.json`), content);
}

describe('createFileConfigStore', () => {
  it('read returns null for missing file', async () => {
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    const result = await store.read('default');
    expect(result).toBeNull();
  });

  it('read parses + validates a valid file', async () => {
    await writeOrgAreaFile(
      'default',
      'thing',
      JSON.stringify({ foo: 'bar', n: 42 }),
    );
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    const result = await store.read('default');
    expect(result).toEqual({ foo: 'bar', n: 42 });
  });

  it('read throws on corrupted JSON', async () => {
    await writeOrgAreaFile('default', 'thing', '{ not valid json');
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    await expect(store.read('default')).rejects.toThrow();
  });

  it('read throws on schema violation', async () => {
    await writeOrgAreaFile(
      'default',
      'thing',
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

  it('list returns slugs of orgs with a <area>.json file', async () => {
    await writeOrgAreaFile('default', 'thing', '{}');
    await writeOrgAreaFile('marketing', 'thing', '{}');
    await writeOrgAreaFile('engineering', 'thing', '{}');
    // An org without the area file should not appear.
    await mkdir(path.join(tmpRoot, 'unrelated'), { recursive: true });
    await writeFile(path.join(tmpRoot, 'unrelated', 'other.json'), '{}');
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    const list = await store.list();
    const slugs = list.map((e) => e.orgSlug).sort();
    expect(slugs).toEqual(['default', 'engineering', 'marketing']);
  });

  it('list returns empty array when config root does not exist', async () => {
    // Stub to a non-existent path so the readdir() in list() takes the
    // ENOENT branch.
    await rm(tmpRoot, { recursive: true, force: true });
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    const list = await store.list();
    expect(list).toEqual([]);
  });

  it('rejects path traversal in orgSlug', async () => {
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    await expect(store.read('./escape')).rejects.toThrow(/Invalid org slug/);
  });

  it('throws when TALE_CONFIG_DIR unset', async () => {
    vi.stubEnv('TALE_CONFIG_DIR', '');
    const store = createFileConfigStore<TestConfig>('thing', testSchema);
    await expect(store.read('default')).rejects.toThrow(/TALE_CONFIG_DIR/);
  });
});
