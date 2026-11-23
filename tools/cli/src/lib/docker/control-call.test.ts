import { describe, expect, mock, test } from 'bun:test';

import { createModuleMocks } from '../../utils/module-mock-fixture';
import { SPLIT, THREE_WAY, UNIFIED, type AppTier } from '../compose/app-tier';
import type { DeploymentColor } from '../compose/types';
import { setProjectId } from '../project/project-context';
import { FakeRuntime } from '../runtime/fake-runtime';

setProjectId('tale');

const dockerMock = mock();
const execMock = mock();

// Bun's module mocks are process-wide: each one is put back once this suite
// ends, so a later suite in the same process meets the real module.
const { mockModule } = createModuleMocks(import.meta.dir);
await mockModule('./docker', () => ({ docker: dockerMock }));
await mockModule('./exec', () => ({ exec: execMock }));

const {
  backendApiContainer,
  backendApiContainers,
  backendApiContainersInColor,
  backendApiDrainWriter,
  controlCall,
  isBackendTierRunning,
  DEFAULT_CONTROL_TIMEOUT_S,
} = await import('./control-call');

function ok(stdout = '{}') {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}

/**
 * The api is a replica set, so the container to address is DISCOVERED from
 * compose labels rather than reconstructed from the project id. `docker ps`
 * answers the discovery; everything else is the call under test.
 */
const REPLICA_LINE = 'tale-blue-backend-api-1\tbackend-api\t1\trunning';

function routeDocker(psStdout = REPLICA_LINE) {
  dockerMock.mockReset();
  dockerMock.mockImplementation((...args: string[]) =>
    Promise.resolve(args[0] === 'ps' ? ok(psStdout) : ok()),
  );
}

/** The non-`ps` docker calls — the control-door invocation itself. */
function doorCalls(): unknown[][] {
  return dockerMock.mock.calls.filter((call) => call[0] !== 'ps');
}

/** The argv a mock was called with, as one string, for substring assertions. */
function argvOf(call: unknown[]): string {
  return call
    .map((a) => (Array.isArray(a) ? a.join(' ') : String(a)))
    .join(' ');
}

