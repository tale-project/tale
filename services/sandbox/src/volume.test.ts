// The per-organization package cache volumes against a fake docker CLI that
// logs every call and keeps each volume's label, mode and whether a session
// holds it: a volume found or made ready is not asked about again on every
// session create, one Docker made itself (unlabelled, root-owned, 0755) is
// replaced or at least made writable, and an organization's teardown forgets
// its volumes.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TEST_SESSION_CONFIG } from './session/session-test-config.ts';
import type { SpawnerConfig } from './types.ts';
import {
  ensureCacheVolume,
  npmCacheVolumeName,
  removeCacheVolumes,
} from './volume.ts';

// `hold-<call>` makes the first such call wait until the test removes
// `holding-<call>`; an inspect has read the volume by then, as a daemon
// answering late would have. `fail-<call>` makes the first such call fail.
const FAKE_DOCKER = `#!/usr/bin/env bash
dir="$(dirname "$0")"
printf '%s\\n' "$*" >> "$dir/calls.log"
volumes="$dir/volumes"
mkdir -p "$volumes"
name="\${@: -1}"
hold() {
  if mv "$dir/hold-$1" "$dir/holding-$1" 2>/dev/null; then
    while [ -e "$dir/holding-$1" ]; do sleep 0.01; done
  fi
}
fails() { mv "$dir/fail-$1" "$dir/failed-$1" 2>/dev/null; }
case "$1 $2" in
  "volume inspect")
    if fails inspect; then echo "Error response from daemon: i/o timeout" >&2; exit 1; fi
    if [ -d "$volumes/$name" ]; then
      out='[{}]'
      if [ "$3" = "--format" ]; then
        if [ -e "$volumes/$name/labelled" ]; then out='{"tale.sandbox-cache":"1"}'; else out='null'; fi
      fi
      hold inspect
      echo "$out"; exit 0
    fi
    hold inspect
    echo "Error response from daemon: get $name: no such volume" >&2; exit 1 ;;
  "volume create")
    if [ ! -d "$volumes/$name" ]; then
      mkdir "$volumes/$name"; echo 0755 > "$volumes/$name/mode"
      if [ "$3" = "--label" ]; then touch "$volumes/$name/labelled"; fi
    fi
    echo "$name"; exit 0 ;;
  "volume rm")
    hold rm
    if [ ! -d "$volumes/$name" ]; then
      echo "Error response from daemon: get $name: no such volume" >&2; exit 1
    fi
    if [ -e "$volumes/$name/in-use" ]; then
      echo "Error response from daemon: remove $name: volume is in use - [0123456789ab]" >&2; exit 1
    fi
    rm -rf "\${volumes:?}/$name"; exit 0 ;;
esac
if [ "$1" = run ]; then
  if fails run; then echo "docker: Error response from daemon: pull access denied for busybox" >&2; exit 125; fi
  for arg in "$@"; do
    case "$arg" in type=volume,src=*) src="\${arg#type=volume,src=}"; src="\${src%%,*}" ;; esac
  done
  if [ ! -d "$volumes/$src" ]; then mkdir "$volumes/$src"; fi
  echo 1777 > "$volumes/$src/mode"; exit 0
fi
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

const inspectCall = (name: string) =>
  `volume inspect --format {{json .Labels}} ${name}`;

/** A volume as the daemon holds it: its label, the mode of its root, and
 * whether a session holds it. */
async function volume(
  name: string,
): Promise<{ labelled: boolean; mode: string } | null> {
  const dir = join(root, 'volumes', name);
  try {
    await stat(dir);
  } catch {
    return null;
  }
  let labelled = true;
  try {
    await stat(join(dir, 'labelled'));
  } catch {
    labelled = false;
  }
  return {
    labelled,
    mode: (await readFile(join(dir, 'mode'), 'utf8')).trim(),
  };
}

/** A volume Docker made itself for a session's `--mount`: no label, the
 * root root-owned at 0755. */
async function plantUnlabelled(name: string, inUse = false): Promise<void> {
  const dir = join(root, 'volumes', name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'mode'), '0755\n');
  if (inUse) await writeFile(join(dir, 'in-use'), '');
}

/** Wait until the fake docker holds the call `hold-<call>` named. */
async function held(call: string): Promise<void> {
  for (;;) {
    try {
      await stat(join(root, `holding-${call}`));
      return;
    } catch {
      await Bun.sleep(5);
    }
  }
}

/** The rejection of a promise, or null when it resolved. */
async function rejection(promise: Promise<unknown>): Promise<Error | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

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
    expect(await volume(name)).toEqual({ labelled: true, mode: '1777' });
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
    expect(await calls()).toEqual([inspectCall(name)]);
  });

  test('a clock that went back is checked again', async () => {
    const name = npmCacheVolumeName(cfg, nextOrg());
    const now = 2_500_000;
    await ensureCacheVolume(name, now);
    await writeFile(join(root, 'calls.log'), '');
    await ensureCacheVolume(name, now - 1);
    expect(await calls()).toEqual([inspectCall(name)]);
  });

  test('an organization’s teardown forgets its volumes', async () => {
    const org = nextOrg();
    const name = npmCacheVolumeName(cfg, org);
    const now = 3_000_000;
    await ensureCacheVolume(name, now);
    await removeCacheVolumes(cfg, org);
    await writeFile(join(root, 'calls.log'), '');
    await ensureCacheVolume(name, now + 1_000);
    expect((await calls())[0]).toBe(inspectCall(name));
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
      (await calls()).filter((call) => call === inspectCall(name)),
    ).toHaveLength(1);
  });
});

describe('a cache volume Docker made itself', () => {
  test('is removed and made again with its label and mode', async () => {
    const org = nextOrg();
    const name = npmCacheVolumeName(cfg, org);
    await plantUnlabelled(name);
    await ensureCacheVolume(name, 5_000_000);
    expect(await volume(name)).toEqual({ labelled: true, mode: '1777' });
    expect(await calls()).toEqual([
      inspectCall(name),
      `volume rm ${name}`,
      `volume create --label tale.sandbox-cache=1 ${name}`,
      `run --rm --user 0:0 --label tale.sandbox-staging=1 --mount type=volume,src=${name},dst=/cache busybox:1.36 chmod 1777 /cache`,
    ]);
    // Labelled, it is the organization's again: its teardown removes it.
    expect(await removeCacheVolumes(cfg, org)).toBe(1);
  });

  test('one a session holds is made writable and reported, then replaced once free', async () => {
    const name = npmCacheVolumeName(cfg, nextOrg());
    const now = 6_000_000;
    await plantUnlabelled(name, true);
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await ensureCacheVolume(name, now);
      expect(await volume(name)).toEqual({ labelled: false, mode: '1777' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        `${name} lacks the tale.sandbox-cache label`,
      );
    } finally {
      warn.mockRestore();
    }
    // Writable, it counts as ready for the window; the next check replaces it.
    await writeFile(join(root, 'calls.log'), '');
    await ensureCacheVolume(name, now + 60_000);
    expect(await calls()).toEqual([]);
    await rm(join(root, 'volumes', name, 'in-use'));
    await ensureCacheVolume(name, now + 5 * 60_000);
    expect(await volume(name)).toEqual({ labelled: true, mode: '1777' });
  });
});

describe('a cache volume that is not ready yet', () => {
  test('a daemon that cannot say fails the ensure, and the next one asks again', async () => {
    const name = npmCacheVolumeName(cfg, nextOrg());
    const now = 7_000_000;
    await writeFile(join(root, 'fail-inspect'), '');
    expect((await rejection(ensureCacheVolume(name, now)))?.message).toBe(
      `volume: cannot inspect ${name}: Error response from daemon: i/o timeout`,
    );
    expect(await volume(name)).toBeNull();
    await writeFile(join(root, 'calls.log'), '');
    await ensureCacheVolume(name, now);
    expect((await calls())[0]).toBe(inspectCall(name));
    expect(await volume(name)).toEqual({ labelled: true, mode: '1777' });
  });

  test('one made without its mode is removed, so the next ensure makes it whole', async () => {
    const name = npmCacheVolumeName(cfg, nextOrg());
    const now = 8_000_000;
    await writeFile(join(root, 'fail-run'), '');
    expect((await rejection(ensureCacheVolume(name, now)))?.message).toBe(
      `volume: failed to set perms on cache volume ${name}: docker: Error response from daemon: pull access denied for busybox`,
    );
    expect(await volume(name)).toBeNull();
    await ensureCacheVolume(name, now);
    expect(await volume(name)).toEqual({ labelled: true, mode: '1777' });
  });
});

describe('a teardown beside an ensure', () => {
  test('an ensure that found the volume while the teardown removed it leaves it unready', async () => {
    const org = nextOrg();
    const name = npmCacheVolumeName(cfg, org);
    const now = 9_000_000;
    await ensureCacheVolume(name, now);
    await writeFile(join(root, 'hold-rm'), '');
    const teardown = removeCacheVolumes(cfg, org);
    await held('rm');
    // Past the window, so this one asks the daemon: the volume is still there.
    await ensureCacheVolume(name, now + 5 * 60_000);
    await rm(join(root, 'holding-rm'));
    expect(await teardown).toBe(1);
    await writeFile(join(root, 'calls.log'), '');
    await ensureCacheVolume(name, now + 5 * 60_000 + 1_000);
    expect(await volume(name)).toEqual({ labelled: true, mode: '1777' });
    expect(await calls()).toContain(
      `volume create --label tale.sandbox-cache=1 ${name}`,
    );
  });

  test('an ensure in flight across the whole teardown does not mark the removed volume ready', async () => {
    const org = nextOrg();
    const name = npmCacheVolumeName(cfg, org);
    const now = 10_000_000;
    await ensureCacheVolume(name, now);
    await writeFile(join(root, 'hold-inspect'), '');
    const ensure = ensureCacheVolume(name, now + 5 * 60_000);
    await held('inspect');
    expect(await removeCacheVolumes(cfg, org)).toBe(1);
    await rm(join(root, 'holding-inspect'));
    await ensure;
    await writeFile(join(root, 'calls.log'), '');
    await ensureCacheVolume(name, now + 5 * 60_000 + 1_000);
    expect(await volume(name)).toEqual({ labelled: true, mode: '1777' });
    expect(await calls()).toContain(
      `volume create --label tale.sandbox-cache=1 ${name}`,
    );
  });
});
