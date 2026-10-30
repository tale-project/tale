import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DeploymentEnv } from '../../utils/load-env';
import {
  resolveOutputMode,
  setActiveOutputMode,
} from '../../utils/output-mode';
import { setProjectId } from '../project/project-context';
import { reset } from './reset';

// Seed the shared project-context singleton instead of mocking load-env —
// bun's mock.module leaks across test files in one process.
setProjectId('tale');

const dockerMock = mock();
const stopContainerMock = mock();
const removeContainerMock = mock();
const confirmMock = mock();
const loggerInfoMock = mock();
const loggerWarnMock = mock();

mock.module('../docker/docker', () => ({ docker: dockerMock }));
mock.module('../docker/stop-container', () => ({
  stopContainer: stopContainerMock,
}));
mock.module('../docker/remove-container', () => ({
  removeContainer: removeContainerMock,
}));
mock.module('../../utils/prompt', () => ({ confirm: confirmMock }));
mock.module('../../utils/logger', () => ({
  info: loggerInfoMock,
  error: mock(),
  warn: loggerWarnMock,
  step: mock(),
  success: mock(),
  header: mock(),
  blank: mock(),
  debug: mock(),
  notice: mock(),
  table: mock(),
}));

const env: DeploymentEnv = {
  BACKEND_UPSTREAM: '',
  GHCR_REGISTRY: 'ghcr.io/tale-project/tale',
  SITE_URL: 'https://localhost',
  HEALTH_CHECK_TIMEOUT: 1,
  DRAIN_TIMEOUT: 0,
  DEPLOY_DIR: '',
};

const PRUNED = { success: true, stdout: '', stderr: '', exitCode: 0 };

/**
 * The volumes `tale deploy` creates for project `tale`: the eleven that
 * #4981 saw survive `reset --all`, without `tale_backups`, which holds the
 * snapshots `tale restore` lists.
 */
const DATA_VOLUMES = [
  'tale_static-assets',
  'tale_platform-data',
  'tale_convex-data',
  'tale_config-data',
  'tale_caddy-data',
  'tale_caddy-config',
  'tale_db-data',
  'tale_db-backup',
  'tale_object-store-data',
  'tale_llm-gateway-data',
];

function failed(stderr: string) {
  return { success: false, stdout: '', stderr, exitCode: 1 };
}

function removedContainers(): string[] {
  return removeContainerMock.mock.calls.map((call) => String(call[0]));
}

/**
 * Docker calls that CHANGE something — `ps` and `volume inspect` are
 * discovery, not actions.
 */
function mutatingDockerCalls(): unknown[][] {
  return dockerMock.mock.calls.filter(
    (call) =>
      call[0] !== 'ps' && !(call[0] === 'volume' && call[1] === 'inspect'),
  );
}

/** What each `docker volume rm` call was asked to delete. */
function volumeRemovals(): unknown[][] {
  return dockerMock.mock.calls
    .filter((call) => call[0] === 'volume' && call[1] === 'rm')
    .map((call) => call.slice(2));
}

function logged(logger: { mock: { calls: unknown[][] } }): string[] {
  return logger.mock.calls.map((call) => String(call[0]));
}

beforeEach(() => {
  // Use a real local lock without replacing the shared module for other suites.
  env.DEPLOY_DIR = mkdtempSync(join(tmpdir(), 'tale-reset-test-'));
  dockerMock.mockResolvedValue(PRUNED);
  // Colour containers are discovered by compose LABEL, so the sweep runs
  // `docker ps` per colour project. One platform replica each — enough to
  // prove it removes what compose actually created rather than a guessed
  // name. Routed through the docker mock rather than module-mocking the
  // lister: `mock.module` is process-global in Bun and leaks across files.
  dockerMock.mockImplementation((...args: string[]) => {
    if (args[0] !== 'ps') return Promise.resolve(PRUNED);
    const argv = args.join(' ');
    for (const colour of ['blue', 'green']) {
      if (argv.includes(`project=tale-${colour}`)) {
        return Promise.resolve({
          ...PRUNED,
          stdout: `tale-platform-${colour}\tplatform\t1\trunning`,
        });
      }
    }
    return Promise.resolve(PRUNED);
  });
  stopContainerMock.mockResolvedValue(true);
  removeContainerMock.mockResolvedValue(true);
  confirmMock.mockResolvedValue(true);
});

afterEach(() => {
  dockerMock.mockReset();
  stopContainerMock.mockReset();
  removeContainerMock.mockReset();
  confirmMock.mockReset();
  loggerInfoMock.mockReset();
  loggerWarnMock.mockReset();
  setActiveOutputMode(resolveOutputMode({}, {}));
  rmSync(env.DEPLOY_DIR, { recursive: true, force: true });
});

