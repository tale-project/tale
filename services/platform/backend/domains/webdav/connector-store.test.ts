// @vitest-environment node

/**
 * The connector's read of a document's bytes, and the ceiling an agent's
 * call puts on it. A document whose row carries no size used to be read
 * whole and refused afterwards; the store is told the ceiling and refuses
 * the read itself, before the document is in memory
 * (tale-project/tale#4942).
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WebdavStoreError } from '../../../lib/connectors/natives/index.ts';
import {
  ObjectTooLargeError,
  s3GetObjectBytes,
} from '../../core/lib/storage/object_store.ts';
import { pgWebdavStore } from './connector-store.ts';

/** What the document's row says of it. */
const row: { size: number | null } = { size: null };

vi.mock('./handlers.ts', () => ({
  webdavHandlers: () => ({
    'webdav/tree_queries:resolvePath': () =>
      Promise.resolve({ kind: 'document', documentId: 'doc_1' }),
    'webdav/tree_queries:getDocumentProps': () =>
      Promise.resolve({
        fileId: 's3:acme/report',
        size: row.size,
        contentType: 'text/plain',
      }),
  }),
}));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));
vi.mock('../../lib/object-store.ts', () => ({
  locateOrgObjectStore: vi.fn(() => Promise.resolve({ bucket: 'tale' })),
}));
vi.mock('../../core/lib/storage/object_store.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/lib/storage/object_store.ts')
  >()),
  s3GetObjectBytes: vi.fn(),
}));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every reader of the database is mocked above
const store = pgWebdavStore({} as Sql);

const read = (maxBytes: number) =>
  store.read({
    organizationId: 'org_1',
    segments: ['reports', 'report.txt'],
    maxBytes,
  });

afterEach(() => {
  vi.clearAllMocks();
  row.size = null;
});

describe('the webdav connector reading a document', () => {
  it('answers the bytes and the type of a document within the ceiling', async () => {
    vi.mocked(s3GetObjectBytes).mockResolvedValueOnce(
      new TextEncoder().encode('figures'),
    );

    const got = await read(1024);

    expect(new TextDecoder().decode(got.bytes)).toBe('figures');
    expect(got.contentType).toBe('text/plain');
  });

  it('tells the store the ceiling, so a document with no size on record is measured before it is read', async () => {
    vi.mocked(s3GetObjectBytes).mockResolvedValueOnce(new Uint8Array(4));

    await read(1024);

    expect(s3GetObjectBytes).toHaveBeenCalledWith(
      expect.anything(),
      'acme/report',
      { maxBytes: 1024 },
    );
  });

  it.each([
    [
      'with its size, where the store declared one',
      90_000_000,
      'the file is 90000000 bytes; the ceiling is 1024',
    ],
    [
      'without a size, where it declared none',
      null,
      'the file is over the ceiling of 1024 bytes',
    ],
  ])(
    'refuses a document the store measured over the ceiling, %s',
    async (_case, size, message) => {
      vi.mocked(s3GetObjectBytes).mockRejectedValueOnce(
        new ObjectTooLargeError('acme/report', 1024, size),
      );

      const refused = await read(1024).then(
        () => null,
        (error: unknown) => error,
      );

      expect(refused).toBeInstanceOf(WebdavStoreError);
      expect(refused).toMatchObject({ code: 'too-large', message });
    },
  );

  it('refuses a document whose row says it is over the ceiling, without asking the store', async () => {
    row.size = 4096;

    await expect(read(1024)).rejects.toMatchObject({
      code: 'too-large',
      message: 'the file is 4096 bytes; the ceiling is 1024',
    });
    expect(s3GetObjectBytes).not.toHaveBeenCalled();
  });

  it("passes a store's other failure on as it is", async () => {
    const failure = new Error('S3 GET acme/report failed: 503 slow down');
    vi.mocked(s3GetObjectBytes).mockRejectedValueOnce(failure);

    await expect(read(1024)).rejects.toBe(failure);
  });
});
