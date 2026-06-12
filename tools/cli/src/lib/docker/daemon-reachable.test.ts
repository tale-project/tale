import { afterEach, describe, expect, mock, test } from 'bun:test';

import { daemonReachable } from './daemon-reachable';

const execMock = mock();

mock.module('./exec', () => ({
  exec: execMock,
}));

afterEach(() => {
  execMock.mockReset();
});

describe('daemonReachable', () => {
  test('reports reachable with server version when docker version succeeds', async () => {
    execMock.mockResolvedValue({
      success: true,
      stdout: '27.0.1',
      stderr: '',
      exitCode: 0,
    });

    const status = await daemonReachable();

    expect(status.reachable).toBe(true);
    expect(status.detail).toContain('27.0.1');
    expect(execMock).toHaveBeenCalledWith(
      'docker',
      ['version', '--format', '{{.Server.Version}}'],
      { silent: true },
    );
  });

  test('reports unreachable with stderr when the daemon is down', async () => {
    execMock.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'Cannot connect to the Docker daemon',
      exitCode: 1,
    });

    const status = await daemonReachable();

    expect(status.reachable).toBe(false);
    expect(status.detail).toContain('Cannot connect to the Docker daemon');
  });

  test('falls back to the exit code when stderr is empty', async () => {
    execMock.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: '',
      exitCode: 125,
    });

    const status = await daemonReachable();

    expect(status.reachable).toBe(false);
    expect(status.detail).toContain('exited with code 125');
  });

  test('does not throw when the docker CLI is missing', async () => {
    execMock.mockRejectedValue(
      new Error("Executable not found in $PATH: 'docker'"),
    );

    const status = await daemonReachable();

    expect(status.reachable).toBe(false);
    expect(status.detail).toContain('Executable not found');
  });
});
