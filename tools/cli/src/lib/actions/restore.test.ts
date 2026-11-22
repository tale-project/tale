import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DeploymentEnv } from '../../utils/load-env';
import { createModuleMocks } from '../../utils/module-mock-fixture';
import {
  resolveOutputMode,
  setActiveOutputMode,
} from '../../utils/output-mode';
import { createSnapshot } from '../backup/create-snapshot';
import {
  incusBackupFixture,
  type IncusBackupFixture,
} from '../backup/incus-backup-fixture';
import { SPLIT, THREE_WAY, UNIFIED, type AppTier } from '../compose/app-tier';
import { setProjectId } from '../project/project-context';
import { FakeRuntime } from '../runtime/fake-runtime';
import { restore, type RestoreDeps } from './restore';

// The Incus runtime needs a POSIX host and is refused on Windows
// (assertIncusPlatform): its plan key, journal, credentials and copies are
// held by owner and mode, which Windows files do not carry.
const describePosix = describe.skipIf(process.platform === 'win32');

// Seed the shared project-context singleton instead of mocking load-env —
// bun's mock.module leaks across test files in one process.
setProjectId('tale');

const listSnapshotsMock = mock();
const resolveSnapshotPrefixMock = mock();
const verifySnapshotMock = mock();
const getContainerStateMock = mock();
const listComposeContainersMock = mock();
const stopContainerMock = mock();
const ensureVolumesMock = mock();
const volumeExistsMock = mock();
const execMock = mock();
const confirmMock = mock();
const loggerInfoMock = mock();
const loggerNoticeMock = mock();
const loggerWarnMock = mock();
/** The shapes of the workspace's colours, and what the snapshot's release
 *  image says; three services and an image that is not here unless a test
 *  says otherwise. */
const colourTiersMock = mock(async (): Promise<AppTier[]> => [THREE_WAY]);
const releaseServesAppMock = mock(
  async (_version: string): Promise<boolean | null> => null,
);
const loggerTableMock = mock();

// Bun's module mocks are process-wide: each one is put back once this suite
// ends, so a later suite in the same process meets the real module.
const { mockModule } = createModuleMocks(import.meta.dir);
await mockModule('../docker/ensure-volumes', () => ({
  ensureVolumes: ensureVolumesMock,
  volumeExists: volumeExistsMock,
}));
await mockModule('../docker/exec', () => ({ exec: execMock }));
await mockModule('../../utils/prompt', () => ({ confirm: confirmMock }));
await mockModule('../../utils/logger', () => ({
  info: loggerInfoMock,
  error: mock(),
  warn: loggerWarnMock,
  step: mock(),
  success: mock(),
  header: mock(),
  blank: mock(),
  debug: mock(),
  notice: loggerNoticeMock,
  table: loggerTableMock,
}));

// The collaborators restore drives are INJECTED, not module-mocked: bun's
// mock.module is process-wide, and mocking `../backup/list-snapshots` or
// `../backup/verify-snapshot` here leaked into those modules' own test files
// whenever this file ran first (the sorted order macOS and Windows use),
// handing them a mock where they test the real implementation.
const deps: RestoreDeps = {
  listSnapshots: listSnapshotsMock,
  resolveSnapshotPrefix: resolveSnapshotPrefixMock,
  verifySnapshot: verifySnapshotMock,
  getContainerState: getContainerStateMock,
  // A colour's replicas are compose-numbered, so the running-stack probe
  // finds them by project label rather than by name.
  listComposeContainers: listComposeContainersMock,
  stopContainer: stopContainerMock,
  colourTiers: colourTiersMock,
  releaseServesApp: releaseServesAppMock,
};
const run = (options: Parameters<typeof restore>[0]) => restore(options, deps);

const env: DeploymentEnv = {
  GHCR_REGISTRY: 'ghcr.io/tale-project/tale',
  SITE_URL: 'https://localhost',
  HEALTH_CHECK_TIMEOUT: 1,
  DRAIN_TIMEOUT: 0,
  DEPLOY_DIR: '',
};

/**
 * A snapshot from before blobs were captured: no `object-store-data`
 * archive. It also predates the config-volume rename, so its config tree is
 * filed as `convex-data.tar.gz` — the alias every restore has to keep
 * honouring, or an upgraded deployment silently restores with no org config.
 */
const MANIFEST = {
  id: '20260611-120000-deploy',
  createdAt: '2026-06-11T12:00:00.000Z',
  cliVersion: '1.0.0',
  platformVersion: '0.9.6',
  trigger: 'deploy',
  volumes: {
    'db-data': { sha256: 'a'.repeat(64), sizeBytes: 1024 },
    'convex-data': { sha256: 'b'.repeat(64), sizeBytes: 2048 },
  },
};

/** A snapshot taken after the rename: the config tree is `config-data`. */
const MANIFEST_RENAMED = {
  ...MANIFEST,
  id: '20260907-100000-deploy',
  createdAt: '2026-09-07T10:00:00.000Z',
  volumes: {
    'db-data': { sha256: 'a'.repeat(64), sizeBytes: 1024 },
    'config-data': { sha256: 'b'.repeat(64), sizeBytes: 2048 },
  },
};

