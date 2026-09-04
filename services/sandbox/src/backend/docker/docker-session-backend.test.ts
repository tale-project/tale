// Create-conflict reconcile predicates. The safety-critical invariant is that
// only a TERMINAL (exited/dead) container is ever reaped on a name conflict —
// reaping a running/created/paused container would kill a concurrent winner's
// healthy session on another spawner replica. These pin that so a refactor
// can't loosen it to "anything that isn't running".

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TEST_SESSION_CONFIG } from '../../session/session-test-config.ts';
import type { SpawnerConfig } from '../../types.ts';
import {
  DockerSessionBackend,
  isDockerNameConflict,
  isReapableContainerStatus,
} from './docker-session-backend.ts';

describe('isDockerNameConflict', () => {
  test('matches the daemon name-collision message (the observed failure)', () => {
    const stderr =
      'docker: Error response from daemon: Conflict. The container name ' +
      '"/tale-sbx-ses-usr-abc" is already in use by container "f751…". You ' +
      'have to remove (or rename) that container to be able to reuse that name.';
    expect(isDockerNameConflict(stderr)).toBe(true);
  });

  test('matches "already in use" and "Conflict" case-insensitively', () => {
    expect(isDockerNameConflict('name is already in use')).toBe(true);
    expect(isDockerNameConflict('CONFLICT: nope')).toBe(true);
  });

  test('does not match unrelated docker errors', () => {
    expect(isDockerNameConflict('no such image: tale-sandbox:test')).toBe(
      false,
    );
    expect(isDockerNameConflict('Cannot connect to the Docker daemon')).toBe(
      false,
    );
    expect(isDockerNameConflict('')).toBe(false);
  });
});

