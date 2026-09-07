import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { ReplicaCounts } from '../../utils/load-env';
import { setProjectId } from '../project/project-context';

setProjectId('tale');

const dockerMock = mock();
const getContainerVersionMock = mock();
const getCurrentColorMock = mock();

mock.module('../docker/docker', () => ({ docker: dockerMock }));
mock.module('../docker/get-container-version', () => ({
  getContainerVersion: getContainerVersionMock,
}));
mock.module('../state/get-current-color', () => ({
  getCurrentColor: getCurrentColorMock,
}));

const { colorLooksUp, colorPlatformVersion, isUnfinishedColorFlip } =
  await import('./color-lifecycle');

const REPLICAS: ReplicaCounts = {
  platform: 1,
  'backend-api': 1,
  'backend-worker': 1,
};

const SERVICES = ['platform', 'backend-api', 'backend-worker'] as const;

function ok(stdout = '') {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}

function replica(project: string, service: string, state = 'running'): string {
  return `${project}-${service}-1\t${service}\t1\t${state}`;
}

function routePs(linesFor: (argv: string) => string): void {
  dockerMock.mockImplementation((...args: string[]) => {
    if (args[0] !== 'ps') return Promise.resolve(ok());
    return Promise.resolve(ok(linesFor(args.join(' '))));
  });
}

beforeEach(() => {
  getContainerVersionMock.mockResolvedValue('0.5.10');
  getCurrentColorMock.mockResolvedValue('blue');
  routePs(() => '');
});

afterEach(() => {
  dockerMock.mockReset();
  getContainerVersionMock.mockReset();
  getCurrentColorMock.mockReset();
});

describe('colorPlatformVersion', () => {
  test('reads the current service name first', async () => {
    routePs((argv) =>
      argv.includes('service=platform') &&
      !argv.includes('service=platform-blue')
        ? replica('tale-blue', 'platform')
        : '',
    );

    expect(await colorPlatformVersion('blue')).toBe('0.5.10');
    expect(getContainerVersionMock).toHaveBeenCalledWith(
      'tale-blue-platform-1',
    );
  });

  test('falls back to the pre-replica-set service name', async () => {
    routePs((argv) =>
      argv.includes('service=platform-blue')
        ? 'tale-platform-blue\tplatform-blue\t1\trunning'
        : '',
    );

    expect(await colorPlatformVersion('blue')).toBe('0.5.10');
    expect(getContainerVersionMock).toHaveBeenCalledWith('tale-platform-blue');
  });

  test('falls back to the pinned container name when no replica is listed', async () => {
    routePs(() => '');
    getContainerVersionMock.mockResolvedValue('0.5.1');

    expect(await colorPlatformVersion('blue')).toBe('0.5.1');
    expect(getContainerVersionMock).toHaveBeenCalledWith('tale-platform-blue');
  });
});

describe('isUnfinishedColorFlip', () => {
  function colourUp(project: string, argv: string): string {
    if (!argv.includes(`project=${project}`)) return '';
    for (const service of SERVICES) {
      if (argv.includes(`service=${service}`)) {
        return replica(project, service);
      }
    }
    // Unscoped listing (retiring-still-running).
    return SERVICES.map((service) => replica(project, service)).join('\n');
  }

  test('is true when traffic already flipped and the old colour is still up', async () => {
    getCurrentColorMock.mockResolvedValue('green');
    routePs(
      (argv) => colourUp('tale-green', argv) || colourUp('tale-blue', argv),
    );

    expect(
      await isUnfinishedColorFlip(
        '/project',
        { promoting: 'green', retiring: 'blue' },
        SERVICES,
        REPLICAS,
      ),
    ).toBe(true);
  });

  test('is true when the new colour is up but the switch is not recorded', async () => {
    getCurrentColorMock.mockResolvedValue('blue');
    routePs((argv) => colourUp('tale-green', argv));

    expect(
      await isUnfinishedColorFlip(
        '/project',
        { promoting: 'green', retiring: 'blue' },
        SERVICES,
        REPLICAS,
      ),
    ).toBe(true);
  });

  test('is false when the promoting colour was torn down (Ctrl-C cleanup)', async () => {
    getCurrentColorMock.mockResolvedValue('blue');
    routePs(() => '');

    expect(
      await isUnfinishedColorFlip(
        '/project',
        { promoting: 'green', retiring: 'blue' },
        SERVICES,
        REPLICAS,
      ),
    ).toBe(false);
  });

  test('is false when the flip already finished (pending file leftover)', async () => {
    getCurrentColorMock.mockResolvedValue('green');
    routePs((argv) => colourUp('tale-green', argv));

    expect(
      await isUnfinishedColorFlip(
        '/project',
        { promoting: 'green', retiring: 'blue' },
        SERVICES,
        REPLICAS,
      ),
    ).toBe(false);
  });
});

describe('colorLooksUp', () => {
  test('is false when a requested role is short of its replica count', async () => {
    routePs((argv) =>
      argv.includes('service=platform')
        ? replica('tale-green', 'platform')
        : '',
    );
    expect(await colorLooksUp('green', SERVICES, REPLICAS)).toBe(false);
  });
});