/** A torn snapshot: no config archive under either name. */
const MANIFEST_NO_CONFIG = {
  ...MANIFEST,
  id: '20260907-110000-manual',
  createdAt: '2026-09-07T11:00:00.000Z',
  trigger: 'manual',
  volumes: {
    'db-data': { sha256: 'a'.repeat(64), sizeBytes: 1024 },
  },
};

const MANIFEST_WITH_BLOBS = {
  ...MANIFEST,
  id: '20260903-090000-manual',
  createdAt: '2026-09-03T09:00:00.000Z',
  trigger: 'manual',
  volumes: {
    ...MANIFEST.volumes,
    'object-store-data': { sha256: 'c'.repeat(64), sizeBytes: 4096 },
  },
};

/** A snapshot that captured the model gateway's store. */
const MANIFEST_WITH_GATEWAY = {
  ...MANIFEST_RENAMED,
  id: '20260930-080000-deploy',
  createdAt: '2026-09-30T08:00:00.000Z',
  platformVersion: '0.5.64',
  volumes: {
    ...MANIFEST_RENAMED.volumes,
    'llm-gateway-data': { sha256: 'd'.repeat(64), sizeBytes: 8192 },
  },
};

function restoreScripts(): string[] {
  return execMock.mock.calls.map((call) => call[1][call[1].length - 1]);
}

beforeEach(() => {
  // Use a real local lock without replacing the shared module for other suites.
  env.DEPLOY_DIR = mkdtempSync(join(tmpdir(), 'tale-restore-test-'));
});

afterEach(() => {
  listSnapshotsMock.mockReset();
  resolveSnapshotPrefixMock.mockReset();
  verifySnapshotMock.mockReset();
  getContainerStateMock.mockReset();
  listComposeContainersMock.mockReset();
  listComposeContainersMock.mockResolvedValue([]);
  stopContainerMock.mockReset();
  ensureVolumesMock.mockReset();
  execMock.mockReset();
  confirmMock.mockReset();
  volumeExistsMock.mockReset();
  loggerInfoMock.mockReset();
  loggerNoticeMock.mockReset();
  loggerWarnMock.mockReset();
  loggerTableMock.mockReset();
  colourTiersMock.mockReset();
  colourTiersMock.mockImplementation(async () => [THREE_WAY]);
  releaseServesAppMock.mockReset();
  releaseServesAppMock.mockImplementation(async () => null);
  rmSync(env.DEPLOY_DIR, { recursive: true, force: true });
});

