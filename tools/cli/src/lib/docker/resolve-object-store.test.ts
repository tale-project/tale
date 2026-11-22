import { describe, expect, test } from 'bun:test';

import type { ExecResult, OneShotJob, StackRuntime } from '../runtime/types';
import { minioNotice, resolveObjectStore } from './resolve-object-store';

/** A runtime whose volumes print what `held` says they hold. */
function runtimeHolding(held: Record<string, string>): StackRuntime {
  const runtime = {
    volumeExists: async (name: string) => name in held,
    oneShot: async (job: OneShotJob): Promise<ExecResult> => ({
      success: true,
      stdout: held[job.mounts[0]?.volume ?? ''] ?? '',
      stderr: '',
      exitCode: 0,
    }),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the two verbs the resolver uses
  return runtime as unknown as StackRuntime;
}

describe('the server a deployment’s blob store runs', () => {
  test("is MinIO where the blobs are in MinIO's volume", async () => {
    expect(
      await resolveObjectStore(
        'p_',
        runtimeHolding({
          'p_blob-data': '',
          'p_object-store-data': '/data/.minio.sys',
        }),
      ),
    ).toBe('minio');
  });

  test.each([
    [
      "versitygw's volume holds the blobs",
      { 'p_blob-data': '/data/tale-blobs' },
    ],
    [
      'both hold something',
      {
        'p_blob-data': '/data/tale-blobs',
        'p_object-store-data': '/data/.minio.sys',
      },
    ],
    [
      'neither holds anything',
      { 'p_blob-data': '', 'p_object-store-data': '' },
    ],
    ['no volume exists yet', {}],
  ])('is versitygw where %s', async (_name, held) => {
    expect(await resolveObjectStore('p_', runtimeHolding(held))).toBe(
      'versitygw',
    );
  });

  test('says why a deployment keeps MinIO, naming the volume its blobs are in', () => {
    expect(minioNotice('tale_')).toBe(
      "The blob store stays MinIO: this deployment's blobs are in tale_object-store-data, in MinIO's format. A new install runs versitygw.",
    );
  });
});
