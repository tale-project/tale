// @vitest-environment node

import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { purgeCorpusForOrg } from '../../core/knowledge/teardown.ts';
import {
  buildS3ObjectStore,
  invalidateOrgObjectStore,
  ObjectStoreUnconfiguredError,
  resolveOrgObjectStore,
  s3DeleteObject,
  s3ListObjectKeys,
} from '../../core/lib/storage/object_store.ts';
import { teardownDeletedOrganization } from './teardown.ts';

/**
 * The `org.cleanup_files` job body: what the slug keys outside the app
 * database — corpus, blobs, config tree — goes in that order, and the slug
 * tombstone is cleared LAST, so a retry after any failure resumes with the
 * slug still reserved — including a config tree the (non-fatal) remover
 * refused to delete. A slug a live organization owns is never touched.
 * The corpus purge and the S3 calls are stubbed (their own tests cover
 * them); the config tree is a real temporary directory.
 */

vi.mock('../../core/knowledge/teardown.ts', () => ({
  purgeCorpusForOrg: vi.fn(),
}));
vi.mock('../../core/lib/storage/object_store.ts', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../core/lib/storage/object_store.ts')
    >();
  return {
    ...actual,
    resolveOrgObjectStore: vi.fn(),
    s3ListObjectKeys: vi.fn(),
    s3DeleteObject: vi.fn(() => Promise.resolve()),
    invalidateOrgObjectStore: vi.fn(),
  };
});

const SLUG = 'acme-old';