describe('isReapableContainerStatus', () => {
  test('only terminal states (exited/dead) are reapable', () => {
    expect(isReapableContainerStatus('exited')).toBe(true);
    expect(isReapableContainerStatus('dead')).toBe(true);
    // tolerate the trailing newline docker inspect emits
    expect(isReapableContainerStatus('exited\n')).toBe(true);
  });

  test('a possibly-live peer is NEVER reapable', () => {
    for (const status of [
      'running',
      'created',
      'restarting',
      'paused',
      'removing',
    ]) {
      expect(isReapableContainerStatus(status)).toBe(false);
    }
  });

  test('an unknown/garbage status is not reapable', () => {
    expect(isReapableContainerStatus('')).toBe(false);
    expect(isReapableContainerStatus('wat')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The stop/destroy contract against a FAKE docker CLI. `DOCKER_BIN` points at a
// bash script that reads its behaviour from a control file beside it (Bun.spawn
// snapshots the environment at startup, so per-test env vars would not reach
// the child), so the backend's real code path (inspect → rm → judge) runs end
// to end without a daemon. spawn-util reads DOCKER_BIN lazily per invocation,
// so the override works post-import.
// ---------------------------------------------------------------------------

const FAKE_DOCKER = `#!/usr/bin/env bash
# Fake docker CLI for tests. Reads three lines from ./mode next to this script:
#   line 1: 1 when the container exists, else 0
#   line 2: rm outcome — ok | nosuch | busy
#   line 3: comma-separated session ids \`docker ps\` lists (may be empty)
here="$(cd "$(dirname "$0")" && pwd)"
present="$(sed -n 1p "$here/mode")"
rm_mode="$(sed -n 2p "$here/mode")"
listed="$(sed -n 3p "$here/mode")"
cmd="$1"; shift
case "$cmd" in
  ps)
    IFS=',' read -ra ids <<< "$listed"
    for id in "\${ids[@]}"; do
      [ -n "$id" ] && printf '%s\torg_fake\tagent\t1700000000000\trunning\n' "$id"
    done
    exit 0 ;;
  inspect)
    fmt="$2"; name="$3"
    if [ "$present" = "1" ]; then
      case "$fmt" in
        *State.Running*) echo "true" ;;
        *State.Status*) echo "running" ;;
        *Mounts*) echo "" ;;
        *) echo "abc123" ;;
      esac
      exit 0
    fi
    echo "Error response from daemon: No such object: $name" >&2
    exit 1 ;;
  rm)
    case "$rm_mode" in
      ok) exit 0 ;;
      nosuch)
        echo "Error response from daemon: No such container: $2" >&2
        exit 1 ;;
      busy)
        echo "Error response from daemon: cannot remove container: device or resource busy" >&2
        exit 1 ;;
      *) echo "fake docker: unexpected rm mode '$rm_mode'" >&2; exit 2 ;;
    esac ;;
  *)
    echo "fake docker: unhandled command $cmd" >&2
    exit 2 ;;
esac
`;

let fakeRoot = '';
let hostSessionRoot = '';
const ORIGINAL_DOCKER_BIN = process.env.DOCKER_BIN;

/** Point the fake docker at one scenario: does the container exist, and how
 * does `docker rm` answer. */
async function fakeDocker(scenario: {
  present: boolean;
  rm: 'ok' | 'nosuch' | 'busy';
  listed?: string[];
}): Promise<void> {
  await writeFile(
    join(fakeRoot, 'mode'),
    `${scenario.present ? '1' : '0'}\n${scenario.rm}\n${(scenario.listed ?? []).join(',')}\n`,
  );
}

/** The rejection of a promise, or null when it resolved — bun:test's
 * `rejects` matchers type as void, which the await-thenable lint rejects. */
async function rejection(promise: Promise<unknown>): Promise<Error | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

beforeAll(async () => {
  fakeRoot = await mkdtemp(join(tmpdir(), 'tale-fake-docker-'));
  const bin = join(fakeRoot, 'docker');
  await writeFile(bin, FAKE_DOCKER);
  await chmod(bin, 0o755);
  hostSessionRoot = join(fakeRoot, 'sessions');
  await mkdir(hostSessionRoot, { recursive: true });
  process.env.DOCKER_BIN = bin;
});

afterAll(async () => {
  if (ORIGINAL_DOCKER_BIN === undefined) delete process.env.DOCKER_BIN;
  else process.env.DOCKER_BIN = ORIGINAL_DOCKER_BIN;
  await rm(fakeRoot, { recursive: true, force: true });
});

function backendConfig(): SpawnerConfig {
  return {
    backend: 'docker',
    port: 8003,
    sandboxToken: 'test-token',
    runtimeImage: 'tale-sandbox-runtime:test',
    runtimeTier: 'runc',
    dockerInContainer: false,
    dockerBuildCache: false,
    buildkitdImage: 'tale-sandbox-buildkitd:test',
    buildkitdMirrorImage: 'registry:2',
    browserView: false,
    transparentEgress: false,
    k8s: {
      namespace: 'tale-sandbox',
      runtimeClassName: null,
      spawnerImage: 'tale-sandbox:test',
      cacheMode: 'none',
      workspaceSizeLimit: '4Gi',
    },
    defaultTimeoutMs: 30_000,
    maxTimeoutMs: 300_000,
    hostSessionRoot,
    cacheVolumePrefix: { pip: 'pip', npm: 'npm', bun: 'bun' },
    egressNetwork: 'tale-sandbox-net',
    egressProxy: 'http://sandbox-egress:3128',
    stdoutMaxBytes: 5_242_880,
    stderrMaxBytes: 5_242_880,
    outputFileMaxBytes: 52_428_800,
    outputTotalMaxBytes: 104_857_600,
    maxRequestBodyBytes: 262_144,
    session: TEST_SESSION_CONFIG,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('DockerSessionBackend stop/destroy honour the rm result', () => {
  test('stopSession THROWS when docker rm fails on a present container (never a silent orphan)', async () => {
    await fakeDocker({ present: true, rm: 'busy' });
    const backend = new DockerSessionBackend(backendConfig());
    // The reaper's contract: a throw keeps the registry entry for a retry; a
    // resolved "existed" would have dropped it while the container ran on.
    const err = await rejection(backend.stopSession('rm-busy'));
    expect(err?.message).toMatch(
      /docker rm tale-sbx-ses-rm-busy failed \(exit 1\)/,
    );
  });

  test('stopSession resolves true when rm succeeds on a present container', async () => {
    await fakeDocker({ present: true, rm: 'ok' });
    const backend = new DockerSessionBackend(backendConfig());
    expect(await backend.stopSession('rm-ok')).toBe(true);
  });

  test('stopSession is idempotent: an already-gone container resolves false without throwing', async () => {
    await fakeDocker({ present: false, rm: 'nosuch' });
    const backend = new DockerSessionBackend(backendConfig());
    expect(await backend.stopSession('rm-gone')).toBe(false);
  });

  test('destroySession THROWS on a failed rm and leaves the workspace intact', async () => {
    await fakeDocker({ present: true, rm: 'busy' });
    const workspace = join(hostSessionRoot, 'ses-destroy-busy');
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, 'keep.txt'), 'user data');
    const backend = new DockerSessionBackend(backendConfig());
    const err = await rejection(backend.destroySession('destroy-busy'));
    expect(err?.message).toMatch(/docker rm tale-sbx-ses-destroy-busy failed/);
    // A container that may still be running keeps its bind-mounted data.
    expect(await exists(join(workspace, 'keep.txt'))).toBe(true);
  });
});

describe('DockerSessionBackend durable pin (survives a spawner restart)', () => {
  test('setPinned records a marker under the host session root that listSessions reports back', async () => {
    await fakeDocker({ present: true, rm: 'ok', listed: ['pin-a', 'pin-b'] });
    const backend = new DockerSessionBackend(backendConfig());
    await backend.setPinned('pin-a', true);
    // Outside the workspace: the agent cannot pin itself from inside /agent.
    expect(await exists(join(hostSessionRoot, '.pins', 'pin-a.pinned'))).toBe(
      true,
    );
    expect(await exists(join(hostSessionRoot, 'ses-pin-a'))).toBe(false);

    // What a freshly restarted spawner would re-adopt.
    const listed = await backend.listSessions();
    expect(listed.find((s) => s.sessionId === 'pin-a')?.pinned).toBe(true);
    expect(listed.find((s) => s.sessionId === 'pin-b')?.pinned).toBe(false);

    await backend.setPinned('pin-a', false);
    expect(await exists(join(hostSessionRoot, '.pins', 'pin-a.pinned'))).toBe(
      false,
    );
  });

  test('stop and destroy clear the pin — a later incarnation starts unpinned', async () => {
    await fakeDocker({ present: true, rm: 'ok' });
    const backend = new DockerSessionBackend(backendConfig());
    await backend.setPinned('pin-stop', true);
    await backend.stopSession('pin-stop');
    expect(
      await exists(join(hostSessionRoot, '.pins', 'pin-stop.pinned')),
    ).toBe(false);

    await backend.setPinned('pin-destroy', true);
    // destroySession confirms the container is gone via inspect State.Running.
    await fakeDocker({ present: false, rm: 'nosuch' });
    await backend.destroySession('pin-destroy');
    expect(
      await exists(join(hostSessionRoot, '.pins', 'pin-destroy.pinned')),
    ).toBe(false);
  });
});
