import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { ReplicaCounts } from '../../utils/load-env';
import { createModuleMocks } from '../../utils/module-mock-fixture';
import { SPLIT, THREE_WAY, UNIFIED, type AppTier } from '../compose/app-tier';
import type { DeploymentColor } from '../compose/types';
import { setProjectId } from '../project/project-context';
import { FakeRuntime } from '../runtime/fake-runtime';

setProjectId('tale');

const dockerMock = mock();
const getContainerVersionMock = mock();
const getCurrentColorMock = mock();

// Bun's module mocks are process-wide: each one is put back once this suite
// ends, so a later suite (the Incus deploy reads the current colour) meets the
// real module, not a spy reset to answer `undefined`.
const { mockModule } = createModuleMocks(import.meta.dir);
await mockModule('../docker/docker', () => ({ docker: dockerMock }));
await mockModule('../docker/get-container-version', () => ({
  getContainerVersion: getContainerVersionMock,
}));
await mockModule('../state/get-current-color', () => ({
  getCurrentColor: getCurrentColorMock,
}));
// Other suites in this process mock the stop and remove helpers with stubs of
// their own: bind both back to this file's docker spy, so the colour's
// teardown is the one this suite drives.
await mockModule('../docker/stop-container', () => ({
  stopContainer: async (name: string) =>
    ((await dockerMock('stop', name)) as { success: boolean }).success,
}));
await mockModule('../docker/remove-container', () => ({
  removeContainer: async (name: string) =>
    ((await dockerMock('rm', '-f', name)) as { success: boolean }).success,
}));

const {
  awaitRunningColorHealthy,
  colorLooksUp,
  colorPlatformVersion,
  colorTier,
  planColorFlip,
  removeColorContainers,
} = await import('./color-lifecycle');

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

/** A runtime with one colour up: one replica of each service of a shape,
 *  each started in the role the shape names for it. */
function colourOf(
  tier: AppTier,
  colour: DeploymentColor = 'green',
  runtime = new FakeRuntime(),
): FakeRuntime {
  for (const service of tier.services) {
    const role = tier.roles[service];
    runtime.seedInstance({
      stack: `tale-${colour}`,
      service,
      image: 'ghcr.io/tale-project/tale/tale-platform:0.6.1',
      // The web tier of a colour of three services names no role.
      environment:
        role === undefined || role === 'web' ? {} : { TALE_ROLE: role },
    });
  }
  return runtime;
}

const ONE: ReplicaCounts = {
  platform: 1,
  'backend-api': 0,
  'backend-worker': 0,
};

describe('colorTier', () => {
  test("reads the shape off the role the colour's platform runs", async () => {
    for (const tier of [UNIFIED, SPLIT, THREE_WAY])
      expect(await colorTier('green', colourOf(tier))).toBe(tier);
  });

  test('an explicit web role is the web tier too', async () => {
    const runtime = new FakeRuntime();
    runtime.seedInstance({
      stack: 'tale-green',
      service: 'platform',
      image: 'example/platform:1',
      environment: { TALE_ROLE: 'web' },
    });
    expect(await colorTier('green', runtime)).toBe(THREE_WAY);
  });

  test('the role decides, not the services left beside it', async () => {
    // A colour that lost its worker still has a platform that runs no jobs.
    const runtime = colourOf(SPLIT);
    runtime.instances.delete('tale-green-backend-worker-1');
    expect(await colorTier('green', runtime)).toBe(SPLIT);
  });

  test('null without a platform, or with one in a role no shape starts it in', async () => {
    expect(await colorTier('green', new FakeRuntime())).toBeNull();
    // The other colour's containers are not this colour's.
    expect(await colorTier('green', colourOf(UNIFIED, 'blue'))).toBeNull();
    const runtime = new FakeRuntime();
    runtime.seedInstance({
      stack: 'tale-green',
      service: 'platform',
      image: 'example/platform:1',
      environment: { TALE_ROLE: 'worker' },
    });
    expect(await colorTier('green', runtime)).toBeNull();
  });
});

