import { describe, expect, mock, test } from 'bun:test';

import { setProjectId } from '../project/project-context';

setProjectId('tale');

const dockerMock = mock();
const execMock = mock();

mock.module('./docker', () => ({ docker: dockerMock }));
mock.module('./exec', () => ({ exec: execMock }));

const { backendApiContainer, controlCall, DEFAULT_CONTROL_TIMEOUT_S } =
  await import('./control-call');

function ok(stdout = '{}') {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}

/** The argv a mock was called with, as one string, for substring assertions. */
function argvOf(call: unknown[]): string {
  return call
    .map((a) => (Array.isArray(a) ? a.join(' ') : String(a)))
    .join(' ');
}

describe('controlCall', () => {
  test("targets the project's backend-api container on the control port", async () => {
    dockerMock.mockReset();
    dockerMock.mockResolvedValue(ok());
    await controlCall('GET', '/api/control/drain-status');
    const argv = argvOf(dockerMock.mock.calls[0] ?? []);
    expect(backendApiContainer()).toBe('tale-backend-api');
    expect(argv).toContain('tale-backend-api');
    expect(argv).toContain('http://localhost:3005/api/control/drain-status');
    expect(argv).toContain('-X GET');
  });

  test('expands the control token INSIDE the container, never in the CLI', async () => {
    dockerMock.mockReset();
    dockerMock.mockResolvedValue(ok());
    await controlCall('POST', '/api/control/drain');
    const argv = argvOf(dockerMock.mock.calls[0] ?? []);
    // The literal `$TALE_CONTROL_TOKEN` reaches the container's shell
    // unexpanded — the CLI process never holds the deployment's token.
    expect(argv).toContain('Bearer $TALE_CONTROL_TOKEN');
    expect(argv).toContain('sh -c');
  });

  test('sends a body over stdin, never argv', async () => {
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
    dockerMock.mockReset();
    dockerMock.mockResolvedValue(ok());
    await controlCall('GET', '/api/control/drain-status');
    expect(argvOf(dockerMock.mock.calls[0] ?? [])).toContain(
      `timeout ${DEFAULT_CONTROL_TIMEOUT_S} curl`,
    );
  });

  test('wraps the call in timeout(1) when a budget is given', async () => {
    dockerMock.mockReset();
    dockerMock.mockResolvedValue(ok());
    await controlCall('POST', '/api/control/reseed', { timeoutS: 1800 });
    expect(argvOf(dockerMock.mock.calls[0] ?? [])).toContain(
      'timeout 1800 curl',
    );
  });
});
