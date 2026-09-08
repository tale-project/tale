import { describe, expect, mock, test } from 'bun:test';

import { ensureConfigMountpoints } from './ensure-config-mountpoints';

const IMAGE = 'ghcr.io/tale-project/tale/tale-platform:0.5.11';

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

/** The `sh -c` script the helper container runs. */
function script(deps: ReturnType<typeof fakeDeps>): string {
  const args = deps.docker.mock.calls[0] as string[];
  return args[args.length - 1] as string;
}

describe('ensureConfigMountpoints', () => {
  test('creates every target and its slug root in one container', async () => {
    const deps = fakeDeps();

    expect(
      await ensureConfigMountpoints(
        'my-project-dev_config-data',
        ['default/agents', 'default/governance'],
        IMAGE,
        deps,
      ),
    ).toBe(true);
    expect(deps.docker).toHaveBeenCalledTimes(1);
    const args = deps.docker.mock.calls[0] as string[];
    expect(args).toContain('my-project-dev_config-data:/mnt/config');
    expect(args).toContain(IMAGE);
    const sh = script(deps);
    expect(sh).toContain("'/mnt/config/default'");
    expect(sh).toContain("'/mnt/config/default/agents'");
    expect(sh).toContain("'/mnt/config/default/governance'");
  });

  test('hands the tree to the user the app image runs as', async () => {
    const deps = fakeDeps();

    await ensureConfigMountpoints('vol', ['default/agents'], IMAGE, deps);

    // runc creates these as root while the app runs unprivileged, and the
    // backend could then not seed default/object-storage beside them. A fresh
    // volume is root-owned and empty, so the IMAGE has to answer for it.
    const sh = script(deps);
    expect(sh).toContain("stat -c '%u:%g' /app/data");
    expect(sh).toContain('chown "$owner"');
    expect(sh.indexOf('mkdir')).toBeLessThan(sh.indexOf('chown'));
  });

  test('does nothing when there is nothing to mount', async () => {
    const deps = fakeDeps();

    expect(await ensureConfigMountpoints('vol', [], IMAGE, deps)).toBe(true);
    expect(deps.docker).not.toHaveBeenCalled();
  });

  test('drops anything that is not a plain slug/domain pair', async () => {
    const deps = fakeDeps();

    expect(
      await ensureConfigMountpoints(
        'vol',
        ['../../etc/agents', 'default/agents; rm -rf /', 'ok/agents'],
        IMAGE,
        deps,
      ),
    ).toBe(true);
    const sh = script(deps);
    expect(sh).toContain("'/mnt/config/ok/agents'");
    expect(sh).not.toContain('..');
    expect(sh).not.toContain('rm -rf');
  });

  test('returns false with nothing to do when every target is rejected', async () => {
    const deps = fakeDeps();

    expect(await ensureConfigMountpoints('vol', ['../etc'], IMAGE, deps)).toBe(
      true,
    );
    expect(deps.docker).not.toHaveBeenCalled();
  });

  test('warns and reports failure instead of throwing', async () => {
    const deps = fakeDeps(false);

    // Every bring-up after the first would start fine anyway; failing hard
    // here would block a stack that was going to work.
    expect(
      await ensureConfigMountpoints('vol', ['default/agents'], IMAGE, deps),
    ).toBe(false);
    expect(deps.logger.warn).toHaveBeenCalled();
    const [message] = deps.logger.warn.mock.calls[0] as [string];
    expect(message).toContain('object store bootstrap failed');
  });
});
