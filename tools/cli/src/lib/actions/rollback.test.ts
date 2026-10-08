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
import { deploy } from './deploy';
import { rollback } from './rollback';

// getProjectId() (used for container names) throws unless seeded. Seed the
// real singleton with the same id the compose generator tests use — bun's
// mock.module leaks across test files in one process, so mocking the shared
// load-env module here would break sibling suites.
setProjectId('tale');

const getCurrentColorMock = mock();
const getPreviousVersionMock = mock();
const getContainerVersionMock = mock();
// A colour is a replica set: its containers are discovered by compose label
// (a `docker ps` filtered on the project), and the version is read off any
// one of them. Driven through the docker mock rather than module-mocking the
// lister — `mock.module` is process-global in Bun and leaks across files.
const dockerMock = mock();
const pullImageMock = mock();
const dockerComposeMock = mock();
const ensureVolumesMock = mock();
const ensureNetworkMock = mock();
const waitForHealthyMock = mock();
const waitForServiceHealthyMock = mock();
const stopContainerMock = mock();
const removeContainerMock = mock();
const setCurrentColorMock = mock();
const setPreviousVersionMock = mock();
const confirmMock = mock();
const loggerInfoMock = mock();
const loggerErrorMock = mock();
const execMock = mock(async () => ({
  success: true,
  stdout: '',
  stderr: '',
  exitCode: 0,
}));
let protocolFloor = 1;
let installedWriterProtocol = 1;
let migrateDuringPull = false;
let targetProtocol: string | undefined;
const databaseId = 'a'.repeat(64);

mock.module('../state/get-current-color', () => ({
  getCurrentColor: getCurrentColorMock,
}));
mock.module('../state/get-previous-version', () => ({
  getPreviousVersion: getPreviousVersionMock,
}));
mock.module('../state/set-current-color', () => ({
  setCurrentColor: setCurrentColorMock,
}));
mock.module('../state/set-previous-version', () => ({
  setPreviousVersion: setPreviousVersionMock,
}));
mock.module('../docker/get-container-version', () => ({
  getContainerVersion: getContainerVersionMock,
}));
// The retire step drains through the control door and detaches the colour
// from the serving networks; both go through the raw `docker` helper.
mock.module('../docker/docker', () => ({ docker: dockerMock }));
// pullImage is injected via rollback's `deps` arg (below), not mock.module:
// it's a shared module imported for real by pull-image.test.ts, and Bun's
// process-global module mock leaked into that suite and broke it on Windows.
mock.module('../docker/docker-compose', () => ({
  dockerCompose: dockerComposeMock,
}));
mock.module('../docker/ensure-volumes', () => ({
  ensureVolumes: ensureVolumesMock,
  volumeExists: mock(async () => false),
}));
mock.module('../docker/ensure-network', () => ({
  ensureNetwork: ensureNetworkMock,
  ensureSandboxNetwork: ensureNetworkMock,
}));
mock.module('../docker/wait-for-healthy', () => ({
  waitForHealthy: waitForHealthyMock,
}));
mock.module('../docker/wait-for-service-healthy', () => ({
  waitForServiceHealthy: waitForServiceHealthyMock,
}));
mock.module('../docker/stop-container', () => ({
  stopContainer: stopContainerMock,
}));
mock.module('../docker/remove-container', () => ({
  removeContainer: removeContainerMock,
}));
// rollback pre-marks the old platform colour for shutdown via `docker exec`
// before draining. Stub it deterministically (a sibling suite's exec mock
// otherwise leaks in process-globally and returns undefined).
mock.module('../docker/exec', () => ({
  exec: execMock,
}));
mock.module('../../utils/prompt', () => ({
  confirm: confirmMock,
}));
mock.module('../../utils/logger', () => ({
  info: loggerInfoMock,
  error: loggerErrorMock,
  warn: mock(),
  step: mock(),
  success: mock(),
  header: mock(),
  blank: mock(),
  debug: mock(),
  notice: mock(),
}));
const env: DeploymentEnv = {
  BACKEND_UPSTREAM: '',
  GHCR_REGISTRY: 'ghcr.io/tale-project/tale',
  SITE_URL: 'https://localhost',
  HEALTH_CHECK_TIMEOUT: 1,
  DRAIN_TIMEOUT: 0,
  DEPLOY_DIR: '',
};