describe('controlCall', () => {
  test('targets a discovered backend-api replica on the control port', async () => {
    routeDocker();
    await controlCall('GET', '/api/control/drain-status');
    const argv = argvOf(doorCalls()[0] ?? []);
    expect(await backendApiContainer()).toBe('tale-blue-backend-api-1');
    expect(argv).toContain('tale-blue-backend-api-1');
    expect(argv).toContain('http://localhost:3005/api/control/drain-status');
    expect(argv).toContain('-X GET');
  });

  // Every control door acts on shared state (a database row, the config
  // volume), so any replica will do — but with none up there is nothing to
  // address, and the call must fail rather than invent a container name.
  test('refuses without a running replica instead of guessing a name', async () => {
    routeDocker('');
    const result = await controlCall('GET', '/api/control/drain-status');
    expect(result.success).toBe(false);
    expect(result.stderr).toContain('no running backend-api container');
    expect(doorCalls()).toHaveLength(0);
  });

  test('finds a replica in the stateful project too (pre-colour stacks)', async () => {
    routeDocker('tale-backend-api\tbackend-api\t1\trunning');
    expect(await backendApiContainer()).toBe('tale-backend-api');
  });

  test('prefers the opposite colour as the drain writer', async () => {
    dockerMock.mockReset();
    dockerMock.mockImplementation((...args: string[]) => {
      if (args[0] !== 'ps') return Promise.resolve(ok());
      const argv = args.join(' ');
      if (argv.includes('project=tale-green')) {
        return Promise.resolve(
          ok('tale-green-backend-api-1\tbackend-api\t1\trunning'),
        );
      }
      if (argv.includes('project=tale-blue')) {
        return Promise.resolve(
          ok('tale-blue-backend-api-1\tbackend-api\t1\trunning'),
        );
      }
      return Promise.resolve(ok(''));
    });
    expect(await backendApiDrainWriter('blue')).toBe(
      'tale-green-backend-api-1',
    );
  });

  test('expands the control token INSIDE the container, never in the CLI', async () => {
    routeDocker();
    await controlCall('POST', '/api/control/drain');
    const argv = argvOf(doorCalls()[0] ?? []);
    // The literal `$TALE_CONTROL_TOKEN` reaches the container's shell
    // unexpanded — the CLI process never holds the deployment's token.
    expect(argv).toContain('Bearer $TALE_CONTROL_TOKEN');
    expect(argv).toContain('sh -c');
  });

  test('sends a body over stdin, never argv', async () => {
    routeDocker();
    execMock.mockReset();
    execMock.mockResolvedValue(ok());
    await controlCall('POST', '/api/control/reset-owner', {
      body: { newPassword: 'hunter2-not-in-argv' },
    });
    const [command, args, options] = execMock.mock.calls[0] ?? [];
    expect(command).toBe('docker');
    expect(argvOf(args as unknown[])).not.toContain('hunter2-not-in-argv');
    expect(argvOf(args as unknown[])).toContain('--data-binary @-');
    // `docker exec -i` is required for the stdin stream to reach curl.
    expect(argvOf(args as unknown[])).toContain('-i');
    expect((options as { stdin?: string }).stdin).toBe(
      JSON.stringify({ newPassword: 'hunter2-not-in-argv' }),
    );
  });

  test('bounds every call with the default budget when none is given', async () => {
    // A door that accepts TCP but never answers must not hang the deploy
    // (which holds the deploy lock) — drain/drain-status/end-drain all omit
    // an explicit budget.
    routeDocker();
    await controlCall('GET', '/api/control/drain-status');
    expect(argvOf(doorCalls()[0] ?? [])).toContain(
      `timeout ${DEFAULT_CONTROL_TIMEOUT_S} curl`,
    );
  });

  test('wraps the call in timeout(1) when a budget is given', async () => {
    routeDocker();
    await controlCall('POST', '/api/control/reseed', { timeoutS: 1800 });
    expect(argvOf(doorCalls()[0] ?? [])).toContain('timeout 1800 curl');
  });
});

/**
 * A colour runs the API in `backend-api` or in `platform` (compose/app-tier.ts).
 * Which, the replicas say themselves: a `platform` is the API where its role
 * says so, never merely where no `backend-api` stands beside it.
 */
