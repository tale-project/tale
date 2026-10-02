// Create-conflict reconcile predicates. The safety-critical invariant is that
// only a TERMINAL (exited/dead) container is ever reaped on a name conflict —
// reaping a running/created/paused container would kill a concurrent winner's
// healthy session on another spawner replica. These pin that so a refactor
// can't loosen it to "anything that isn't running".

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionRoutes } from '../../session/session-routes.ts';
import { TEST_SESSION_CONFIG } from '../../session/session-test-config.ts';
import {
  WorkspaceTrash,
  workspaceTrash,
} from '../../session/workspace-trash.ts';
import type { SpawnerConfig } from '../../types.ts';
import { DockerBackend } from './docker-backend.ts';
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
# Fake docker CLI for tests. Reads four lines from ./mode next to this script:
#   line 1: 1 when the container exists, else 0
#   line 2: rm outcome — ok | nosuch | busy
#   line 3: comma-separated session ids \`docker ps\` lists (may be empty)
#   line 4: ps outcome — ok | fail (a daemon hiccup: non-zero exit + stderr)
here="$(cd "$(dirname "$0")" && pwd)"
present="$(sed -n 1p "$here/mode")"
rm_mode="$(sed -n 2p "$here/mode")"
listed="$(sed -n 3p "$here/mode")"
ps_mode="$(sed -n 4p "$here/mode")"
cmd="$1"; shift
case "$cmd" in
  ps)
    if [ "$ps_mode" = "fail" ]; then
      echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock" >&2
      exit 1
    fi
    IFS=',' read -ra ids <<< "$listed"
    for id in "\${ids[@]}"; do
      [ -n "$id" ] && printf '%s\torg_fake\tagent\t1700000000000\trunning\n' "$id"
    done
    exit 0 ;;
  inspect)
    fmt="$2"; name="$3"
    if [ "$present" = "1" ]; then
      case "$fmt" in
        *tale.created*) printf 'abcdef123456\\t1700000000000\\n' ;;
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
    printf '%s\\n' "$@" > "$here/last-rm"
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
  ps?: 'ok' | 'fail';
}): Promise<void> {
  await writeFile(
    join(fakeRoot, 'mode'),
    `${scenario.present ? '1' : '0'}\n${scenario.rm}\n${(scenario.listed ?? []).join(',')}\n${scenario.ps ?? 'ok'}\n`,
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
    instance: '',
    hub: null,
    deviceConfigPath: null,
    port: 8003,
    sandboxToken: 'test-token',
    runtimeImage: 'tale-sandbox-runtime:test',
    runtimeTier: 'runc',
    dockerInContainer: false,
    dockerBuildCache: false,
    buildkitdImage: 'tale-sandbox-buildkitd:test',
    buildkitdMirrorImage: 'registry:2',
    transparentEgress: false,
    k8s: {
      namespace: 'tale-sandbox',
      runtimeClassName: null,
      workspaceSizeLimit: '4Gi',
    },
    maxTimeoutMs: 300_000,
    hostSessionRoot,
    cacheVolumePrefix: { pip: 'pip', npm: 'npm', bun: 'bun' },
    egressNetwork: 'tale-sandbox-net',
    egressProxy: 'http://sandbox-egress:3128',
    stdoutMaxBytes: 5_242_880,
    stderrMaxBytes: 5_242_880,
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

/** A session root of the test's own: its trash sees no other test's
 * destroys. */
async function freshRoot(): Promise<string> {
  return mkdtemp(join(fakeRoot, 'root-'));
}

function rootedConfig(root: string): SpawnerConfig {
  return { ...backendConfig(), hostSessionRoot: root };
}

/** A workspace of `dirs` × `files` small files, two levels down. Returns the
 * number of files. */
async function plantWorkspace(
  path: string,
  dirs: number,
  files: number,
): Promise<number> {
  for (let d = 0; d < dirs; d++) {
    const dir = join(path, `dir-${d}`, 'nested');
    await mkdir(dir, { recursive: true });
    await Promise.all(
      Array.from({ length: files }, (_, f) =>
        writeFile(join(dir, `file-${f}.txt`), `${d}/${f}`),
      ),
    );
  }
  return dirs * files;
}

async function countFiles(path: string): Promise<number> {
  return (await readdir(path, { recursive: true })).filter((entry) =>
    entry.endsWith('.txt'),
  ).length;
}

/** A trash whose deletions wait until the test lets them go, so the test
 * can look at what a destroy answered while the whole tree is still there. */
function heldTrash(root: string): {
  trash: WorkspaceTrash;
  release: () => void;
  removed: string[];
} {
  const gate = Promise.withResolvers<void>();
  const removed: string[] = [];
  const trash = new WorkspaceTrash(root, async (path) => {
    await gate.promise;
    await rm(path, { recursive: true, force: true });
    removed.push(path);
  });
  return { trash, release: () => gate.resolve(), removed };
}

/** Wait for what the background goes on to do, without starting a pass of
 * the test's own (which would empty the trash itself). The default fails
 * before bun's own 5 s test timeout, with this message. */
async function eventually(
  check: () => Promise<boolean>,
  timeoutMs = 4_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error(`still not so after ${timeoutMs} ms`);
    }
    await Bun.sleep(10);
  }
}