describe('colorLooksUp, held to a shape', () => {
  test('a colour up in the shape asked is up', async () => {
    expect(
      await colorLooksUp(
        'green',
        UNIFIED.services,
        ONE,
        colourOf(UNIFIED),
        UNIFIED,
      ),
    ).toBe(true);
    expect(
      await colorLooksUp(
        'green',
        THREE_WAY.services,
        REPLICAS,
        colourOf(THREE_WAY),
        THREE_WAY,
      ),
    ).toBe(true);
  });

  test('a colour of three services is not one process, although its platform runs', async () => {
    const runtime = colourOf(THREE_WAY);
    // Asked only whether platform runs, it does.
    expect(await colorLooksUp('green', UNIFIED.services, ONE, runtime)).toBe(
      true,
    );
    expect(
      await colorLooksUp('green', UNIFIED.services, ONE, runtime, UNIFIED),
    ).toBe(false);
  });

  test('a platform that runs no jobs is not the whole application, with its worker or without', async () => {
    const runtime = colourOf(SPLIT);
    expect(
      await colorLooksUp('green', UNIFIED.services, ONE, runtime, UNIFIED),
    ).toBe(false);
    runtime.instances.delete('tale-green-backend-worker-1');
    expect(
      await colorLooksUp('green', UNIFIED.services, ONE, runtime, UNIFIED),
    ).toBe(false);
  });

  test('a stopped container of a service the shape lacks still makes it another colour', async () => {
    const runtime = colourOf(UNIFIED);
    runtime.seedInstance({
      stack: 'tale-green',
      service: 'backend-api',
      image: 'example/platform:1',
      state: 'exited',
    });
    expect(
      await colorLooksUp('green', UNIFIED.services, ONE, runtime, UNIFIED),
    ).toBe(false);
  });

  test('one process is not the three services, and the count still decides first', async () => {
    const runtime = colourOf(UNIFIED);
    expect(
      await colorLooksUp(
        'green',
        THREE_WAY.services,
        REPLICAS,
        runtime,
        THREE_WAY,
      ),
    ).toBe(false);
    expect(
      await colorLooksUp(
        'green',
        UNIFIED.services,
        { ...ONE, platform: 2 },
        runtime,
        UNIFIED,
      ),
    ).toBe(false);
  });
});