describe('the API of a colour of any shape', () => {
  const IMAGE = 'ghcr.io/tale-project/tale/tale-platform:0.6.1';
  /** One replica of each service of a shape, in the role it names for it. */
  function colour(
    runtime: FakeRuntime,
    tier: AppTier,
    name: DeploymentColor,
    replicas = 1,
  ): FakeRuntime {
    for (const service of tier.services) {
      const role = tier.roles[service];
      for (let index = 1; index <= replicas; index += 1)
        runtime.seedInstance({
          stack: `tale-${name}`,
          service,
          index,
          image: IMAGE,
          environment:
            role === undefined || role === 'web' ? {} : { TALE_ROLE: role },
        });
    }
    return runtime;
  }

  test('one process: platform answers, every replica of it', async () => {
    const runtime = colour(new FakeRuntime(), UNIFIED, 'blue', 2);
    expect(await backendApiContainers(null, runtime)).toEqual([
      'tale-blue-platform-1',
      'tale-blue-platform-2',
    ]);
    expect(await backendApiContainer(null, runtime)).toBe(
      'tale-blue-platform-1',
    );
    expect(await backendApiContainersInColor('blue', runtime)).toEqual([
      'tale-blue-platform-1',
      'tale-blue-platform-2',
    ]);
    expect(await isBackendTierRunning(runtime)).toBe(true);
  });

  test('the jobs apart: platform answers, the worker never does', async () => {
    const runtime = colour(new FakeRuntime(), SPLIT, 'green');
    expect(await backendApiContainers(null, runtime)).toEqual([
      'tale-green-platform-1',
    ]);
  });

  test('three services: backend-api answers, and its platform is never asked', async () => {
    const runtime = colour(new FakeRuntime(), THREE_WAY, 'blue');
    expect(await backendApiContainers(null, runtime)).toEqual([
      'tale-blue-backend-api-1',
    ]);
  });

  test('a colour of three whose api is down reads as down, not as a colour whose pages take the call', async () => {
    const runtime = colour(new FakeRuntime(), THREE_WAY, 'blue');
    const api = runtime.instances.get('tale-blue-backend-api-1');
    if (api === undefined) throw new Error('seed');
    api.state = 'exited';
    expect(await backendApiContainers(null, runtime)).toEqual([]);
    expect(await isBackendTierRunning(runtime)).toBe(false);
  });

  test('the role decides, whatever stands stopped beside it', async () => {
    // A stopped backend-api does not hide a platform that is the API.
    const runtime = colour(new FakeRuntime(), UNIFIED, 'blue');
    runtime.seedInstance({
      stack: 'tale-blue',
      service: 'backend-api',
      image: IMAGE,
      state: 'exited',
    });
    expect(await backendApiContainers(null, runtime)).toEqual([
      'tale-blue-platform-1',
    ]);
  });

  test('a colour that is the web tier alone leaves the call to the stateful backend', async () => {
    // A host from before the backend joined the colours.
    const runtime = new FakeRuntime();
    runtime.seedInstance({
      stack: 'tale-blue',
      service: 'platform',
      image: IMAGE,
    });
    expect(await backendApiContainers(null, runtime)).toEqual([]);
    runtime.seedInstance({
      name: 'tale-backend-api',
      stack: 'tale',
      service: 'backend-api',
      image: IMAGE,
    });
    expect(await backendApiContainers(null, runtime)).toEqual([
      'tale-backend-api',
    ]);
    expect(await backendApiContainersInColor('blue', runtime)).toEqual([]);
  });

  test('a stopped platform answers nothing, and a role no shape gives it neither', async () => {
    const stopped = colour(new FakeRuntime(), UNIFIED, 'blue');
    const platform = stopped.instances.get('tale-blue-platform-1');
    if (platform === undefined) throw new Error('seed');
    platform.state = 'exited';
    expect(await backendApiContainers(null, stopped)).toEqual([]);

    const worker = new FakeRuntime();
    worker.seedInstance({
      stack: 'tale-blue',
      service: 'platform',
      image: IMAGE,
      environment: { TALE_ROLE: 'worker' },
    });
    expect(await backendApiContainers(null, worker)).toEqual([]);
  });

  test('while two colours of two shapes overlap, each answers through its own API', async () => {
    const runtime = colour(
      colour(new FakeRuntime(), THREE_WAY, 'blue'),
      UNIFIED,
      'green',
    );
    expect(await backendApiContainersInColor('blue', runtime)).toEqual([
      'tale-blue-backend-api-1',
    ]);
    expect(await backendApiContainersInColor('green', runtime)).toEqual([
      'tale-green-platform-1',
    ]);
    // The drain aimed at blue is written by the colour that is not retiring.
    expect(await backendApiDrainWriter('blue', runtime)).toBe(
      'tale-green-platform-1',
    );
    expect(await backendApiDrainWriter('green', runtime)).toBe(
      'tale-blue-backend-api-1',
    );
  });

  test('a call reaches the control port of the platform replica', async () => {
    const runtime = colour(new FakeRuntime(), UNIFIED, 'blue');
    const sent: Array<{ name: string; argv: string }> = [];
    runtime.execHandler = (instance, argv) => {
      sent.push({ name: instance.name, argv: argv.join(' ') });
      return undefined;
    };
    const result = await controlCall('GET', '/api/control/drain-status', {
      runtime,
    });
    expect(result.success).toBe(true);
    expect(sent).toEqual([
      {
        name: 'tale-blue-platform-1',
        argv: expect.stringContaining(
          'http://localhost:3005/api/control/drain-status',
        ),
      },
    ]);
  });
});
