// @vitest-environment node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  startTestStore,
  type TestStore,
} from '../../core/lib/storage/object_store.test-helpers.ts';
import type { S3ObjectStore } from '../../core/lib/storage/object_store.ts';
import { newJobDir, removeJobDir } from '../../lib/heavy-slot/job-dir.ts';
import { promoteStagedReplacement } from './replacement.ts';
import { DocumentError } from './service.ts';

/**
 * A replacement document on its way from its staging key to its final one.
 * The door used to read the staged file whole, hash it, send it on from
 * memory and read the promoted object whole again to compare: a file of the
 * largest size a document may have was in the process twice over, and a
 * third time as a string while a text was told from its bytes
 * (tale-project/tale#4942). It now goes by way of a file on the disk, and
 * these hold what the door promises of it: the attested type, the digest,
 * a final key written once, and nothing left behind.
 */

/** The largest replacement these tests allow, so that one past it is small. */
const LIMIT = 256 * 1024;

/** The store the organization's blobs are in, set by each test. */
const organization: { store?: S3ObjectStore } = {};

vi.mock('../../../lib/shared/file-types.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../lib/shared/file-types.ts')
  >()),
  DOCUMENT_MAX_FILE_SIZE: 256 * 1024,
}));
vi.mock('../../core/lib/storage/object_store.ts', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../core/lib/storage/object_store.ts')
    >();
  const theStore = (): Promise<S3ObjectStore> =>
    organization.store === undefined
      ? Promise.reject(new Error('no store in this test'))
      : Promise.resolve(organization.store);
  return {
    ...actual,
    resolveOrgObjectStore: vi.fn(theStore),
    locateOrgObjectStore: vi.fn(theStore),
  };
});
// The real directories, counted: whatever becomes of a replacement, the
// file it was read into must be gone.
vi.mock('../../lib/heavy-slot/job-dir.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/heavy-slot/job-dir.ts')>();
  return {
    ...actual,
    newJobDir: vi.fn(actual.newJobDir),
    removeJobDir: vi.fn(actual.removeJobDir),
  };
});

const STAGING = 'acme/staging-1';
const FINAL = 'acme/final-1';

const pdf = (length: number, fill = 0x20): Buffer =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(length - 9, fill)]);
const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