describe('reset', () => {
  test('prompts without --force and cancels on a refusal', async () => {
    confirmMock.mockResolvedValue(false);

    await reset({ env, force: false, includeStateful: false, dryRun: false });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(removeContainerMock).not.toHaveBeenCalled();
    expect(mutatingDockerCalls()).toHaveLength(0);
  });

  test('treats the global `tale -y` as consent when --force is absent', async () => {
    setActiveOutputMode(resolveOutputMode({ yes: true }, {}));

    await reset({ env, force: false, includeStateful: false, dryRun: false });

    // Under --yes `confirm` would have resolved to its default (false) and
    // cancelled the reset the operator asked for; the consent gate must skip it.
    expect(confirmMock).not.toHaveBeenCalled();
    expect(removedContainers()).toContain('tale-platform-blue');
    expect(removedContainers()).toContain('tale-platform-green');
    expect(dockerMock).toHaveBeenCalledWith(
      'network',
      'prune',
      '-f',
      '--filter',
      'label=project=tale',
    );
  });

  test('without --all leaves the stateful tier, the sidecar and every volume alone', async () => {
    await reset({ env, force: true, includeStateful: false, dryRun: false });

    expect(removedContainers()).not.toContain('tale-db');
    expect(removedContainers()).not.toContain('tale-bgutil-provider');
    // Volume deletion is gated on --all too — volume data is not recoverable.
    expect(
      dockerMock.mock.calls.filter((call) => call[0] === 'volume'),
    ).toHaveLength(0);
  });

  test('--all removes the bgutil-provider sidecar with the stateful tier', async () => {
    await reset({ env, force: true, includeStateful: true, dryRun: false });

    // Left behind, the sidecar's restart policy keeps it running after the
    // CLI is gone and pins the project network against the prune.
    expect(removedContainers()).toContain('tale-db');
    expect(removedContainers()).toContain('tale-bgutil-provider');
  });

  test('--all deletes each data volume by name, never the snapshots or the dev stack', async () => {
    await reset({ env, force: true, includeStateful: true, dryRun: false });

    // By name, one volume per call: on Docker Engine 23 and later a
    // `volume prune` removes only anonymous volumes, and every volume of a
    // project is named (#4981).
    expect(volumeRemovals()).toEqual(DATA_VOLUMES.map((volume) => [volume]));
    expect(volumeRemovals().flat()).not.toContain('tale_backups');
    expect(
      dockerMock.mock.calls.some(
        (call) => call[0] === 'volume' && call[1] === 'prune',
      ),
    ).toBe(false);
    // The dev stack's volumes carry the same project label; nothing names them.
    expect(
      dockerMock.mock.calls.flat().some((arg) => String(arg).includes('-dev_')),
    ).toBe(false);
  });

  test('names each volume it deleted and the snapshots volume it kept', async () => {
    await reset({ env, force: true, includeStateful: true, dryRun: false });

    const info = logged(loggerInfoMock);
    for (const volume of DATA_VOLUMES) {
      expect(info).toContain(`Removed volume: ${volume}`);
    }
    // `volume inspect` finds it, so it is named with the command that would
    // delete it as well.
    expect(
      info.filter(
        (line) =>
          line.startsWith('Kept volume: tale_backups') &&
          line.includes('docker volume rm tale_backups'),
      ),
    ).toHaveLength(1);
  });

  test('a volume already gone is no failure, and another failure names its volume', async () => {
    dockerMock.mockImplementation((...args: string[]) => {
      if (args[0] !== 'volume') return Promise.resolve(PRUNED);
      if (args[2] === 'tale_platform-data' || args[2] === 'tale_backups') {
        return Promise.resolve(
          failed(`Error response from daemon: get ${args[2]}: no such volume`),
        );
      }
      if (args[2] === 'tale_db-data') {
        return Promise.resolve(
          failed(
            'Error response from daemon: remove tale_db-data: volume is in use - [4f1c2a]',
          ),
        );
      }
      return Promise.resolve(PRUNED);
    });

    await reset({ env, force: true, includeStateful: true, dryRun: false });

    expect(
      logged(loggerWarnMock).filter((line) => line.startsWith('Failed')),
    ).toEqual([
      'Failed to remove volume tale_db-data: Error response from daemon: remove tale_db-data: volume is in use - [4f1c2a]',
    ]);
    // A failure stops nothing: the volumes after it are still deleted.
    expect(volumeRemovals()).toEqual(DATA_VOLUMES.map((volume) => [volume]));
    const info = logged(loggerInfoMock);
    expect(info).not.toContain('Removed volume: tale_platform-data');
    expect(info).not.toContain('Removed volume: tale_db-data');
    expect(info).toContain('Removed volume: tale_llm-gateway-data');
    // No snapshots volume on this host, so none is reported as kept.
    expect(info.some((line) => line.includes('tale_backups'))).toBe(false);
  });

  test('names the volumes --all deletes before asking, and a refusal deletes none', async () => {
    confirmMock.mockResolvedValue(false);

    await reset({ env, force: false, includeStateful: true, dryRun: false });

    const warnings = logged(loggerWarnMock).join('\n');
    for (const volume of DATA_VOLUMES) {
      expect(warnings).toContain(volume);
    }
    expect(warnings).toContain('tale_backups are kept');
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(mutatingDockerCalls()).toHaveLength(0);
  });

  test('--dry-run removes nothing and never prompts', async () => {
    await reset({ env, force: false, includeStateful: true, dryRun: true });

    // Dry-run still passes the consent gate (it changes nothing) but then
    // only reports what it would do.
    expect(removeContainerMock).not.toHaveBeenCalled();
    expect(mutatingDockerCalls()).toHaveLength(0);
    const info = logged(loggerInfoMock);
    for (const volume of DATA_VOLUMES) {
      expect(info).toContain(`[DRY-RUN] Would remove volume: ${volume}`);
    }
    expect(
      info.some((line) =>
        line.startsWith('[DRY-RUN] Would keep volume: tale_backups'),
      ),
    ).toBe(true);
  });

  test('warns when the project network prune fails instead of hiding it', async () => {
    dockerMock.mockImplementation((...args: string[]) =>
      Promise.resolve(
        args[0] === 'network'
          ? {
              success: false,
              stdout: '',
              stderr: 'network tale-net has active endpoints',
              exitCode: 1,
            }
          : PRUNED,
      ),
    );

    await reset({ env, force: true, includeStateful: false, dryRun: false });

    const warnings = loggerWarnMock.mock.calls.map((call) => String(call[0]));
    expect(
      warnings.some(
        (line) =>
          line.includes('Failed to prune project networks') &&
          line.includes('active endpoints'),
      ),
    ).toBe(true);
  });
});