function expectRunbookPrinted(): void {
  const infoLines = loggerInfoMock.mock.calls.map((c) => String(c[0]));
  expect(infoLines.some((line) => line.includes('tale update --version'))).toBe(
    true,
  );
  expect(infoLines.some((line) => line.includes('tale deploy --stop'))).toBe(
    true,
  );
  expect(
    infoLines.some((line) =>
      line.includes('tale restore <snapshot-id> --stop'),
    ),
  ).toBe(true);
  // `tale migrate down` retired with the Convex runtime; the runbook must
  // name only commands that exist.
  expect(infoLines.some((line) => line.includes('migrate down'))).toBe(false);
  expect(
    infoLines.some((line) => line.includes('cannot undo external effects')),
  ).toBe(true);
  expect(
    infoLines.some((line) => line.includes('compatible forward repair')),
  ).toBe(true);
}

beforeEach(() => {
  protocolFloor = 1;
  installedWriterProtocol = 1;
  migrateDuringPull = false;
  targetProtocol = undefined;
  execMock.mockImplementation(
    async (_command?: string, args: string[] = []) => {
      let value: unknown = '';
      if (args[0] === 'ps' && args.includes('--no-trunc')) {
        value = args.at(-1)?.includes('.Label')
          ? args.includes('label=com.docker.compose.project=tale-blue')
            ? `${'c'.repeat(64)}\tbackend-api\n${'d'.repeat(64)}\tbackend-worker`
            : ''
          : databaseId;
      }
      if (args[0] === 'container' && args[1] === 'inspect')
        value = [
          {
            Id: databaseId,
            Image: `sha256:${'b'.repeat(64)}`,
            RestartCount: 0,
            Config: {
              Image: 'example/db:1',
              Labels: {
                'com.docker.compose.project': 'tale',
                'com.docker.compose.service': 'db',
                'com.docker.compose.container-number': '1',
                'com.docker.compose.oneoff': 'False',
              },
            },
            State: { Running: true, StartedAt: '2026-10-08T00:00:00Z' },
          },
        ];
      if (
        args[0] === 'container' &&
        args[1] === 'inspect' &&
        args[2] !== databaseId
      )
        value = args.slice(2).map((id) => ({
          Id: id,
          Image: `sha256:${'e'.repeat(64)}`,
          RestartCount: 0,
          Config: {
            Labels: {
              'com.docker.compose.project': 'tale-blue',
              'com.docker.compose.service':
                id === 'c'.repeat(64) ? 'backend-api' : 'backend-worker',
              'com.docker.compose.container-number': '1',
              'com.docker.compose.oneoff': 'False',
            },
            Env: ['DATABASE_URL=postgresql://tale:synthetic@db:5432/tale_app'],
          },
          State: {
            Running: installedWriterProtocol !== 2,
            StartedAt: '2026-10-08T00:00:00Z',
          },
        }));
      if (args[0] === 'exec' && args.includes('-i'))
        value = {
          schema: 'public',
          ids:
            protocolFloor === 2
              ? ['0001_initial.sql', '0163_automation_legacy_protocol.sql']
              : ['0001_initial.sql'],
        };
      if (args[0] === 'image')
        value = [
          {
            Id: `sha256:${'c'.repeat(64)}`,
            Os: 'linux',
            Architecture: 'amd64',
            RepoDigests: [
              `ghcr.io/tale-project/tale/tale-platform@sha256:${'d'.repeat(64)}`,
            ],
            Config: {
              Labels:
                targetProtocol === undefined
                  ? {}
                  : {
                      'io.tale.automation-writer-protocol': targetProtocol,
                      'org.opencontainers.image.version': '0.9.2',
                      'org.opencontainers.image.revision': 'e'.repeat(40),
                      'org.opencontainers.image.source':
                        'https://github.com/tale-project/tale',
                    },
            },
          },
        ];
      if (args[0] === 'image' && args[2]?.startsWith('sha256:'))
        value = args.slice(2).map((Id) => ({
          Id,
          Config: {
            Labels: {
              'io.tale.automation-writer-protocol': String(
                installedWriterProtocol,
              ),
            },
          },
        }));
      return {
        success: true,
        exitCode: 0,
        stdout: typeof value === 'string' ? value : JSON.stringify(value),
        stderr: '',
      };
    },
  );
  // Keep the real lock: a module mock here also disables sibling deployment
  // suites' guards in Bun's shared process.
  env.DEPLOY_DIR = mkdtempSync(join(tmpdir(), 'tale-rollback-test-'));
  // One platform replica in the live colour, so the version probe has
  // something to read.
  dockerMock.mockImplementation((...args: string[]) => {
    if (args[0] === 'pull' && migrateDuringPull) protocolFloor = 2;
    const argv = args.join(' ');
    let stdout = '';
    if (args[0] === 'ps' && argv.includes('project=tale-blue')) {
      // The live colour: one platform replica (the version probe reads it)
      // and one api replica (the retire step drains through it).
      stdout = argv.includes('service=backend-api')
        ? 'tale-blue-backend-api-1\tbackend-api\t1\trunning'
        : 'tale-blue-platform-1\tplatform\t1\trunning';
    } else if (argv.includes('/api/control/drain-status')) {
      // Nothing in flight, so the retire step's drain returns immediately
      // instead of polling out its whole budget.
      stdout = '{"draining":true,"inFlight":0}';
    }
    return Promise.resolve({ success: true, stdout, stderr: '', exitCode: 0 });
  });
  waitForServiceHealthyMock.mockResolvedValue(true);
  dockerComposeMock.mockResolvedValue({
    success: true,
    stdout: '',
    stderr: '',
    exitCode: 0,
  });
});

