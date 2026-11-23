import { describe, expect, test } from 'bun:test';

import type { ExecResult, OneShotJob, StackRuntime } from '../runtime/types';
import { liveBlobVolume } from './live-blob-volume';

/** A runtime that holds `volumes`, each with what a look into it prints
 * (`null`: the look fails). */
function runtimeWith(volumes: Record<string, string | null>) {
  const probed: OneShotJob[] = [];
  const runtime = {
    volumeExists: async (name: string) => name in volumes,
    oneShot: async (job: OneShotJob): Promise<ExecResult> => {
      probed.push(job);
      const said = volumes[job.mounts[0]?.volume ?? ''];
      return said === null || said === undefined
        ? {
            success: false,
            stdout: '',
            stderr: 'permission denied',
            exitCode: 1,
          }
        : { success: true, stdout: said, stderr: '', exitCode: 0 };
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the two verbs the function uses
  return { runtime: runtime as unknown as StackRuntime, probed };
}

describe('which volume holds a deployment’s blobs', () => {
  test("versitygw's, once it holds anything, whatever MinIO's still holds", async () => {
    const { runtime, probed } = runtimeWith({
      'p_blob-data': '/data/tale-blobs\n',
      'p_object-store-data': '/data/.minio.sys\n',
    });

    expect(await liveBlobVolume('p_', runtime)).toBe('blob-data');
    // MinIO's volume was not even looked into.
    expect(probed.map((job) => job.mounts[0]?.volume)).toEqual(['p_blob-data']);
  });

  // `ensureVolumes` creates every volume of the stack on every run: that
  // `blob-data` exists says nothing.
  test("MinIO's, where versitygw's exists and is empty and MinIO's holds blobs", async () => {
    const { runtime } = runtimeWith({
      'p_blob-data': '',
      'p_object-store-data': '/data/.minio.sys\n',
    });

    expect(await liveBlobVolume('p_', runtime)).toBe('object-store-data');
  });

  test.each([
    [
      'both exist and are empty',
      { 'p_blob-data': '', 'p_object-store-data': '' },
    ],
    ['neither exists yet', {}],
    ["only MinIO's exists, empty", { 'p_object-store-data': '\n' }],
  ])("versitygw's on a fresh install: %s", async (_name, volumes) => {
    const { runtime } = runtimeWith(volumes);

    expect(await liveBlobVolume('p_', runtime)).toBe('blob-data');
  });

  test('looks read-only, and past the lost+found of an ext filesystem', async () => {
    const { runtime, probed } = runtimeWith({ 'p_blob-data': '' });

    await liveBlobVolume('p_', runtime);

    expect(probed[0]?.mounts).toEqual([
      { volume: 'p_blob-data', target: '/data', readOnly: true },
    ]);
    expect(probed[0]?.argv.at(-1)).toBe(
      'find /data -mindepth 1 -maxdepth 1 ! -name lost+found -print -quit',
    );
  });

  // "Could not look" is never "empty": that would pass over a store full of
  // blobs and start an empty one beside it.
  test.each([
    ['versitygw’s volume', { 'p_blob-data': null }, 'p_blob-data'],
    [
      'MinIO’s volume',
      { 'p_blob-data': '', 'p_object-store-data': null },
      'p_object-store-data',
    ],
  ])('throws when %s cannot be looked into', async (_name, volumes, named) => {
    const { runtime } = runtimeWith(volumes);

    await expect(liveBlobVolume('p_', runtime)).rejects.toThrow(
      `Could not inspect ${named} for existing blobs: permission denied. Nothing was changed.`,
    );
  });

  test('reads the volumes of the prefix it is given, the dev stack’s too', async () => {
    const { runtime } = runtimeWith({
      'tale-dev_object-store-data': '/data/.minio.sys',
      'tale_blob-data': '/data/tale-blobs',
    });

    expect(await liveBlobVolume('tale-dev_', runtime)).toBe(
      'object-store-data',
    );
    expect(await liveBlobVolume('tale_', runtime)).toBe('blob-data');
  });
});