describe('restore', () => {
  test('lists snapshots when no id is given', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);

    await run({ env });

    expect(loggerTableMock).toHaveBeenCalled();
    expect(execMock).not.toHaveBeenCalled();
  });

  test('rejects an id with shell metacharacters before touching anything', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);

    await expect(run({ env, snapshotId: '$(rm -rf /backup)' })).rejects.toThrow(
      'Invalid snapshot id',
    );
    expect(execMock).not.toHaveBeenCalled();
  });

  test('rejects an unknown snapshot id', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);

    await expect(
      run({ env, snapshotId: '20990101-000000-manual' }),
    ).rejects.toThrow('not found');
    expect(execMock).not.toHaveBeenCalled();
  });

  test('refuses while project containers are running without --stop', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);
    getContainerStateMock.mockImplementation((name: string) =>
      Promise.resolve(name === 'tale-db' ? 'running' : null),
    );

    await expect(
      run({ env, snapshotId: MANIFEST.id, assumeYes: true }),
    ).rejects.toThrow(
      'Refusing to restore while project containers are live: tale-db (running).',
    );
    expect(execMock).not.toHaveBeenCalled();
    expect(stopContainerMock).not.toHaveBeenCalled();
  });

  test('stops the stack with --stop, verifies, and restores each volume', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);
    getContainerStateMock.mockImplementation((name: string) =>
      Promise.resolve(name === 'tale-db' ? 'running' : null),
    );
    stopContainerMock.mockResolvedValue(true);
    verifySnapshotMock.mockResolvedValue(undefined);
    ensureVolumesMock.mockResolvedValue(true);
    execMock.mockResolvedValue({
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    await run({
      env,
      snapshotId: MANIFEST.id,
      stop: true,
      assumeYes: true,
    });

    expect(stopContainerMock).toHaveBeenCalledWith('tale-db');
    // The bgutil-provider sidecar is a stop candidate like the stateful tier:
    // left running it keeps the volumes' network alive across the restore.
    expect(getContainerStateMock).toHaveBeenCalledWith('tale-bgutil-provider');
    expect(verifySnapshotMock).toHaveBeenCalledWith('tale_', MANIFEST);
    // One wipe+extract per volume in the manifest.
    expect(execMock).toHaveBeenCalledTimes(2);
    const scripts = execMock.mock.calls.map(
      (call) => call[1][call[1].length - 1],
    );
    expect(scripts[0]).toContain('find /data -mindepth 1 -delete');
    expect(scripts[0]).toContain(`${MANIFEST.id}/db-data.tar.gz`);
    // Prints the redeploy-the-matching-version runbook.
    const infoLines = loggerInfoMock.mock.calls.map((call) => String(call[0]));
    expect(
      infoLines.some((line) => line.includes('tale update --version 0.9.6')),
    ).toBe(true);
  });

  // The data of another release comes back under that release's CLI, and a
  // CLI from before the application ran as one process deploys only over the
  // three services.
  describe('across releases, on a workspace that runs fewer than three services', () => {
    const arrange = (): void => {
      resolveSnapshotPrefixMock.mockResolvedValue('tale_');
      listSnapshotsMock.mockResolvedValue([MANIFEST]);
      getContainerStateMock.mockImplementation((name: string) =>
        Promise.resolve(name === 'tale-db' ? 'running' : null),
      );
      stopContainerMock.mockResolvedValue(true);
      verifySnapshotMock.mockResolvedValue(undefined);
      ensureVolumesMock.mockResolvedValue(true);
      execMock.mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
    };
    const restoring = () =>
      run({ env, snapshotId: MANIFEST.id, stop: true, assumeYes: true });
    /** What the restore warned about the release's CLI, among its warnings. */
    const warnings = () =>
      loggerWarnMock.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('holds the data of Tale'));

    for (const [name, tier, services] of [
      ['one process', UNIFIED, 'platform'],
      ['the job runners apart', SPLIT, 'platform and backend-worker'],
    ] as const)
      test(`refuses while nothing is changed where the release runs three services (${name})`, async () => {
        arrange();
        colourTiersMock.mockImplementation(async () => [tier]);
        releaseServesAppMock.mockImplementation(async () => false);

        await expect(restoring()).rejects.toThrow(
          `Snapshot ${MANIFEST.id} holds the data of Tale 0.9.6, whose CLI deploys only over the services platform, backend-api and backend-worker. This workspace runs the application as ${services}, which that CLI refuses once the data is restored. First set TALE_APP_TIER=three-services in .env and run \`tale deploy\`, then restore. Nothing was changed.`,
        );

        expect(releaseServesAppMock).toHaveBeenCalledWith('0.9.6');
        expect(stopContainerMock).not.toHaveBeenCalled();
        expect(verifySnapshotMock).not.toHaveBeenCalled();
        expect(execMock).not.toHaveBeenCalled();
      });

    test('restores where the release runs as one process too', async () => {
      arrange();
      colourTiersMock.mockImplementation(async () => [UNIFIED]);
      releaseServesAppMock.mockImplementation(async () => true);
      await restoring();
      expect(execMock).toHaveBeenCalledTimes(2);
      expect(warnings()).toEqual([]);
    });

    test('says what to check, and goes on, where the release image is not on the host to ask', async () => {
      arrange();
      colourTiersMock.mockImplementation(async () => [UNIFIED]);
      await restoring();
      expect(execMock).toHaveBeenCalledTimes(2);
      expect(warnings()).toEqual([
        expect.stringContaining(
          "that release's image is not on this host to say which services it runs",
        ),
      ]);
      expect(warnings()[0]).toContain('TALE_APP_TIER=three-services');
    });

    test('one colour of fewer services is enough, mid-flip', async () => {
      arrange();
      colourTiersMock.mockImplementation(async () => [THREE_WAY, UNIFIED]);
      releaseServesAppMock.mockImplementation(async () => false);
      await expect(restoring()).rejects.toThrow('Nothing was changed.');
    });

    test('a workspace of three services is never asked', async () => {
      arrange();
      releaseServesAppMock.mockImplementation(async () => false);
      await restoring();
      expect(releaseServesAppMock).not.toHaveBeenCalled();
      expect(execMock).toHaveBeenCalledTimes(2);
    });

    test('nor is a snapshot of the release this CLI is, or one that names none', async () => {
      const pkg = await import('../../../package.json');
      for (const platformVersion of [pkg.version, null]) {
        arrange();
        execMock.mockClear();
        listSnapshotsMock.mockResolvedValue([{ ...MANIFEST, platformVersion }]);
        colourTiersMock.mockImplementation(async () => [UNIFIED]);
        releaseServesAppMock.mockImplementation(async () => false);
        await restoring();
        expect(execMock).toHaveBeenCalledTimes(2);
      }
      expect(colourTiersMock).not.toHaveBeenCalled();
    });
  });

  test('treats the global `tale -y` as consent when the local flag is absent', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);
    getContainerStateMock.mockResolvedValue(null);
    verifySnapshotMock.mockResolvedValue(undefined);
    ensureVolumesMock.mockResolvedValue(true);
    execMock.mockResolvedValue({
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    setActiveOutputMode(resolveOutputMode({ yes: true }, {}));
    try {
      await run({ env, snapshotId: MANIFEST.id });
    } finally {
      setActiveOutputMode(resolveOutputMode({}, {}));
    }

    expect(confirmMock).not.toHaveBeenCalled();
    expect(verifySnapshotMock).toHaveBeenCalledTimes(1);
  });

  test('aborts when the confirmation prompt is declined', async () => {
    resolveSnapshotPrefixMock.mockResolvedValue('tale_');
    listSnapshotsMock.mockResolvedValue([MANIFEST]);
    getContainerStateMock.mockResolvedValue(null);
    confirmMock.mockResolvedValue(false);

    await expect(run({ env, snapshotId: MANIFEST.id })).rejects.toThrow(
      'Restore aborted',
    );
    expect(verifySnapshotMock).not.toHaveBeenCalled();
    expect(execMock).not.toHaveBeenCalled();
  });

  // A colour replica runs under `unless-stopped`: one that crashes waits out
  // Docker's backoff as `restarting` and then starts again on its own, and a
  // `paused` one resumes on `docker unpause`. Either can reach the volumes
  // while the snapshot is extracted into them, so neither may pass for
  // stopped just because its state is not the word `running`.
  describe('a colour replica that is not plainly running', () => {
    /** A replica as `listComposeContainers` reports it. */
    const replica = (name: string, service: string, state: string) => ({
      name,
      service,
      index: 1,
      running: state === 'running',
      state,
    });

    const colours = (byProject: Record<string, ReturnType<typeof replica>[]>) =>
      listComposeContainersMock.mockImplementation((project: string) =>
        Promise.resolve(byProject[project] ?? []),
      );

    const restoreReady = () => {
      resolveSnapshotPrefixMock.mockResolvedValue('tale_');
      listSnapshotsMock.mockResolvedValue([MANIFEST]);
      getContainerStateMock.mockResolvedValue(null);
      verifySnapshotMock.mockResolvedValue(undefined);
      ensureVolumesMock.mockResolvedValue(true);
      execMock.mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
    };

    test('makes the restore refuse without --stop, named with its state', async () => {
      restoreReady();
      colours({
        'tale-blue': [
          replica('tale-blue-backend-api-1', 'backend-api', 'restarting'),
        ],
      });

      await expect(
        run({ env, snapshotId: MANIFEST.id, assumeYes: true }),
      ).rejects.toThrow(
        'Refusing to restore while project containers are live: tale-blue-backend-api-1 (restarting).',
      );
      expect(stopContainerMock).not.toHaveBeenCalled();
      expect(verifySnapshotMock).not.toHaveBeenCalled();
      expect(execMock).not.toHaveBeenCalled();
    });

    test('is stopped by --stop before anything is extracted', async () => {
      restoreReady();
      colours({
        'tale-blue': [
          replica('tale-blue-backend-api-1', 'backend-api', 'restarting'),
          replica('tale-blue-backend-worker-1', 'backend-worker', 'exited'),
        ],
        'tale-green': [replica('tale-green-platform-1', 'platform', 'paused')],
      });
      const order: string[] = [];
      stopContainerMock.mockImplementation((name: string) => {
        order.push(`stop ${name}`);
        return Promise.resolve(true);
      });
      execMock.mockImplementation(() => {
        order.push('extract');
        return Promise.resolve({
          success: true,
          stdout: '',
          stderr: '',
          exitCode: 0,
        });
      });

      await run({ env, snapshotId: MANIFEST.id, stop: true, assumeYes: true });

      // The exited replica has nothing to stop; the other two are stopped,
      // and both before the first volume is touched.
      expect(order).toEqual([
        'stop tale-blue-backend-api-1',
        'stop tale-green-platform-1',
        'extract',
        'extract',
      ]);
    });

    test('aborts the restore before any extract when its stop fails', async () => {
      restoreReady();
      colours({
        'tale-blue': [
          replica('tale-blue-backend-api-1', 'backend-api', 'restarting'),
        ],
      });
      stopContainerMock.mockResolvedValue(false);

      await expect(
        run({ env, snapshotId: MANIFEST.id, stop: true, assumeYes: true }),
      ).rejects.toThrow(
        'Failed to stop tale-blue-backend-api-1 — aborting restore.',
      );
      expect(verifySnapshotMock).not.toHaveBeenCalled();
      expect(execMock).not.toHaveBeenCalled();
    });

    test('counts as live in every state but created, exited and dead', async () => {
      restoreReady();
      colours({
        'tale-blue': [
          replica('tale-blue-backend-api-1', 'backend-api', 'running'),
          replica('tale-blue-backend-api-2', 'backend-api', 'restarting'),
          replica('tale-blue-backend-api-3', 'backend-api', 'paused'),
          replica('tale-blue-backend-api-4', 'backend-api', 'removing'),
          // A state a newer Docker might add is live until proven otherwise.
          replica('tale-blue-backend-api-5', 'backend-api', 'hibernating'),
        ],
        'tale-green': [
          replica('tale-green-backend-api-1', 'backend-api', 'created'),
          replica('tale-green-backend-api-2', 'backend-api', 'exited'),
          replica('tale-green-backend-api-3', 'backend-api', 'dead'),
        ],
      });

      await expect(
        run({ env, snapshotId: MANIFEST.id, assumeYes: true }),
      ).rejects.toThrow(
        'Refusing to restore while project containers are live: ' +
          'tale-blue-backend-api-1 (running), ' +
          'tale-blue-backend-api-2 (restarting), ' +
          'tale-blue-backend-api-3 (paused), ' +
          'tale-blue-backend-api-4 (removing), ' +
          'tale-blue-backend-api-5 (hibernating).',
      );
      expect(execMock).not.toHaveBeenCalled();
    });

    // The pinned names were judged by `{{.State.Running}}`, the colours by
    // `{{.State}} === 'running'`; both now answer the same question.
    test('is judged like a pinned container, by the same predicate', async () => {
      restoreReady();
      const pinned: Record<string, string> = {
        'tale-db': 'restarting',
        'tale-object-store': 'exited',
        'tale-proxy': 'paused',
        'tale-sandbox-llm-gateway': 'created',
        'tale-bgutil-provider': 'dead',
        // The dev stack pins its rotatable services' names.
        'tale-platform': 'running',
      };
      getContainerStateMock.mockImplementation((name: string) =>
        Promise.resolve(pinned[name] ?? null),
      );
      colours({
        'tale-green': [
          replica(
            'tale-green-backend-worker-1',
            'backend-worker',
            'restarting',
          ),
        ],
      });

      await expect(
        run({ env, snapshotId: MANIFEST.id, assumeYes: true }),
      ).rejects.toThrow(
        'Refusing to restore while project containers are live: ' +
          'tale-db (restarting), tale-proxy (paused), tale-platform (running), ' +
          'tale-green-backend-worker-1 (restarting).',
      );
      expect(execMock).not.toHaveBeenCalled();
    });
  });

  describe('the blob archive', () => {
    test('is restored into the blob volume when the snapshot carries one', async () => {
      resolveSnapshotPrefixMock.mockResolvedValue('tale_');
      listSnapshotsMock.mockResolvedValue([MANIFEST_WITH_BLOBS, MANIFEST]);
      getContainerStateMock.mockResolvedValue(null);
      verifySnapshotMock.mockResolvedValue(undefined);
      ensureVolumesMock.mockResolvedValue(true);
      execMock.mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      await run({
        env,
        snapshotId: MANIFEST_WITH_BLOBS.id,
        assumeYes: true,
      });

      // The blob volume is re-created alongside the others on a fresh host.
      expect(ensureVolumesMock).toHaveBeenCalledWith(
        expect.arrayContaining(['object-store-data']),
        'tale_',
      );
      // One wipe+extract per volume — the blob archive included.
      expect(execMock).toHaveBeenCalledTimes(3);
      const blobRestore = execMock.mock.calls.find((call) =>
        String(call[1][call[1].length - 1]).includes(
          'object-store-data.tar.gz',
        ),
      );
      expect(blobRestore?.[1]).toContain('tale_object-store-data:/data');
      // Blobs are proportional to the store: the extract gets the wider bound.
      expect(blobRestore?.[2]?.timeout).toBeGreaterThan(1800);
      expect(loggerNoticeMock).not.toHaveBeenCalled();
    });

    test('is noted as absent when an older snapshot predates blob capture, and the rest restores', async () => {
      resolveSnapshotPrefixMock.mockResolvedValue('tale_');
      listSnapshotsMock.mockResolvedValue([MANIFEST_WITH_BLOBS, MANIFEST]);
      getContainerStateMock.mockResolvedValue(null);
      verifySnapshotMock.mockResolvedValue(undefined);
      ensureVolumesMock.mockResolvedValue(true);
      execMock.mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      await run({ env, snapshotId: MANIFEST.id, assumeYes: true });

      expect(execMock).toHaveBeenCalledTimes(2);
      expect(
        restoreScripts().some((script) => script.includes('object-store-data')),
      ).toBe(false);
      const notices = loggerNoticeMock.mock.calls.map((call) =>
        String(call[0]),
      );
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('no blob-data archive');
      expect(notices[0]).toContain('left untouched');
    });

    const restoreReady = () => {
      resolveSnapshotPrefixMock.mockResolvedValue('tale_');
      getContainerStateMock.mockResolvedValue(null);
      verifySnapshotMock.mockResolvedValue(undefined);
      ensureVolumesMock.mockResolvedValue(true);
      execMock.mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
    };
    /** A snapshot of a deployment on versitygw: its blobs are `blob-data`. */
    const MANIFEST_ON_VERSITYGW = {
      ...MANIFEST,
      id: '20261122-090000-manual',
      volumes: {
        ...MANIFEST.volumes,
        'blob-data': { sha256: 'd'.repeat(64), sizeBytes: 8192 },
      },
    };

    // versitygw keeps an object's content type and ETag in the file's
    // extended attributes: they come back only from a tar that knows of them.
    test("gets its extended attributes back, from the tar that archived versitygw's volume", async () => {
      restoreReady();
      listSnapshotsMock.mockResolvedValue([MANIFEST_ON_VERSITYGW]);

      await run({
        env,
        snapshotId: MANIFEST_ON_VERSITYGW.id,
        assumeYes: true,
      });

      const blob = execMock.mock.calls.find((call) =>
        String(call[1][call[1].length - 1]).includes('blob-data.tar.gz'),
      );
      expect(blob?.[1]).toContain('tale_blob-data:/data');
      expect(blob?.[1]).toContain(
        'debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587',
      );
      expect(String(blob?.[1].at(-1))).toContain(
        "tar xzf /backup/20261122-090000-manual/blob-data.tar.gz --xattrs --xattrs-include='user.*' -C /data",
      );
      expect(blob?.[2]?.timeout).toBeGreaterThan(1800);
      // The other volumes as before.
      const db = execMock.mock.calls.find((call) =>
        String(call[1][call[1].length - 1]).includes('db-data.tar.gz'),
      );
      expect(db?.[1]).toContain('alpine:3.22');
      expect(String(db?.[1].at(-1))).not.toContain('--xattrs');
      expect(loggerNoticeMock).not.toHaveBeenCalled();
    });

    // The blobs of a snapshot from MinIO's time come back in MinIO's volume.
    // What a later store wrote into `blob-data` would be taken for the live
    // store by the next deploy, beside a database that knows other blobs.
    test("empties versitygw's volume when the snapshot's blobs are MinIO's, and says so before it asks", async () => {
      restoreReady();
      listSnapshotsMock.mockResolvedValue([MANIFEST_WITH_BLOBS]);
      volumeExistsMock.mockImplementation(
        async (name: string) => name === 'tale_blob-data',
      );
      confirmMock.mockResolvedValue(true);

      await run({ env, snapshotId: MANIFEST_WITH_BLOBS.id });

      const warned = loggerWarnMock.mock.calls.map((call) => String(call[0]));
      expect(warned.find((line) => line.startsWith('This wipes'))).toContain(
        'tale_object-store-data, tale_blob-data',
      );
      const scripts = execMock.mock.calls.map((call) => ({
        argv: call[1] as string[],
        script: String(call[1][call[1].length - 1]),
      }));
      const emptied = scripts.at(-1);
      expect(emptied?.script).toBe('find /data -mindepth 1 -delete');
      expect(emptied?.argv).toContain('tale_blob-data:/data');
      // After the blobs are back where MinIO reads them, never before.
      expect(
        scripts.findIndex((entry) =>
          entry.script.includes('object-store-data.tar.gz'),
        ),
      ).toBeLessThan(scripts.length - 1);
    });

    test("leaves versitygw's volume alone when the snapshot carries its blobs, or none", async () => {
      restoreReady();
      volumeExistsMock.mockResolvedValue(true);
      for (const manifest of [MANIFEST_ON_VERSITYGW, MANIFEST]) {
        execMock.mockClear();
        listSnapshotsMock.mockResolvedValue([manifest]);

        await run({ env, snapshotId: manifest.id, assumeYes: true });

        expect(
          execMock.mock.calls.some(
            (call) =>
              String(call[1][call[1].length - 1]) ===
              'find /data -mindepth 1 -delete',
          ),
        ).toBe(false);
      }
    });

    test('says what to do when the emptying fails: the next deploy would pass the restored blobs over', async () => {
      restoreReady();
      listSnapshotsMock.mockResolvedValue([MANIFEST_WITH_BLOBS]);
      volumeExistsMock.mockResolvedValue(true);
      execMock.mockImplementation((_cmd: string, args: string[]) =>
        Promise.resolve(
          String(args[args.length - 1]) === 'find /data -mindepth 1 -delete'
            ? { success: false, stdout: '', stderr: 'device busy', exitCode: 1 }
            : { success: true, stdout: '', stderr: '', exitCode: 0 },
        ),
      );

      await expect(
        run({ env, snapshotId: MANIFEST_WITH_BLOBS.id, assumeYes: true }),
      ).rejects.toThrow(
        /Emptying tale_blob-data failed: device busy[\s\S]*re-run the restore before starting the stack/,
      );
    });

    test('is visible in the listing: snapshots without one are marked', async () => {
      resolveSnapshotPrefixMock.mockResolvedValue('tale_');
      listSnapshotsMock.mockResolvedValue([MANIFEST_WITH_BLOBS, MANIFEST]);

      await run({ env });

      const rows = loggerTableMock.mock.calls[0][0] as [string, string][];
      const byId = new Map(rows);
      expect(byId.get(MANIFEST_WITH_BLOBS.id)).not.toContain('without blobs');
      expect(byId.get(MANIFEST.id)).toContain('without blobs');
    });

    test("in the listing, versitygw's blobs count as blobs too", async () => {
      resolveSnapshotPrefixMock.mockResolvedValue('tale_');
      listSnapshotsMock.mockResolvedValue([MANIFEST_ON_VERSITYGW]);

      await run({ env });

      const rows = loggerTableMock.mock.calls[0][0] as [string, string][];
      expect(new Map(rows).get(MANIFEST_ON_VERSITYGW.id)).not.toContain(
        'without blobs',
      );
    });
  });

  describe('the model gateway archive', () => {
    const restoreReady = () => {
      resolveSnapshotPrefixMock.mockResolvedValue('tale_');
      getContainerStateMock.mockResolvedValue(null);
      verifySnapshotMock.mockResolvedValue(undefined);
      ensureVolumesMock.mockResolvedValue(true);
      execMock.mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
    };

    const warnings = () =>
      loggerWarnMock.mock.calls.map((call) => String(call[0]));

    test('is verified, then restored into the live gateway volume of the same name', async () => {
      listSnapshotsMock.mockResolvedValue([MANIFEST_WITH_GATEWAY]);
      restoreReady();
      const order: string[] = [];
      verifySnapshotMock.mockImplementation(() => {
        order.push('verify');
        return Promise.resolve();
      });
      execMock.mockImplementation(() => {
        order.push('extract');
        return Promise.resolve({
          success: true,
          stdout: '',
          stderr: '',
          exitCode: 0,
        });
      });

      await run({
        env,
        snapshotId: MANIFEST_WITH_GATEWAY.id,
        assumeYes: true,
      });

      expect(order[0]).toBe('verify');
      const gatewayRestore = execMock.mock.calls.find((call) =>
        String(call[1][call[1].length - 1]).includes('llm-gateway-data.tar.gz'),
      );
      expect(gatewayRestore?.[1]).toContain('tale_llm-gateway-data:/data');
      // The same guarded wipe-then-extract as every other volume: nothing is
      // deleted unless the archive is there.
      expect(gatewayRestore?.[1][gatewayRestore[1].length - 1]).toBe(
        `test -f /backup/${MANIFEST_WITH_GATEWAY.id}/llm-gateway-data.tar.gz && find /data -mindepth 1 -delete && tar xzf /backup/${MANIFEST_WITH_GATEWAY.id}/llm-gateway-data.tar.gz -C /data`,
      );
      expect(ensureVolumesMock).toHaveBeenCalledWith(
        expect.arrayContaining(['llm-gateway-data']),
        'tale_',
      );
      expect(execMock).toHaveBeenCalledTimes(3);
      expect(warnings().some((line) => line.includes('llm-gateway-data'))).toBe(
        false,
      );
    });

    // Every snapshot written before the gateway store was captured restores
    // as before, but must not read as a way back to the gateway's old store.
    test('is named as absent by an older snapshot, which leaves the gateway store untouched', async () => {
      listSnapshotsMock.mockResolvedValue([MANIFEST_RENAMED]);
      restoreReady();

      await run({ env, snapshotId: MANIFEST_RENAMED.id, assumeYes: true });

      expect(execMock).toHaveBeenCalledTimes(2);
      expect(
        restoreScripts().some((script) => script.includes('llm-gateway-data')),
      ).toBe(false);
      const gateway = warnings().filter((line) =>
        line.includes('llm-gateway-data'),
      );
      expect(gateway).toHaveLength(1);
      expect(gateway[0]).toContain(
        `Snapshot ${MANIFEST_RENAMED.id} has no llm-gateway-data archive`,
      );
      expect(gateway[0]).toContain('left untouched');
      expect(gateway[0]).toContain(
        'cannot return the model gateway to its store from before a gateway upgrade',
      );
      expect(gateway[0]).toContain(
        "If the gateway was upgraded after this snapshot, put your own copy of tale_llm-gateway-data back before you deploy the snapshot's release.",
      );
    });

    test('is announced before the consent prompt, so the restore can still be declined', async () => {
      listSnapshotsMock.mockResolvedValue([MANIFEST_RENAMED]);
      restoreReady();
      let warnedBeforePrompt = false;
      confirmMock.mockImplementation(() => {
        warnedBeforePrompt = warnings().some((line) =>
          line.includes('no llm-gateway-data archive'),
        );
        return Promise.resolve(false);
      });

      await expect(
        run({ env, snapshotId: MANIFEST_RENAMED.id }),
      ).rejects.toThrow('Restore aborted');
      expect(warnedBeforePrompt).toBe(true);
      expect(execMock).not.toHaveBeenCalled();
    });

    test('is restored only under its exact name, never under a look-alike one', async () => {
      const lookalike = {
        ...MANIFEST_RENAMED,
        volumes: {
          ...MANIFEST_RENAMED.volumes,
          'llm-gateway-data-old': { sha256: 'e'.repeat(64), sizeBytes: 1 },
          'gateway-data': { sha256: 'f'.repeat(64), sizeBytes: 1 },
        },
      };
      listSnapshotsMock.mockResolvedValue([lookalike]);
      restoreReady();

      await run({ env, snapshotId: lookalike.id, assumeYes: true });

      expect(execMock).toHaveBeenCalledTimes(2);
      expect(
        restoreScripts().some((script) => script.includes('gateway-data')),
      ).toBe(false);
    });

    test('is visible in the listing: snapshots without one are marked', async () => {
      resolveSnapshotPrefixMock.mockResolvedValue('tale_');
      listSnapshotsMock.mockResolvedValue([MANIFEST_WITH_GATEWAY, MANIFEST]);

      await run({ env });

      const rows = loggerTableMock.mock.calls[0][0] as [string, string][];
      const byId = new Map(rows);
      expect(byId.get(MANIFEST_WITH_GATEWAY.id)).not.toContain(
        'without gateway',
      );
      expect(byId.get(MANIFEST.id)).toContain('without gateway');
    });
  });

  describe('the config archive', () => {
    const restoreReady = () => {
      resolveSnapshotPrefixMock.mockResolvedValue('tale_');
      getContainerStateMock.mockResolvedValue(null);
      verifySnapshotMock.mockResolvedValue(undefined);
      ensureVolumesMock.mockResolvedValue(true);
      execMock.mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
    };

    // The rename is a copy, not a Docker rename: every snapshot taken before
    // it filed the config tree under the old name. Dropping that archive
    // would restore a deployment whose organizations have no configuration —
    // silently, because the manifest filter is what decides.
    test('extracts a pre-rename convex-data archive into config-data', async () => {
      listSnapshotsMock.mockResolvedValue([MANIFEST]);
      restoreReady();

      await run({ env, snapshotId: MANIFEST.id, assumeYes: true });

      const configRestore = execMock.mock.calls.find((call) =>
        String(call[1][call[1].length - 1]).includes('convex-data.tar.gz'),
      );
      expect(configRestore).toBeDefined();
      // Read from the OLD archive name, written into the LIVE volume.
      expect(configRestore?.[1]).toContain('tale_config-data:/data');
      expect(ensureVolumesMock).toHaveBeenCalledWith(
        expect.arrayContaining(['config-data']),
        'tale_',
      );
    });

    test('extracts a post-rename config-data archive unchanged', async () => {
      listSnapshotsMock.mockResolvedValue([MANIFEST_RENAMED]);
      restoreReady();

      await run({ env, snapshotId: MANIFEST_RENAMED.id, assumeYes: true });

      const configRestore = execMock.mock.calls.find((call) =>
        String(call[1][call[1].length - 1]).includes('config-data.tar.gz'),
      );
      expect(configRestore?.[1]).toContain('tale_config-data:/data');
      expect(
        restoreScripts().some((script) => script.includes('convex-data')),
      ).toBe(false);
    });

    // A missing blob archive is normal (external S3, or an old snapshot); a
    // missing CONFIG archive never is, so it must not pass in silence.
    test('warns loudly when a snapshot carries no config archive at all', async () => {
      listSnapshotsMock.mockResolvedValue([MANIFEST_NO_CONFIG]);
      restoreReady();

      await run({ env, snapshotId: MANIFEST_NO_CONFIG.id, assumeYes: true });

      const warnings = loggerWarnMock.mock.calls.map((call) => String(call[0]));
      expect(
        warnings.some(
          (line) =>
            line.includes('no config-data') && line.includes('incomplete'),
        ),
      ).toBe(true);
      expect(execMock).toHaveBeenCalledTimes(1);
    });
  });
});

