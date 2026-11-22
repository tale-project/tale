import { describe, expect, it } from 'vitest';

import { minioDevBlobsNotice, type DockerAnswer } from './dev-blob-store';

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
