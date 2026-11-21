// @vitest-environment node

/**
 * The upload door's read of a staged package. The limit on a package is the
 * store's to apply, before the package is in memory: the door it is staged
 * through takes files of up to 512 MiB, and the limit used to be compared
 * after the whole staged file had been read (tale-project/tale#4942). "Over
 * the limit" is an answer about the package; any other failure of the read
 * is the package being unreachable.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UploadHost } from '../../core/automations/upload_impl.ts';
import {
  ObjectTooLargeError,
  s3GetObjectBytes,
} from '../../core/lib/storage/object_store.ts';
import { uploadAutomationPg } from './upload.ts';

/** What the host's read of the staged package answered. */
const seen: { staged?: Awaited<ReturnType<UploadHost['readStagedZip']>> } = {};

// The upload itself is `upload_impl.size.test.ts`'s: here it only does what
// it does with the host, which is to have the staged package verified and
// read under a limit.
vi.mock('../../core/automations/upload_impl.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/automations/upload_impl.ts')
  >()),
  uploadAutomationImpl: vi.fn(
    async (host: UploadHost, args: { storageId: string }) => {
      await host.verifyStagedZip(args.storageId);
      seen.staged = await host.readStagedZip(args.storageId, 1000);
      return { ok: true };
    },
  ),
}));
vi.mock('../files/upload-intents.ts', () => ({
  consumeUploadIntent: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('../../lib/object-store.ts', () => ({
  resolveObjectStore: vi.fn(() => Promise.resolve({ bucket: 'tale' })),
}));
vi.mock('../../core/lib/storage/object_store.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/lib/storage/object_store.ts')
  >()),
  s3GetObjectBytes: vi.fn(),
  s3DeleteObject: vi.fn(() => Promise.resolve()),
}));

const upload = () =>
  uploadAutomationPg(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the upload is mocked above and runs no query
    {} as Sql,
    {
      organizationId: 'org_1',
      orgSlug: 'acme',
      userId: 'user_1',
      role: 'admin',
    },
    { storageId: 's3:acme/pack' },
  );

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  delete seen.staged;
});

describe("the automation upload's read of a staged package", () => {
  it('tells the store the most a package may hold', async () => {
    vi.mocked(s3GetObjectBytes).mockResolvedValueOnce(new Uint8Array(8));

    await upload();

    expect(s3GetObjectBytes).toHaveBeenCalledWith(
      expect.anything(),
      'acme/pack',
      { maxBytes: 1000 },
    );
    expect(seen.staged).toEqual(new Uint8Array(8));
  });

  it('answers a package the store measured over the limit as too large, with its size', async () => {
    vi.mocked(s3GetObjectBytes).mockRejectedValueOnce(
      new ObjectTooLargeError('acme/pack', 1000, 536_870_912),
    );

    await upload();

    expect(seen.staged).toEqual({ tooLarge: 536_870_912 });
  });

  it('answers a package it could not read as gone', async () => {
    const warned = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    vi.mocked(s3GetObjectBytes).mockRejectedValueOnce(
      new Error('S3 GET acme/pack failed: 404'),
    );

    await upload();

    expect(seen.staged).toBeNull();
    expect(warned).toHaveBeenCalled();
  });
});
