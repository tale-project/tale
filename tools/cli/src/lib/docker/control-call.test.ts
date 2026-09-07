import { describe, expect, mock, test } from 'bun:test';

import { setProjectId } from '../project/project-context';

setProjectId('tale');

const dockerMock = mock();
const execMock = mock();

mock.module('./docker', () => ({ docker: dockerMock }));
mock.module('./exec', () => ({ exec: execMock }));

const {
  backendApiContainer,
  backendApiDrainWriter,
  controlCall,
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