describe('planColorFlip', () => {
  const pending = { promoting: 'green', retiring: 'blue' } as const;
  const TWO: ReplicaCounts = { ...ONE, platform: 2 };
  const plan = (
    runtime: FakeRuntime,
    options: {
      pending?: typeof pending | null;
      current?: DeploymentColor | null;
      tier?: AppTier;
      replicas?: ReplicaCounts;
    } = {},
  ) => {
    const tier = options.tier ?? UNIFIED;
    return planColorFlip({
      pending: options.pending === undefined ? pending : options.pending,
      current: options.current === undefined ? 'blue' : options.current,
      next: 'green',
      tier,
      replicas: options.replicas ?? (tier === THREE_WAY ? REPLICAS : ONE),
      runtime,
    });
  };

  test('with nothing recorded and the idle colour down, the flip starts it', async () => {
    expect(await plan(colourOf(THREE_WAY, 'blue'), { pending: null })).toEqual({
      promoting: 'green',
      retiring: 'blue',
      resumed: false,
      step: 'start',
      services: UNIFIED.services,
      replicas: ONE,
      runsInstead: null,
    });
  });

  test('a first deploy promotes the colour it is given and retires none', async () => {
    const flip = await planColorFlip({
      pending: null,
      current: null,
      next: 'blue',
      tier: UNIFIED,
      replicas: ONE,
      runtime: new FakeRuntime(),
    });
    expect(flip).toMatchObject({
      promoting: 'blue',
      retiring: null,
      resumed: false,
      step: 'start',
    });
  });

  test('an idle colour that is up as asked is waited for, recorded or not', async () => {
    const runtime = colourOf(UNIFIED, 'green', colourOf(THREE_WAY, 'blue'));
    expect(await plan(runtime)).toMatchObject({
      promoting: 'green',
      retiring: 'blue',
      resumed: true,
      step: 'wait',
      services: UNIFIED.services,
      replicas: ONE,
    });
    expect(await plan(runtime, { pending: null })).toMatchObject({
      resumed: false,
      step: 'wait',
    });
  });

  test('an idle colour left up in another shape, or short of replicas, is started again: it serves nothing yet', async () => {
    const apart = colourOf(SPLIT, 'green', colourOf(THREE_WAY, 'blue'));
    expect(await plan(apart)).toMatchObject({
      promoting: 'green',
      retiring: 'blue',
      resumed: false,
      step: 'start',
      services: UNIFIED.services,
    });
    const short = colourOf(UNIFIED, 'green', colourOf(THREE_WAY, 'blue'));
    expect(await plan(short, { replicas: TWO })).toMatchObject({
      resumed: false,
      step: 'start',
      replicas: TWO,
    });
  });

  test('a colour that holds the traffic is kept as it is, and waited for by what it runs', async () => {
    // The switch to green was recorded; blue was not retired yet.
    const runtime = colourOf(UNIFIED, 'green', colourOf(THREE_WAY, 'blue'));
    expect(await plan(runtime, { current: 'green' })).toEqual({
      promoting: 'green',
      retiring: 'blue',
      resumed: true,
      step: 'keep',
      services: UNIFIED.services,
      replicas: REPLICAS,
      runsInstead: null,
    });
  });

  test('it is kept in the shape it has, whatever shape this run asks for', async () => {
    const runtime = colourOf(UNIFIED, 'green', colourOf(THREE_WAY, 'blue'));
    for (const tier of [SPLIT, THREE_WAY]) {
      const flip = await plan(runtime, { current: 'green', tier });
      expect(flip).toMatchObject({
        promoting: 'green',
        retiring: 'blue',
        resumed: true,
        step: 'keep',
        // What it runs: the check against the admitted image and the health
        // wait both read these, not the services asked.
        services: UNIFIED.services,
        runsInstead: 'platform×1',
      });
    }
    // And the other way round: three services serve, one process is asked.
    const three = colourOf(THREE_WAY, 'green', colourOf(UNIFIED, 'blue'));
    expect(await plan(three, { current: 'green' })).toMatchObject({
      step: 'keep',
      services: THREE_WAY.services,
      runsInstead: 'platform×1, backend-api×1, backend-worker×1',
    });
  });

  test('it is kept at the replicas it has, where this run asks for more', async () => {
    const runtime = colourOf(UNIFIED, 'green', colourOf(THREE_WAY, 'blue'));
    expect(
      await plan(runtime, { current: 'green', replicas: TWO }),
    ).toMatchObject({ step: 'keep', runsInstead: 'platform×1' });
  });

  test('a colour that holds the traffic on record and serves none of it is started again', async () => {
    const runtime = colourOf(UNIFIED, 'green', colourOf(THREE_WAY, 'blue'));
    const platform = runtime.instances.get('tale-green-platform-1');
    if (platform === undefined) throw new Error('seed');
    platform.state = 'exited';
    expect(await plan(runtime, { current: 'green' })).toMatchObject({
      promoting: 'green',
      retiring: 'blue',
      resumed: true,
      step: 'start',
      services: UNIFIED.services,
    });
    // So is one whose containers are gone altogether.
    runtime.instances.delete('tale-green-platform-1');
    expect(await plan(runtime, { current: 'green' })).toMatchObject({
      resumed: true,
      step: 'start',
    });
  });

  test('a colour of three that lost a service serves none of it either', async () => {
    const runtime = colourOf(THREE_WAY, 'green', colourOf(UNIFIED, 'blue'));
    const api = runtime.instances.get('tale-green-backend-api-1');
    if (api === undefined) throw new Error('seed');
    api.state = 'exited';
    expect(
      await plan(runtime, { current: 'green', tier: THREE_WAY }),
    ).toMatchObject({ resumed: true, step: 'start' });
  });

  test('a record left behind by a flip that finished is no flip to resume', async () => {
    // green is live and blue is gone: the next deploy promotes the colour it
    // is given, never the one that serves.
    const runtime = colourOf(UNIFIED, 'green');
    const flip = await planColorFlip({
      pending,
      current: 'green',
      next: 'blue',
      tier: UNIFIED,
      replicas: ONE,
      runtime,
    });
    expect(flip).toMatchObject({
      promoting: 'blue',
      retiring: 'green',
      resumed: false,
      step: 'start',
    });
  });

  test('a stopped old colour is one that is gone', async () => {
    const runtime = colourOf(UNIFIED, 'green', colourOf(THREE_WAY, 'blue'));
    for (const instance of runtime.instances.values())
      if (instance.stack === 'tale-blue') instance.state = 'exited';
    const flip = await planColorFlip({
      pending,
      current: 'green',
      next: 'blue',
      tier: UNIFIED,
      replicas: ONE,
      runtime,
    });
    expect(flip).toMatchObject({
      promoting: 'blue',
      retiring: 'green',
      resumed: false,
    });
  });
});