function fakeSql(owners: { id: string }[]): { sql: Sql; statements: string[] } {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.raw.join('$').replace(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.startsWith('SELECT "id" FROM "organization"')) {
      return Promise.resolve(owners);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- recording stub for an unconstructable third-party branded type
  return { sql: tag as unknown as Sql, statements };
}

function storeWithPrefix(prefix: string) {
  return buildS3ObjectStore(
    {
      endpoint: 'http://127.0.0.1:9000',
      bucket: 'tale-blobs',
      region: 'us-east-1',
      forcePathStyle: true,
      prefix,
    },
    { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
  );
}

const exists = (dir: string): boolean => {
  try {
    statSync(dir);
    return true;
  } catch {
    return false;
  }
};

let configRoot: string;
let previousConfigDir: string | undefined;

beforeEach(() => {
  configRoot = mkdtempSync(path.join(tmpdir(), 'org-teardown-'));
  previousConfigDir = process.env.TALE_CONFIG_DIR;
  process.env.TALE_CONFIG_DIR = configRoot;
  mkdirSync(path.join(configRoot, SLUG, 'governance'), { recursive: true });
  writeFileSync(path.join(configRoot, SLUG, 'governance', 'marker.json'), '{}');
  vi.mocked(purgeCorpusForOrg).mockResolvedValue({
    documents: 3,
    chunks: 9,
    websiteMemberships: 0,
    websites: 0,
  });
  vi.mocked(resolveOrgObjectStore).mockResolvedValue(
    storeWithPrefix('tenants'),
  );
  vi.mocked(s3ListObjectKeys).mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
  rmSync(configRoot, { recursive: true, force: true });
  if (previousConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
  else process.env.TALE_CONFIG_DIR = previousConfigDir;
});

describe('teardownDeletedOrganization', () => {
  it('refuses a slug a live organization still owns and touches nothing', async () => {
    const { sql, statements } = fakeSql([{ id: 'org-live' }]);

    const result = await teardownDeletedOrganization(sql, SLUG);

    expect(result).toEqual({ status: 'refused', corpusDocuments: 0, blobs: 0 });
    expect(purgeCorpusForOrg).not.toHaveBeenCalled();
    expect(resolveOrgObjectStore).not.toHaveBeenCalled();
    expect(exists(path.join(configRoot, SLUG))).toBe(true);
    expect(statements.some((t) => t.startsWith('DELETE FROM'))).toBe(false);
  });

  it('purges corpus, then blobs in the org namespace, then the config tree, and clears the tombstone last', async () => {
    const { sql, statements } = fakeSql([]);
    vi.mocked(s3ListObjectKeys).mockResolvedValue([
      `tenants/${SLUG}/blob-1`,
      `tenants/${SLUG}/blob-2`,
      // A listing artefact outside the org's namespace is never deleted.
      'tenants/other-org/blob-3',
    ]);

    const result = await teardownDeletedOrganization(sql, SLUG);

    expect(result).toEqual({ status: 'done', corpusDocuments: 3, blobs: 2 });
    expect(purgeCorpusForOrg).toHaveBeenCalledWith(SLUG);
    expect(s3ListObjectKeys).toHaveBeenCalledWith(
      expect.anything(),
      `tenants/${SLUG}/`,
    );
    expect(vi.mocked(s3DeleteObject).mock.calls.map((c) => c[1])).toEqual([
      `tenants/${SLUG}/blob-1`,
      `tenants/${SLUG}/blob-2`,
    ]);
    // Corpus before blobs before the tree: both resolve through config files
    // that live in the tree.
    const order = (fn: { mock: { invocationCallOrder: number[] } }) =>
      fn.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
    expect(order(vi.mocked(purgeCorpusForOrg))).toBeLessThan(
      order(vi.mocked(s3ListObjectKeys)),
    );
    expect(exists(path.join(configRoot, SLUG))).toBe(false);
    expect(invalidateOrgObjectStore).toHaveBeenCalledWith(SLUG);
    // The tombstone goes last — after everything the slug keys is gone.
    expect(statements.at(-1)).toBe(
      'DELETE FROM app.organization_tombstones WHERE slug = $',
    );
  });

  it('treats a deployment without any object store as having no blobs', async () => {
    const { sql, statements } = fakeSql([]);
    vi.mocked(resolveOrgObjectStore).mockRejectedValue(
      new ObjectStoreUnconfiguredError(),
    );

    const result = await teardownDeletedOrganization(sql, SLUG);

    expect(result).toEqual({ status: 'done', corpusDocuments: 3, blobs: 0 });
    expect(s3ListObjectKeys).not.toHaveBeenCalled();
    expect(exists(path.join(configRoot, SLUG))).toBe(false);
    expect(statements.at(-1)).toMatch(
      /^DELETE FROM app\.organization_tombstones/,
    );
  });

  it('keeps the tombstone and the config tree when the corpus purge fails, so a retry resumes', async () => {
    const { sql, statements } = fakeSql([]);
    vi.mocked(purgeCorpusForOrg).mockRejectedValue(new Error('corpus down'));

    await expect(teardownDeletedOrganization(sql, SLUG)).rejects.toThrow(
      'corpus down',
    );

    expect(resolveOrgObjectStore).not.toHaveBeenCalled();
    expect(exists(path.join(configRoot, SLUG))).toBe(true);
    expect(statements.some((t) => t.startsWith('DELETE FROM'))).toBe(false);
  });

  it('keeps the tombstone when the config tree survives the remover — a symlinked org dir is refused, not followed', async () => {
    const { sql, statements } = fakeSql([]);
    // The remover refuses a symlinked org dir (it would otherwise rm -rf the
    // link's target) and returns without throwing; the tree is still there.
    const orgDir = path.join(configRoot, SLUG);
    const elsewhere = path.join(configRoot, 'elsewhere');
    rmSync(orgDir, { recursive: true, force: true });
    mkdirSync(path.join(elsewhere, 'governance'), { recursive: true });
    symlinkSync(elsewhere, orgDir);

    await expect(teardownDeletedOrganization(sql, SLUG)).rejects.toThrow(
      /config tree .* still exists after removal/,
    );

    // Corpus and blobs went first (their steps are idempotent); the link and
    // its target are untouched; the tombstone stands for the retry.
    expect(purgeCorpusForOrg).toHaveBeenCalledWith(SLUG);
    expect(lstatSync(orgDir).isSymbolicLink()).toBe(true);
    expect(exists(path.join(elsewhere, 'governance'))).toBe(true);
    expect(invalidateOrgObjectStore).not.toHaveBeenCalled();
    expect(statements.some((t) => t.startsWith('DELETE FROM'))).toBe(false);
  });
});
