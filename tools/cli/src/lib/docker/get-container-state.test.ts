import { describe, expect, mock, test } from 'bun:test';

import { getContainerState } from './get-container-state';

/** A fresh fake per test, injected directly — no `mock.module`. */
function inspectAnswers(result: {
  success: boolean;
  stdout?: string;
  stderr?: string;
}) {
  return mock((..._args: string[]) =>
    Promise.resolve({
      stdout: '',
      stderr: '',
      exitCode: result.success ? 0 : 1,
      ...result,
    }),
  );
}

describe('getContainerState', () => {
  test("reads the container's state word from docker inspect", async () => {
    const docker = inspectAnswers({ success: true, stdout: 'restarting\n' });

    expect(await getContainerState('tale-db', { docker })).toBe('restarting');
    expect(docker).toHaveBeenCalledWith(
      'container',
      'inspect',
      '--format',
      '{{.State.Status}}',
      'tale-db',
    );
  });

  test('tells a paused container apart from a running one', async () => {
    expect(
      await getContainerState('tale-db', {
        docker: inspectAnswers({ success: true, stdout: 'paused\n' }),
      }),
    ).toBe('paused');
    expect(
      await getContainerState('tale-db', {
        docker: inspectAnswers({ success: true, stdout: 'running\n' }),
      }),
    ).toBe('running');
  });

  test('is null when there is no such container', async () => {
    const docker = inspectAnswers({
      success: false,
      stderr: 'Error: No such container: tale-db',
    });

    expect(await getContainerState('tale-db', { docker })).toBeNull();
  });
});