describe('removeColorContainers', () => {
  test('stops every container of the colour at once, then removes them', async () => {
    const events: string[] = [];
    const releases: Array<() => void> = [];
    dockerMock.mockImplementation((...args: string[]) => {
      if (args[0] === 'ps') {
        return Promise.resolve(
          ok(
            [
              'tale-blue-backend-worker-1\tbackend-worker\t1\trunning\t',
              'tale-blue-backend-worker-2\tbackend-worker\t2\trunning\t',
            ].join('\n'),
          ),
        );
      }
      events.push(`${args[0]} ${args.at(-1)}`);
      if (args[0] === 'stop') {
        // A worker takes its whole grace to stop; release them by hand.
        return new Promise((resolve) => {
          releases.push(() => resolve(ok()));
        });
      }
      return Promise.resolve(ok());
    });

    const removal = removeColorContainers('tale-blue');
    // Bounded, so a teardown that never reaches docker fails here with the
    // stops it did see instead of hanging until the runner's timeout.
    for (let waited = 0; releases.length < 2 && waited < 2_000; waited += 5) {
      await Bun.sleep(5);
    }
    expect(releases).toHaveLength(2);
    // Both stops are under way before either finished.
    expect(events).toEqual([
      'stop tale-blue-backend-worker-1',
      'stop tale-blue-backend-worker-2',
    ]);
    for (const release of releases) release();

    expect(await removal).toBe(2);
    expect(events.slice(2)).toEqual([
      'rm tale-blue-backend-worker-1',
      'rm tale-blue-backend-worker-2',
    ]);
  });
});

describe('awaitRunningColorHealthy', () => {
  const apiReplica = (index: number, running: boolean) => ({
    name: `tale-green-backend-api-${index}`,
    service: 'backend-api',
    index,
    running,
    state: running ? 'running' : 'exited',
  });
  const args = {
    color: 'green' as const,
    services: ['backend-api'] as const,
    replicas: REPLICAS,
    healthTimeout: 1,
  };

  test('waits on running replicas only, so an exited leftover cannot wedge a resumed flip', async () => {
    const waited: string[] = [];
    await awaitRunningColorHealthy(args, {
      list: async () => [apiReplica(1, true), apiReplica(2, false)],
      wait: async (name) => {
        waited.push(name);
        return true;
      },
    });
    expect(waited).toEqual(['tale-green-backend-api-1']);
  });

  test('refuses a role short of running replicas, or one that is not healthy', async () => {
    await expect(
      awaitRunningColorHealthy(args, {
        list: async () => [apiReplica(1, false)],
        wait: async () => true,
      }),
    ).rejects.toThrow('0 of 1 replicas running');
    await expect(
      awaitRunningColorHealthy(args, {
        list: async () => [apiReplica(1, true)],
        wait: async () => false,
      }),
    ).rejects.toThrow('failed health check');
  });
});
