// The per-organization package cache volumes against a fake docker CLI that
// logs every call: a volume found or made ready is not asked about again on
// every session create, and an organization's teardown forgets it.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TEST_SESSION_CONFIG } from './session/session-test-config.ts';
import type { SpawnerConfig } from './types.ts';
import {
  ensureCacheVolume,
  npmCacheVolumeName,
  removeCacheVolumes,
} from './volume.ts';

const FAKE_DOCKER = `#!/usr/bin/env bash
dir="$(dirname "$0")"
printf '%s\\n' "$*" >> "$dir/calls.log"
volumes="$dir/volumes"
touch "$volumes"
case "$1 $2" in
  "volume inspect")
    name="\${@: -1}"
    if grep -qx "$name" "$volumes"; then
      if [ "$3" = "--format" ]; then echo '{"tale.sandbox-cache":"1"}'; else echo '[{}]'; fi
      exit 0
    fi
    echo "Error response from daemon: get $name: no such volume" >&2; exit 1 ;;
  "volume create") echo "\${@: -1}" >> "$volumes"; echo "\${@: -1}"; exit 0 ;;
  "volume rm")
    name="\${@: -1}"
    grep -vx "$name" "$volumes" > "$volumes.next"; mv "$volumes.next" "$volumes"; exit 0 ;;
esac
if [ "$1" = run ]; then exit 0; fi
echo "fake docker: unhandled $*" >&2; exit 2
`;

let root = '';
const originalDockerBin = process.env.DOCKER_BIN;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tale-cache-volumes-'));
  const bin = join(root, 'docker');
  await writeFile(bin, FAKE_DOCKER);
  await chmod(bin, 0o755);
  process.env.DOCKER_BIN = bin;
});
beforeEach(async () => {
  await writeFile(join(root, 'calls.log'), '');
});
afterAll(async () => {
  if (originalDockerBin === undefined) delete process.env.DOCKER_BIN;
  else process.env.DOCKER_BIN = originalDockerBin;
  await rm(root, { recursive: true, force: true });
});

async function calls(): Promise<string[]> {
  const text = (await readFile(join(root, 'calls.log'), 'utf8')).trim();
  return text === '' ? [] : text.split('\n');
}

const cfg: SpawnerConfig = {
  instance: '',
  hub: null,
  deviceConfigPath: null,
  backend: 'docker',
  port: 8003,
  sandboxToken: 'test',
  runtimeImage: 'runtime:test',
  runtimeTier: 'runc',
  dockerInContainer: false,
  dockerBuildCache: false,
  buildkitdImage: 'buildkit:test',
  buildkitdMirrorImage: 'registry:2',
  transparentEgress: false,
  k8s: {
    namespace: 'sandbox',
    runtimeClassName: null,
    workspaceSizeLimit: '4Gi',
  },
  maxTimeoutMs: 300_000,
  hostSessionRoot: '/unused',
  cacheVolumePrefix: { pip: 'pip', npm: 'npm', bun: 'bun' },
  egressNetwork: 'tale-sandbox-net',
  egressProxy: 'http://sandbox-egress:3128',
  stdoutMaxBytes: 1000,
  stderrMaxBytes: 1000,
  maxRequestBodyBytes: 1000,
  session: TEST_SESSION_CONFIG,
};

let sequence = 0;
const nextOrg = () => `org_cache_${++sequence}`;

describe('per-organization cache volumes', () => {
  test('a volume made ready is not asked about again on the next create', async () => {
    const name = npmCacheVolumeName(cfg, nextOrg());
    const now = 1_000_000;
    await ensureCacheVolume(name, now);
    expect((await calls()).map((call) => call.split(' ')[0])).toEqual([
      'volume',
      'volume',
      'run',
    ]);
    await writeFile(join(root, 'calls.log'), '');
    await ensureCacheVolume(name, now + 60_000);
    expect(await calls()).toEqual([]);
  });

  test('past a few minutes it is checked again, without remaking an existing one', async () => {
    const name = npmCacheVolumeName(cfg, nextOrg());
    const now = 2_000_000;
    await ensureCacheVolume(name, now);
    await writeFile(join(root, 'calls.log'), '');
    await ensureCacheVolume(name, now + 5 * 60_000);
    expect(await calls()).toEqual([`volume inspect ${name}`]);
  });

  test('an organization’s teardown forgets its volumes', async () => {
    const org = nextOrg();
    const name = npmCacheVolumeName(cfg, org);
    const now = 3_000_000;
    await ensureCacheVolume(name, now);
    await removeCacheVolumes(cfg, org);
    await writeFile(join(root, 'calls.log'), '');
    await ensureCacheVolume(name, now + 1_000);
    expect((await calls())[0]).toBe(`volume inspect ${name}`);
    expect(await calls()).toContain(
      `volume create --label tale.sandbox-cache=1 ${name}`,
    );
  });

  test('concurrent ensures of one volume share one check', async () => {
    const name = npmCacheVolumeName(cfg, nextOrg());
    const now = 4_000_000;
    await Promise.all([
      ensureCacheVolume(name, now),
      ensureCacheVolume(name, now),
      ensureCacheVolume(name, now),
    ]);
    expect(
      (await calls()).filter((call) => call === `volume inspect ${name}`),
    ).toHaveLength(1);
  });
});