afterEach(() => {
  getCurrentColorMock.mockReset();
  getPreviousVersionMock.mockReset();
  getContainerVersionMock.mockReset();
  dockerMock.mockReset();
  pullImageMock.mockReset();
  dockerComposeMock.mockReset();
  ensureVolumesMock.mockReset();
  ensureNetworkMock.mockReset();
  waitForHealthyMock.mockReset();
  waitForServiceHealthyMock.mockReset();
  stopContainerMock.mockReset();
  removeContainerMock.mockReset();
  setCurrentColorMock.mockReset();
  setPreviousVersionMock.mockReset();
  confirmMock.mockReset();
  loggerInfoMock.mockReset();
  loggerErrorMock.mockReset();
  execMock.mockClear();
  rmSync(env.DEPLOY_DIR, { recursive: true, force: true });
});

describe('rollback gate', () => {
  test('refuses a minor-version rollback and prints the restore runbook', async () => {
    getCurrentColorMock.mockResolvedValue('blue');
    getPreviousVersionMock.mockResolvedValue('0.9.6');
    getContainerVersionMock.mockResolvedValue('0.10.1');

    await expect(
      rollback({ env, assumeYes: false }, { pullImage: pullImageMock }),
    ).rejects.toThrow('Rollback refused: not a patch-level rollback');

    expect(pullImageMock).not.toHaveBeenCalled();
    expect(setCurrentColorMock).not.toHaveBeenCalled();
    expectRunbookPrinted();
  });

  test('refuses when no previous version is recorded', async () => {
    getCurrentColorMock.mockResolvedValue('blue');
    getPreviousVersionMock.mockResolvedValue(null);

    await expect(
      rollback({ env, assumeYes: false }, { pullImage: pullImageMock }),
    ).rejects.toThrow('No previous version');

    expect(pullImageMock).not.toHaveBeenCalled();
    expectRunbookPrinted();
  });

  test('refuses when the running platform version is unknown', async () => {
    getCurrentColorMock.mockResolvedValue('blue');
    getPreviousVersionMock.mockResolvedValue('0.9.2');
    getContainerVersionMock.mockResolvedValue(null);

    await expect(
      rollback({ env, assumeYes: false }, { pullImage: pullImageMock }),
    ).rejects.toThrow('Unknown running version');

    expect(pullImageMock).not.toHaveBeenCalled();
    expectRunbookPrinted();
  });

  test('refuses when the running version is not semver-parseable', async () => {
    getCurrentColorMock.mockResolvedValue('blue');
    getPreviousVersionMock.mockResolvedValue('0.9.2');
    getContainerVersionMock.mockResolvedValue('latest');

    await expect(
      rollback({ env, assumeYes: false }, { pullImage: pullImageMock }),
    ).rejects.toThrow('Rollback refused: cannot compare versions');

    expect(pullImageMock).not.toHaveBeenCalled();
    expectRunbookPrinted();
  });
});