async function trashEntries(trash: WorkspaceTrash): Promise<string[]> {
  return (await readdir(trash.dir)).sort();
}

describe('DockerSessionBackend stop/destroy honour the rm result', () => {
  test('pressure stops the observed immutable container and preserves its workspace', async () => {
    await fakeDocker({ present: true, rm: 'ok' });
    const workspace = join(hostSessionRoot, 'ses-pressure');
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, 'keep.txt'), 'user data');
    const backend = new DockerSessionBackend(backendConfig());
    expect(await backend.stopSession('pressure', 1_700_000_000_000)).toBe(true);
    expect(await readFile(join(fakeRoot, 'last-rm'), 'utf8')).toContain(
      'abcdef123456',
    );
    expect(await readFile(join(fakeRoot, 'last-rm'), 'utf8')).not.toContain(
      'tale-sbx-ses-pressure',
    );
    expect(await readFile(join(workspace, 'keep.txt'), 'utf8')).toBe(
      'user data',
    );
  });

  test('an idle stop retry cannot remove a newer incarnation with the same name', async () => {
    await fakeDocker({ present: true, rm: 'ok' });
    await writeFile(join(fakeRoot, 'last-rm'), 'untouched');
    const backend = new DockerSessionBackend(backendConfig());
    const error = await rejection(
      backend.stopSession('replacement', 1_600_000_000_000),
    );
    expect(error?.message).toContain('changed before idle stop');
    expect(await readFile(join(fakeRoot, 'last-rm'), 'utf8')).toBe('untouched');
  });

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

  test('a failed removal of the inner image volume is reported, never silent', async () => {
    // The fake CLI answers `volume rm` with a non-zero exit.
    await fakeDocker({ present: true, rm: 'ok' });
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      const backend = new DockerSessionBackend({
        ...backendConfig(),
        dockerInContainer: true,
      });
      expect(await backend.stopSession('dind-volume-kept')).toBe(true);
    } finally {
      console.warn = warn;
    }
    expect(
      warnings.some((line) =>
        line.includes(
          'dind volume rm tale-dind-dind-volume-kept failed (exit 2)',
        ),
      ),
    ).toBe(true);
  });

  test('stopSession is idempotent: an already-gone container resolves false without throwing', async () => {
    await fakeDocker({ present: false, rm: 'nosuch' });
    const backend = new DockerSessionBackend(backendConfig());
    expect(await backend.stopSession('rm-gone')).toBe(false);
  });

  test("destroySession answers true for a stopped session's workspace alone", async () => {
    // What the workspace cleanup deletes: the reaper removed the container
    // long ago and kept the data, so the workspace IS the session — its
    // deletion must not read as "nothing existed".
    await fakeDocker({ present: false, rm: 'nosuch' });
    const workspace = join(hostSessionRoot, 'ses-destroy-stopped');
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, 'left.txt'), 'what the last run left');
    const owner = join(hostSessionRoot, '.owners', 'destroy-stopped.org');
    await mkdir(join(hostSessionRoot, '.owners'), { recursive: true });
    await writeFile(owner, 'org_stopped\n');
    const backend = new DockerSessionBackend(backendConfig());
    expect(await backend.destroySession('destroy-stopped')).toBe(true);
    expect(await exists(workspace)).toBe(false);
    // The record of whose it was goes with it.
    expect(await exists(owner)).toBe(false);
    // Nothing left under the id: idempotent, and now truly nothing existed.
    expect(await backend.destroySession('destroy-stopped')).toBe(false);
  });

  test('destroySession THROWS on a failed rm and leaves the workspace intact', async () => {
    await fakeDocker({ present: true, rm: 'busy' });
    const workspace = join(hostSessionRoot, 'ses-destroy-busy');
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, 'keep.txt'), 'user data');
    const owner = join(hostSessionRoot, '.owners', 'destroy-busy.org');
    await mkdir(join(hostSessionRoot, '.owners'), { recursive: true });
    await writeFile(owner, 'org_busy\n');
    const backend = new DockerSessionBackend(backendConfig());
    const err = await rejection(backend.destroySession('destroy-busy'));
    expect(err?.message).toMatch(/docker rm tale-sbx-ses-destroy-busy failed/);
    // A container that may still be running keeps its bind-mounted data, and
    // the workspace still names its organization.
    expect(await exists(join(workspace, 'keep.txt'))).toBe(true);
    expect(await exists(owner)).toBe(true);
  });

  test('destroySession THROWS when the workspace can be neither moved aside nor deleted (never a laundered destroyed:true)', async () => {
    // The container half is already gone (idempotent); the data half fails:
    // the trash cannot take the dir (a read-only trash stands in for another
    // filesystem or a full disk), and deleting it in place hits EACCES on a
    // read-only parent. Before the fix this was warn + resolve, so the route
    // answered destroyed:true while the user's data lived on.
    await fakeDocker({ present: false, rm: 'nosuch' });
    const root = await freshRoot();
    const trash = new WorkspaceTrash(root);
    const workspace = join(root, 'ses-destroy-eacces');
    await mkdir(join(workspace, 'sub'), { recursive: true });
    await writeFile(join(workspace, 'sub', 'keep.txt'), 'user data');
    await mkdir(trash.dir, { mode: 0o555 });
    await chmod(join(workspace, 'sub'), 0o555);
    try {
      const backend = new DockerSessionBackend(rootedConfig(root), trash);
      const err = await rejection(backend.destroySession('destroy-eacces'));
      expect(err?.message).toMatch(
        /destroy destroy-eacces: container removed but workspace .* could not be deleted/,
      );
      expect(await exists(join(workspace, 'sub', 'keep.txt'))).toBe(true);
      expect(await trashEntries(trash)).toEqual([]);
    } finally {
      await chmod(join(workspace, 'sub'), 0o755);
      await chmod(trash.dir, 0o755);
    }
  });
});

