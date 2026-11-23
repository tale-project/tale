import { describe, expect, it, vi } from 'vitest';

import {
  browserFacing,
  buildS3ObjectStore,
  s3PresignPutUrl,
} from '../backend/core/lib/storage/object_store';
import { resolveEnvObjectStore } from '../lib/utils/env-object-store';
import {
  minioDevBlobsNotice,
  objectStoreProxy,
  type DockerAnswer,
} from './dev-blob-store';
import { ensureObjectStoreEnv } from './dev-secrets';

vi.mock('@tale/shared/tux', () => ({ warnLine: vi.fn() }));

const COMPOSE = ['compose', '-f', 'compose.yml', '-f', 'compose.dev.yml'];

/** A Docker that holds `volumes` (as Compose labels them) and names the
 * project of the dev files `project`. */
function docker(volumes: Record<string, string[]>, project = 'tale') {
  const calls: string[][] = [];
  const run = (args: readonly string[]): DockerAnswer => {
    calls.push([...args]);
    if (args[0] === 'volume') {
      const label = /^label=com\.docker\.compose\.volume=(.+)$/.exec(
        args.at(-1) ?? '',
      )?.[1];
      return { status: 0, stdout: (volumes[label ?? ''] ?? []).join('\n') };
    }
    if (args.includes('config'))
      return {
        status: 0,
        stdout: `{"name":"${project}","services":{"db":{}}}`,
      };
    return { status: 1, stdout: '' };
  };
  return { run, calls };
}

describe('the notice about the dev stack’s earlier blob store', () => {
  it('is given where the stack has MinIO’s volume and is about to get versitygw’s', () => {
    const { run } = docker({ 'object-store-data': ['tale_object-store-data'] });

    const notice = minioDevBlobsNotice(run, COMPOSE);

    expect(notice).toContain('versitygw now, on the volume tale_blob-data');
    expect(notice).toContain('tale_object-store-data');
    expect(notice).toContain('docker volume rm tale_object-store-data');
  });

  it('is not given again once the stack has versitygw’s volume', () => {
    const { run, calls } = docker({
      'object-store-data': ['tale_object-store-data'],
      'blob-data': ['tale_blob-data'],
    });

    expect(minioDevBlobsNotice(run, COMPOSE)).toBeNull();
    // Compose was not asked for the project: no stack waits.
    expect(calls.some((args) => args.includes('config'))).toBe(false);
  });

  it('costs one listing where no stack on the machine ran MinIO', () => {
    const { run, calls } = docker({});

    expect(minioDevBlobsNotice(run, COMPOSE)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('is about this checkout’s stack, not another one’s on the machine', () => {
    const { run } = docker(
      { 'object-store-data': ['other-checkout_object-store-data'] },
      'tale',
    );

    expect(minioDevBlobsNotice(run, COMPOSE)).toBeNull();
  });

  it('asks Compose for the project with the dev files', () => {
    const { run, calls } = docker({
      'object-store-data': ['tale_object-store-data'],
    });

    minioDevBlobsNotice(run, COMPOSE);

    expect(calls.at(-1)).toEqual([...COMPOSE, 'config', '--format', 'json']);
  });

  it('says nothing where Docker or Compose cannot be asked', () => {
    const failing = () => ({ status: 1, stdout: '' });
    expect(minioDevBlobsNotice(failing, COMPOSE)).toBeNull();

    const noCompose = (args: readonly string[]): DockerAnswer =>
      args[0] === 'volume'
        ? { status: 0, stdout: 'tale_object-store-data' }
        : { status: 1, stdout: '' };
    expect(minioDevBlobsNotice(noCompose, COMPOSE)).toBeNull();
  });
});

/** The store the backend builds from this environment, as the bootstrap
 * writes it into the default connection. */
function storeOf(env: NodeJS.ProcessEnv) {
  const resolved = resolveEnvObjectStore(env);
  if (!resolved.configured) throw new Error(resolved.reason);
  const { accessKeyId, secretAccessKey, endpoint, publicEndpoint, ...rest } =
    resolved.store;
  return buildS3ObjectStore(
    {
      ...rest,
      ...(endpoint === undefined ? {} : { endpoint }),
      ...(publicEndpoint === undefined ? {} : { publicEndpoint }),
    },
    { accessKeyId, secretAccessKey },
  );
}

describe('the dev stack’s blob store, as the browser reaches it', () => {
  it('takes an upload on the app’s origin, where Vite forwards the bucket to the store', async () => {
    const env: NodeJS.ProcessEnv = { SITE_URL: 'http://localhost:3000' };
    ensureObjectStoreEnv(env);
    // The link the upload lane hands the browser (domains/files/service.ts).
    const link = new URL(
      await s3PresignPutUrl(
        browserFacing(storeOf(env), 'http://localhost:3000'),
        'northlight-labs/document',
        { contentType: 'text/plain' },
      ),
    );
    // Same origin as the page: on the store's own address the PUT was
    // another origin's, which versitygw refused for want of a CORS rule.
    expect(link.origin).toBe('http://localhost:3000');
    const routes = Object.entries(objectStoreProxy(env));
    const route = routes.find(([path]) => link.pathname.startsWith(path));
    expect(route?.[1]).toEqual({
      target: 'http://127.0.0.1:59000',
      // The Host the link was signed for reaches the store unchanged.
      changeOrigin: false,
    });
  });

  it('routes the bucket the environment names to the store it names', () => {
    expect(
      objectStoreProxy({
        OBJECT_STORE_ENDPOINT: 'http://127.0.0.1:9000',
        OBJECT_STORE_BUCKET: 'docs-blobs',
        OBJECT_STORE_ACCESS_KEY: 'key',
        OBJECT_STORE_SECRET_KEY: 'secret',
      }),
    ).toEqual({
      '/docs-blobs/': { target: 'http://127.0.0.1:9000', changeOrigin: false },
    });
  });

  it('routes nothing for a store the environment does not configure or a path cannot reach', () => {
    expect(objectStoreProxy({})).toEqual({});
    // AWS S3 proper: no endpoint, a bucket of its own host name.
    expect(
      objectStoreProxy({
        OBJECT_STORE_ACCESS_KEY: 'key',
        OBJECT_STORE_SECRET_KEY: 'secret',
      }),
    ).toEqual({});
    expect(
      objectStoreProxy({
        OBJECT_STORE_ENDPOINT: 'https://s3.example.com',
        OBJECT_STORE_FORCE_PATH_STYLE: 'false',
        OBJECT_STORE_ACCESS_KEY: 'key',
        OBJECT_STORE_SECRET_KEY: 'secret',
      }),
    ).toEqual({});
  });
});
