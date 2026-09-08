import { describe, expect, mock, test } from 'bun:test';

import { ensureConfigMountpoints } from './ensure-config-mountpoints';

function fakeDeps(ok = true) {
  return {
    docker: mock(() =>
      Promise.resolve({
        success: ok,
        exitCode: ok ? 0 : 1,
        stdout: '',
        stderr: ok ? '' : 'no such volume',
      }),
    ),
    logger: { warn: mock() },
  };
}

describe('ensureConfigMountpoints', () => {
  test('creates every target inside the volume in one container', async () => {
    const deps = fakeDeps();

    expect(
      await ensureConfigMountpoints(
        'my-project-dev_config-data',
        ['default/agents', 'default/governance'],
        deps,
      ),
    ).toBe(true);
    expect(deps.docker).toHaveBeenCalledTimes(1);
    const args = deps.docker.mock.calls[0] as string[];
    expect(args).toContain('my-project-dev_config-data:/d');
    expect(args).toContain('/d/default/agents');
    expect(args).toContain('/d/default/governance');
    expect(args).toContain('-p');
  });

  test('does nothing when there is nothing to mount', async () => {
    const deps = fakeDeps();

    expect(await ensureConfigMountpoints('vol', [], deps)).toBe(true);
    expect(deps.docker).not.toHaveBeenCalled();
  });

  test('strips traversal so a slug cannot escape the mount', async () => {
    const deps = fakeDeps();

    await ensureConfigMountpoints('vol', ['../../etc/agents'], deps);

    const args = deps.docker.mock.calls[0] as string[];
    expect(args.some((a) => a.includes('..'))).toBe(false);
  });

  test('warns and reports failure instead of throwing', async () => {
    const deps = fakeDeps(false);

    // Every bring-up after the first would start fine anyway; failing hard
    // here would block a stack that was going to work.
    expect(await ensureConfigMountpoints('vol', ['default/agents'], deps)).toBe(
      false,
    );
    expect(deps.logger.warn).toHaveBeenCalled();
  });
});