describePosix('restore on Incus (design D-29)', () => {
  let fixture: IncusBackupFixture;
  afterEach(() => {
    fixture.remove();
  });

  async function snapshotThenChange(): Promise<string> {
    const manifest = await createSnapshot({
      prefix: '',
      trigger: 'manual',
      platformVersion: '0.5.9',
      runtime: fixture.runtime,
    });
    if (manifest === null) throw new Error('no snapshot');
    fixture.files('db-data').set('/rows', {
      content: 'rows v2',
      mode: '0600',
      uid: 999,
      gid: 999,
      type: 'file',
    });
    return manifest.id;
  }

  test('refuses while the volumes have running users, and with --stop restores into fresh volumes', async () => {
    fixture = incusBackupFixture();
    const id = await snapshotThenChange();
    await expect(
      restore({
        env,
        snapshotId: id,
        assumeYes: true,
        runtime: fixture.runtime,
      }),
    ).rejects.toThrow(
      /Refusing to restore while project containers are live: backend \(running\), db \(running\)/,
    );
    expect(fixture.text('db-data', '/rows')).toBe('rows v2');

    await restore({
      env,
      snapshotId: id,
      stop: true,
      assumeYes: true,
      runtime: fixture.runtime,
    });
    expect(fixture.text('db-data', '/rows')).toBe('rows v1');
    const holders = (await fixture.runtime.listVolumes())
      .map((volume) => volume.name)
      .filter((name) => name.includes('.pre-restore-'));
    expect(holders).toHaveLength(2);
    expect((await fixture.runtime.inspect('db'))?.running).toBe(true);
  });

  test('--resume finishes the restore a crash left pending, and --abort undoes one', async () => {
    let crash = true;
    fixture = incusBackupFixture({
      afterRestoreStep: (volume, step) => {
        if (crash && volume === 'db-data' && step === 'renamed') {
          crash = false;
          throw new Error('killed');
        }
      },
    });
    const id = await snapshotThenChange();
    await expect(
      restore({
        env,
        snapshotId: id,
        stop: true,
        assumeYes: true,
        runtime: fixture.runtime,
      }),
    ).rejects.toThrow('killed');
    await expect(
      restore({
        env,
        snapshotId: id,
        stop: true,
        assumeYes: true,
        runtime: fixture.runtime,
      }),
    ).rejects.toThrow(/is not finished/);
    await restore({ env, resume: true, runtime: fixture.runtime });
    expect(fixture.text('db-data', '/rows')).toBe('rows v1');

    crash = true;
    fixture.files('db-data').set('/rows', {
      content: 'rows v3',
      mode: '0600',
      uid: 999,
      gid: 999,
      type: 'file',
    });
    await expect(
      restore({
        env,
        snapshotId: id,
        stop: true,
        assumeYes: true,
        runtime: fixture.runtime,
      }),
    ).rejects.toThrow('killed');
    await restore({ env, abort: true, runtime: fixture.runtime });
    expect(fixture.text('db-data', '/rows')).toBe('rows v3');
  });

  test('--resume and --abort refuse on Docker, together, and with a snapshot id', async () => {
    fixture = incusBackupFixture();
    await expect(
      run({ env, resume: true, runtime: new FakeRuntime() }),
    ).rejects.toThrow(/Docker restores in place/);
    await expect(
      run({ env, resume: true, abort: true, runtime: fixture.runtime }),
    ).rejects.toThrow(/Choose one/);
    await expect(
      run({
        env,
        abort: true,
        snapshotId: '20261113-100000-manual',
        runtime: fixture.runtime,
      }),
    ).rejects.toThrow(/takes no snapshot id/);
  });
});
