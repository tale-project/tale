// Exercise the production Node transport, not Bun's different net.Socket implementation.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  engineEnvironment,
  runnerEnvironment,
  storeHoldsImages,
} from './lazy-docker.ts';

test('Docker activation lifecycle and streams under Node', async () => {
  // Node resolves the executed file's real path. Canonicalize the fixture too so
  // macOS /var -> /private/var cannot hide accidental bundled entrypoint code.
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tale-lazy-node-')));
  try {
    const bundle = await Bun.build({
      entrypoints: [join(import.meta.dir, 'lazy-docker.node-fixture.ts')],
      target: 'node',
      outdir: dir,
    });
    expect(bundle.success).toBe(true);
    const result = spawnSync(
      'node',
      [
        '--test',
        '--test-reporter=tap',
        join(dir, 'lazy-docker.node-fixture.js'),
      ],
      {
        encoding: 'utf8',
        timeout: 20_000,
      },
    );
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('# tests 12');
    expect(result.stdout).toContain('# pass 12');
    expect(result.status).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 25_000);

test('the production bundle explicitly starts the root supervisor', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tale-lazy-entry-')));
  try {
    const bundle = await Bun.build({
      entrypoints: [join(import.meta.dir, 'lazy-docker-entry.ts')],
      target: 'node',
      outdir: dir,
    });
    expect(bundle.success).toBe(true);
    // Exercise the real executable boundary without creating privileged sockets,
    // including when the test itself runs as root in a container.
    const result = spawnSync(
      'node',
      [
        '--input-type=module',
        '--eval',
        'process.getuid = () => 10001; await import(process.argv[1]);',
        pathToFileURL(join(dir, 'lazy-docker-entry.js')).href,
      ],
      { encoding: 'utf8', timeout: 5_000 },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      '[lazy-docker] supervisor failed: Docker supervisor requires root\n',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runnerd gets back the workspace Node settings the root supervisor never loads', () => {
  const env = runnerEnvironment({
    PATH: '/usr/bin',
    TALE_RUNNER_NODE_PATH: '/agent/.runtime/deps/node/lib/node_modules',
    TALE_RUNNER_NODE_COMPILE_CACHE:
      '/agent/.runtime/home/.cache/node-compile-cache',
  });
  expect(env).toEqual({
    PATH: '/usr/bin',
    NODE_PATH: '/agent/.runtime/deps/node/lib/node_modules',
    NODE_COMPILE_CACHE: '/agent/.runtime/home/.cache/node-compile-cache',
  });
  // An entrypoint from before the compile cache leaves runnerd without one.
  expect(runnerEnvironment({ PATH: '/usr/bin' })).toEqual({
    PATH: '/usr/bin',
    NODE_PATH: '',
  });
});

test("the engine child sees the organization's mirror and nothing from the workspace", () => {
  const env = engineEnvironment({
    TALE_BUILDKITD_ENDPOINT: 'tcp://tale-buildkitd-a:1234',
    TALE_DOCKER_HUB_MIRROR: 'tale-buildkitd-mirror-a-docker-io:5000',
    NO_PROXY: '127.0.0.1',
    NODE_COMPILE_CACHE: '/agent/.runtime/home/.cache/node-compile-cache',
    BUILDX_BUILDER: 'tale-build-a',
  });
  expect(env.TALE_DOCKER_HUB_MIRROR).toBe(
    'tale-buildkitd-mirror-a-docker-io:5000',
  );
  expect(env.TALE_BUILDKITD_ENDPOINT).toBe('tcp://tale-buildkitd-a:1234');
  expect(env.NO_PROXY).toBe('127.0.0.1');
  expect(env.NODE_COMPILE_CACHE).toBeUndefined();
  expect(env.BUILDX_BUILDER).toBeUndefined();
});

test('an inner store holds images once its image database has an entry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tale-imagedb-'));
  try {
    const imageDb = join(dir, 'imagedb');
    // A fresh store has no image database yet; an empty one holds nothing.
    expect(await storeHoldsImages(imageDb)).toBe(false);
    await mkdir(imageDb);
    expect(await storeHoldsImages(imageDb)).toBe(false);
    await writeFile(join(imageDb, 'a'.repeat(64)), '{}');
    expect(await storeHoldsImages(imageDb)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