describe('rollback confirmation', () => {
  /** Seed the mocks so a patch-level rollback passes the gate and succeeds. */
  function arrangePatchRollback(): void {
    getCurrentColorMock.mockResolvedValue('blue');
    getPreviousVersionMock.mockResolvedValue('0.9.2');
    getContainerVersionMock.mockResolvedValue('0.9.3');
    pullImageMock.mockResolvedValue(true);
    ensureVolumesMock.mockResolvedValue(true);
    ensureNetworkMock.mockResolvedValue(true);
    dockerComposeMock.mockResolvedValue({
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
    });
    waitForHealthyMock.mockResolvedValue(true);
    stopContainerMock.mockResolvedValue(true);
    removeContainerMock.mockResolvedValue(true);
  }

  test('installed protocol refuses a preprotocol patch before volumes, Compose or traffic mutation', async () => {
    arrangePatchRollback();
    protocolFloor = 2;
    await expect(
      rollback({ env, assumeYes: true }, { pullImage: pullImageMock }),
    ).rejects.toThrow('automation writer protocol');
    expect(ensureVolumesMock).not.toHaveBeenCalled();
    expect(ensureNetworkMock).not.toHaveBeenCalled();
    expect(dockerComposeMock).not.toHaveBeenCalled();
    expect(setCurrentColorMock).not.toHaveBeenCalled();
  });

  test('ordinary tag deploy also refuses an incompatible writer before infrastructure', async () => {
    arrangePatchRollback();
    protocolFloor = 2;
    await expect(
      deploy({
        env,
        version: '0.9.2',
        services: ['platform'],
        stop: false,
        hostAlias: '',
        dryRun: false,
        skipBackup: true,
      }),
    ).rejects.toThrow('automation writer protocol');
    expect(ensureVolumesMock).not.toHaveBeenCalled();
    expect(ensureNetworkMock).not.toHaveBeenCalled();
    expect(dockerComposeMock).not.toHaveBeenCalled();
    expect(setCurrentColorMock).not.toHaveBeenCalled();
  });

  for (const action of ['deploy', 'rollback'] as const) {
    for (const interval of ['already-created writer', 'during pull'] as const) {
      test(`${action} refuses a floor advanced by ${interval} before mutation`, async () => {
        arrangePatchRollback();
        if (interval === 'already-created writer') installedWriterProtocol = 2;
        else {
          migrateDuringPull = true;
          pullImageMock.mockImplementation(async () => {
            protocolFloor = 2;
            return true;
          });
        }
        const operation =
          action === 'rollback'
            ? rollback({ env, assumeYes: true }, { pullImage: pullImageMock })
            : deploy({
                env,
                version: '0.9.2',
                services: ['platform'],
                stop: false,
                hostAlias: '',
                dryRun: false,
                skipBackup: true,
              });
        await expect(operation).rejects.toThrow('automation writer protocol');
        expect(ensureVolumesMock).not.toHaveBeenCalled();
        expect(ensureNetworkMock).not.toHaveBeenCalled();
        expect(dockerComposeMock).not.toHaveBeenCalled();
        expect(setCurrentColorMock).not.toHaveBeenCalled();
      });
    }
  }

  test('a compatible protocol image retains ordinary rollback behavior', async () => {
    arrangePatchRollback();
    protocolFloor = 2;
    targetProtocol = '2';
    await rollback({ env, assumeYes: true }, { pullImage: pullImageMock });
    expect(setCurrentColorMock).toHaveBeenCalledWith(env.DEPLOY_DIR, 'green');
  });

  test('proceeds with a patch-level rollback once the operator confirms', async () => {
    arrangePatchRollback();
    confirmMock.mockResolvedValue(true);

    await rollback({ env, assumeYes: false }, { pullImage: pullImageMock });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    // platform — the only rotatable service
    expect(pullImageMock).toHaveBeenCalledTimes(1);
    expect(pullImageMock).toHaveBeenCalledWith(
      'ghcr.io/tale-project/tale/tale-platform:0.9.2',
    );
    expect(setCurrentColorMock).toHaveBeenCalledWith(env.DEPLOY_DIR, 'green');
    expect(setPreviousVersionMock).toHaveBeenCalledWith(
      env.DEPLOY_DIR,
      '0.9.3',
    );
  });

  test('aborts before pulling anything when the operator declines', async () => {
    arrangePatchRollback();
    confirmMock.mockResolvedValue(false);

    await rollback({ env, assumeYes: false }, { pullImage: pullImageMock });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(pullImageMock).not.toHaveBeenCalled();
    expect(setCurrentColorMock).not.toHaveBeenCalled();
    expect(setPreviousVersionMock).not.toHaveBeenCalled();
  });

  test('skips the prompt and proceeds when --yes is set', async () => {
    arrangePatchRollback();

    await rollback({ env, assumeYes: true }, { pullImage: pullImageMock });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(pullImageMock).toHaveBeenCalledTimes(1);
    expect(setCurrentColorMock).toHaveBeenCalledWith(env.DEPLOY_DIR, 'green');
  });

  test('treats the global `tale -y` as consent when the local flag is absent', async () => {
    // `tale -y rollback` routes `--yes` to program.opts(); the command's own
    // flag stays unset. Under the global flag `confirm` would return its
    // `default` (false) and cancel — the opposite of what was asked.
    arrangePatchRollback();
    setActiveOutputMode(resolveOutputMode({ yes: true }, {}));
    try {
      await rollback({ env }, { pullImage: pullImageMock });
    } finally {
      setActiveOutputMode(resolveOutputMode({}, {}));
    }

    expect(confirmMock).not.toHaveBeenCalled();
    expect(pullImageMock).toHaveBeenCalledTimes(1);
    expect(setCurrentColorMock).toHaveBeenCalledWith(env.DEPLOY_DIR, 'green');
  });
});