// The platform gives a destroy 30 s, and deleting a workspace of tens of GB in
// over a million files on network block storage takes far longer: the destroy
// timed out, the platform kept its row while the spawner deleted on. So a
// destroy only renames the workspace into the session root's trash and
// answers; the trash is emptied in the background, and at the next start for
// whatever a restart cut short.
describe('DockerSessionBackend.destroySession hands the workspace to the trash', () => {
  test('answers before a large workspace is deleted, and the deletion follows in the background', async () => {
    await fakeDocker({ present: false, rm: 'nosuch' });
    const root = await freshRoot();
    const held = heldTrash(root);
    const workspace = join(root, 'ses-large');
    const planted = await plantWorkspace(workspace, 40, 50);
    const backend = new DockerSessionBackend(rootedConfig(root), held.trash);
    const routes = new SessionRoutes(rootedConfig(root), backend);

    // `DELETE /v1/sessions/large`. The deletion is held, so a destroy that
    // waited for it could not answer at all.
    const answered = await Promise.race([
      routes.handleDestroy('large'),
      Bun.sleep(2_000).then(() => null),
    ]);
    expect(answered?.status).toBe(200);
    expect(await answered?.json()).toEqual({ destroyed: true, busy: false });
    // Gone under its name, every file still on disk in the trash.
    expect(await exists(workspace)).toBe(false);
    const entries = await trashEntries(held.trash);
    expect(entries).toHaveLength(1);
    const entry = join(held.trash.dir, entries[0] ?? '');
    expect(entries[0]).toMatch(/^ses-large\./);
    expect(await countFiles(entry)).toBe(planted);

    held.release();
    await eventually(async () => !(await exists(entry)), 20_000);
    expect(held.removed).toEqual([entry]);
    expect(await trashEntries(held.trash)).toEqual([]);
  }, 30_000);

  test('a second destroy finds nothing left to do, while the first one is still being deleted and after', async () => {
    await fakeDocker({ present: false, rm: 'nosuch' });
    const root = await freshRoot();
    const held = heldTrash(root);
    await plantWorkspace(join(root, 'ses-twice'), 2, 5);
    await mkdir(join(root, '.owners'));
    await writeFile(join(root, '.owners', 'twice.org'), 'org_twice\n');
    const backend = new DockerSessionBackend(rootedConfig(root), held.trash);
    await backend.setPinned('twice', true);

    expect(await backend.destroySession('twice')).toBe(true);
    const entries = await trashEntries(held.trash);
    expect(entries).toHaveLength(1);
    // The retry after a lost answer: nothing is under the id any more, and the
    // deletion under way is neither repeated nor disturbed.
    expect(await backend.destroySession('twice')).toBe(false);
    expect(await trashEntries(held.trash)).toEqual(entries);
    // Its pin and the record of whose it was went with the first destroy.
    expect(await exists(join(root, '.pins', 'twice.pinned'))).toBe(false);
    expect(await exists(join(root, '.owners', 'twice.org'))).toBe(false);

    held.release();
    await eventually(async () => (await trashEntries(held.trash)).length === 0);
    expect(held.removed).toHaveLength(1);
    expect(await backend.destroySession('twice')).toBe(false);
    expect(await trashEntries(held.trash)).toEqual([]);
  });

  test('the id is free at once: a new workspace under it is a fresh create, and destroying it too keeps the two apart', async () => {
    await fakeDocker({ present: false, rm: 'nosuch' });
    const root = await freshRoot();
    const held = heldTrash(root);
    const workspace = join(root, 'ses-reborn');
    await mkdir(workspace);
    await writeFile(join(workspace, 'old.txt'), 'the destroyed session');
    const backend = new DockerSessionBackend(rootedConfig(root), held.trash);

    expect(await backend.destroySession('reborn')).toBe(true);
    // Nothing of the old workspace is under the name: the next create of the
    // id lays out a fresh one instead of resuming onto data being deleted.
    expect(await backend.hasWorkspace('reborn')).toBe(false);
    await mkdir(workspace);
    await writeFile(join(workspace, 'fresh.txt'), 'the new session');

    // Destroying the new session while the old one is still being deleted.
    expect(await backend.destroySession('reborn')).toBe(true);
    const entries = await trashEntries(held.trash);
    expect(entries).toHaveLength(2);
    const trees = await Promise.all(
      entries.map((entry) => readdir(join(held.trash.dir, entry))),
    );
    expect(trees.flat().sort()).toEqual(['fresh.txt', 'old.txt']);

    held.release();
    await eventually(async () => (await trashEntries(held.trash)).length === 0);
  });

  test('deleting the old workspace never touches a new one under the same id', async () => {
    await fakeDocker({ present: false, rm: 'nosuch' });
    const root = await freshRoot();
    const held = heldTrash(root);
    const workspace = join(root, 'ses-kept');
    await plantWorkspace(workspace, 3, 10);
    const backend = new DockerSessionBackend(rootedConfig(root), held.trash);

    expect(await backend.destroySession('kept')).toBe(true);
    await mkdir(workspace);
    await writeFile(join(workspace, 'fresh.txt'), 'the new session');
    held.release();
    await eventually(async () => (await trashEntries(held.trash)).length === 0);

    expect(await readdir(workspace)).toEqual(['fresh.txt']);
    expect(await backend.hasWorkspace('kept')).toBe(true);
  });

  test('a workspace the trash cannot take is deleted in place before the answer', async () => {
    await fakeDocker({ present: false, rm: 'nosuch' });
    const root = await freshRoot();
    const trash = new WorkspaceTrash(root);
    const workspace = join(root, 'ses-in-place');
    await plantWorkspace(workspace, 2, 5);
    // A read-only trash stands in for one on another filesystem, or a disk
    // too full for another directory entry.
    await mkdir(trash.dir, { mode: 0o555 });
    try {
      const backend = new DockerSessionBackend(rootedConfig(root), trash);
      expect(await backend.destroySession('in-place')).toBe(true);
      expect(await exists(workspace)).toBe(false);
      expect(await trashEntries(trash)).toEqual([]);
    } finally {
      await chmod(trash.dir, 0o755);
    }
  });

  test('the next start empties what a restart or crash left in the trash, and nothing beside it', async () => {
    // `docker ps` lists nothing: the boot sweep has no container to reap.
    await fakeDocker({ present: false, rm: 'nosuch' });
    const root = await freshRoot();
    const trashDir = join(root, '.trash');
    // A deletion cut short halfway, and one that never started.
    await plantWorkspace(join(trashDir, `ses-cut.${randomUUID()}`), 5, 20);
    await plantWorkspace(join(trashDir, `ses-queued.${randomUUID()}`), 1, 3);
    // What the start must keep: a stopped session's workspace and the
    // bookkeeping beside it.
    await plantWorkspace(join(root, 'ses-stopped'), 1, 3);
    await mkdir(join(root, '.pins'));
    await writeFile(join(root, '.pins', 'stopped.pinned'), '1\n');

    const host = new DockerBackend(rootedConfig(root));
    await host.init();
    try {
      // Nothing here starts a pass: the boot did.
      await eventually(async () => (await readdir(trashDir)).length === 0);
      expect(await countFiles(join(root, 'ses-stopped'))).toBe(3);
      expect(await exists(join(root, '.pins', 'stopped.pinned'))).toBe(true);
      // A destroy after the start hands its workspace to that same trash.
      const backend = new DockerSessionBackend(rootedConfig(root));
      expect(await backend.destroySession('stopped')).toBe(true);
      expect(await exists(join(root, 'ses-stopped'))).toBe(false);
      await workspaceTrash(root).empty();
      expect(await readdir(trashDir)).toEqual([]);
    } finally {
      await host.shutdown();
    }
  });
});

describe('DockerSessionBackend.listSessions', () => {
  test('THROWS on a failed `docker ps` instead of reporting "no sessions"', async () => {
    // A daemon blip laundered into [] would leave every running session
    // unregistered (unroutable, never reaped) until the next successful list.
    await fakeDocker({ present: true, rm: 'ok', listed: ['a'], ps: 'fail' });
    const backend = new DockerSessionBackend(backendConfig());
    const err = await rejection(backend.listSessions());
    expect(err?.message).toMatch(/docker ps \(sessions\) failed \(exit 1\)/);
    expect(err?.message).toMatch(/Cannot connect to the Docker daemon/);
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