describe('promoteStagedReplacement', () => {
  let target: TestStore;
  beforeEach(async () => {
    target = await startTestStore();
    organization.store = target.store;
    vi.mocked(newJobDir).mockClear();
    vi.mocked(removeJobDir).mockClear();
  });
  afterEach(async () => {
    organization.store = undefined;
    await target.close();
  });

  const stage = (bytes: Buffer, key = STAGING): void => {
    target.objects.set(key, { bytes, contentType: 'application/octet-stream' });
  };
  const promote = (fileName = 'handbook.pdf') =>
    promoteStagedReplacement({
      orgSlug: 'acme',
      stagingRef: `s3:${STAGING}`,
      finalRef: `s3:${FINAL}`,
      fileName,
    });
  /** What a refused promotion was refused with. */
  const refusal = async (attempt: Promise<unknown>): Promise<DocumentError> => {
    const error = await attempt.then(
      () => null,
      (thrown: unknown) => thrown,
    );
    if (!(error instanceof DocumentError)) {
      throw new Error(`not a refusal of this door: ${String(error)}`);
    }
    return error;
  };
  /** Every directory a promotion read into was removed, and is gone. */
  const expectNothingLeftBehind = async (): Promise<void> => {
    const made = await Promise.all(
      vi.mocked(newJobDir).mock.results.map((result) => result.value),
    );
    expect(made.length).toBeGreaterThan(0);
    for (const dir of made) {
      expect(vi.mocked(removeJobDir)).toHaveBeenCalledWith(dir);
      expect(existsSync(dir)).toBe(false);
    }
  };
  /** What a wrapper of the store's fetch is called with. */
  type Call = [url: string, init: RequestInit];
  /** Do `then` around the first request `matching` that the store is asked
   * through its client (a HEAD or a GET; the streamed PUT goes its own
   * way): once it has been answered, or just before it is sent. */
  const around = (
    when: 'after' | 'before',
    matching: (method: string, url: string) => boolean,
    then: () => void,
  ): void => {
    const real = target.store.client.fetch.bind(target.store.client);
    let done = false;
    Object.assign(target.store.client, {
      fetch: vi.fn(async (...[url, init]: Call) => {
        const first = !done && matching(init.method ?? 'GET', url);
        if (first) done = true;
        if (first && when === 'before') then();
        const res = await real(url, init);
        if (first && when === 'after') then();
        return res;
      }),
    });
  };
  const afterFirst = (
    matching: (method: string, url: string) => boolean,
    then: () => void,
  ): void => around('after', matching, then);

  it('promotes the staged file to its final key, as what its bytes say it is', async () => {
    const bytes = pdf(LIMIT);
    stage(bytes);

    const promoted = await promote();

    expect(promoted).toEqual({
      verifiedContentType: 'application/pdf',
      contentHash: sha256(bytes),
      size: LIMIT,
    });
    // The final key holds the same bytes, under the type they were attested
    // as and never the one the staging link was given.
    const final = target.objects.get(FINAL);
    expect(final?.bytes.equals(bytes)).toBe(true);
    expect(final?.contentType).toBe('application/pdf');
    // Written once, on the condition that the key held nothing.
    expect(target.puts).toHaveLength(1);
    expect(target.puts[0]?.headers['if-none-match']).toBe('*');
    expect(target.puts[0]?.headers['content-length']).toBe(String(LIMIT));
    // The staged object is the sweeper's to remove, not this door's.
    expect(target.objects.has(STAGING)).toBe(true);
    await expectNothingLeftBehind();
  });

  it('tells a text from its bytes on the disk', async () => {
    // Longer than one piece of a file, with characters a piece's end cuts.
    const bytes = Buffer.from('# Grüße – é€😀\n'.repeat(6_000));
    stage(bytes);

    expect(await promote('notes.md')).toEqual({
      verifiedContentType: 'text/markdown',
      contentHash: sha256(bytes),
      size: bytes.byteLength,
    });
    expect(target.objects.get(FINAL)?.contentType).toBe('text/markdown');
  });

  it('refuses a staged file that is gone, before any directory is made', async () => {
    const refused = await refusal(promote());

    expect(refused.code).toBe('UPLOAD_BLOB_INVALID');
    expect(refused.message).toBe(
      'The uploaded replacement file no longer exists.',
    );
    expect(vi.mocked(newJobDir)).not.toHaveBeenCalled();
  });

  it('refuses a staged file the store declares over the limit, without reading it', async () => {
    stage(pdf(LIMIT + 1));
    const asked = vi.spyOn(target.store.client, 'fetch');

    const refused = await refusal(promote());

    expect(refused.code).toBe('FILE_TOO_LARGE');
    expect(refused.status).toBe(400);
    expect(refused.data).toEqual({
      reasonCode: 'file_too_large',
      limitBytes: LIMIT,
    });
    // Only the HEAD that learned its size.
    expect(asked.mock.calls.map(([, init]) => init?.method)).toEqual(['HEAD']);
    expect(vi.mocked(newJobDir)).not.toHaveBeenCalled();
    expect(target.objects.has(FINAL)).toBe(false);
  });

  // The staging link still writes while the door looks: what the store
  // declared a moment ago is not what it sends now.
  it('refuses a staged file that grew past the limit after its size was asked', async () => {
    stage(pdf(1024));
    afterFirst(
      (method) => method === 'HEAD',
      () => stage(pdf(LIMIT + 1)),
    );

    const refused = await refusal(promote());

    expect(refused.code).toBe('FILE_TOO_LARGE');
    expect(refused.data).toEqual({
      reasonCode: 'file_too_large',
      limitBytes: LIMIT,
    });
    expect(target.objects.has(FINAL)).toBe(false);
    expect(target.puts).toHaveLength(0);
    await expectNothingLeftBehind();
  });

  it('takes the staged file as it is sent, not as it was declared a moment before', async () => {
    stage(pdf(1024));
    const sent = pdf(4096, 0x21);
    afterFirst(
      (method) => method === 'HEAD',
      () => stage(sent),
    );

    const promoted = await promote();

    expect(promoted).toEqual({
      verifiedContentType: 'application/pdf',
      contentHash: sha256(sent),
      size: 4096,
    });
    expect(target.objects.get(FINAL)?.bytes.equals(sent)).toBe(true);
    expect(target.puts[0]?.headers['content-length']).toBe('4096');
  });

  it('refuses a staged file that vanished after its size was asked', async () => {
    stage(pdf(1024));
    afterFirst(
      (method) => method === 'HEAD',
      () => target.objects.delete(STAGING),
    );

    const refused = await refusal(promote());

    expect(refused.code).toBe('UPLOAD_BLOB_INVALID');
    expect(refused.message).toBe(
      'The uploaded replacement file no longer exists.',
    );
    await expectNothingLeftBehind();
  });

  it('refuses bytes that are not what the file name says, and promotes nothing', async () => {
    stage(Buffer.from('not a PDF'));

    const refused = await refusal(promote('spoofed.pdf'));

    expect(refused.code).toBe('UPLOAD_MIME_MISMATCH');
    expect(refused.status).toBe(400);
    expect(refused.data).toEqual({ reasonCode: 'mime_mismatch' });
    expect(target.objects.has(FINAL)).toBe(false);
    expect(target.puts).toHaveLength(0);
    await expectNothingLeftBehind();
  });

  // An attempt that wrote the final object and died before it could say so
  // left the intent `attesting`: the next attempt finds its work done.
  it('finds its own earlier promotion at the final key and sends nothing again', async () => {
    const bytes = pdf(LIMIT);
    stage(bytes);
    target.objects.set(FINAL, { bytes, contentType: 'application/pdf' });

    const promoted = await promote();

    expect(promoted.contentHash).toBe(sha256(bytes));
    expect(target.puts).toHaveLength(0);
    await expectNothingLeftBehind();
  });

  it('refuses when the final key holds other bytes, and leaves them as they are', async () => {
    stage(pdf(LIMIT, 0x20));
    const other = pdf(LIMIT, 0x21);
    target.objects.set(FINAL, { bytes: other, contentType: 'application/pdf' });

    const refused = await refusal(promote());

    expect(refused.code).toBe('UPLOAD_BLOB_INVALID');
    expect(refused.message).toBe(
      'The immutable replacement object does not match its attestation.',
    );
    expect(target.objects.get(FINAL)?.bytes).toBe(other);
    expect(target.puts).toHaveLength(0);
    await expectNothingLeftBehind();
  });

  // Another writer got to the final key between this attempt's look at it
  // and its write. A store refuses the write its own way: with an answer,
  // or by closing the connection under the body.
  it.each(['answer', 'drop'] as const)(
    'reads back what another writer put at the final key in between (the store would %s)',
    async (taken) => {
      const bytes = pdf(LIMIT);
      stage(bytes);
      target.behave = { taken };
      afterFirst(
        (method, url) => method === 'HEAD' && url.endsWith(FINAL),
        () =>
          target.objects.set(FINAL, { bytes, contentType: 'application/pdf' }),
      );

      const promoted = await promote();

      expect(promoted.contentHash).toBe(sha256(bytes));
      // The write was tried, and kept nothing of its own.
      expect(target.puts).toHaveLength(1);
      expect(target.puts[0]?.stored).toBe(false);
      await expectNothingLeftBehind();
    },
  );

  it('fails as the store fails when the promoted object cannot be read back', async () => {
    stage(pdf(LIMIT));
    // Gone between the write and the look at what was written.
    around(
      'before',
      (method, url) => method === 'GET' && url.endsWith(FINAL),
      () => target.objects.delete(FINAL),
    );

    await expect(promote()).rejects.toThrow(
      `S3 GET ${FINAL} failed: 404 the object does not exist`,
    );
    await expectNothingLeftBehind();
  });

  it('refuses a staging key outside the organization, and reads nothing', async () => {
    target.objects.set('other/staging-1', {
      bytes: pdf(1024),
      contentType: 'application/pdf',
    });
    const asked = vi.spyOn(target.store.client, 'fetch');

    await expect(
      promoteStagedReplacement({
        orgSlug: 'acme',
        stagingRef: 's3:other/staging-1',
        finalRef: `s3:${FINAL}`,
        fileName: 'handbook.pdf',
      }),
    ).rejects.toThrow("outside org 'acme' namespace");
    expect(asked).not.toHaveBeenCalled();
  });
});
