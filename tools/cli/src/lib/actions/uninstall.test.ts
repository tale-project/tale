import { describe, expect, mock, test } from 'bun:test';

import { type UninstallDeps, uninstall } from './uninstall';

const BINARY = '/usr/local/bin/tale';
const LEGACY = '/home/user/.tale-daemon';
const DEVICE = { name: 'studio', stateDir: '/home/user/.tale/sandbox' };
const PROJECT = '/home/user/acme';

/** Build a fully-mocked UninstallDeps; every field is a bun mock for assertions. */
function makeDeps(overrides: Partial<UninstallDeps> = {}): UninstallDeps {
  return {
    isDevBuild: mock(() => false),
    getBinaryPath: mock(() => BINARY),
    removeBinary: mock(async () => {}),
    removeBinaryBackups: mock(async () => {}),
    removeDir: mock(async () => {}),
    findProject: mock(() => PROJECT),
    findSandboxDevice: mock(async () => DEVICE),
    disconnectSandboxDevice: mock(async () => {}),
    legacyUserDirs: mock(() => [LEGACY]),
    tearDownDocker: mock(async () => {}),
    confirm: mock(async () => true),
    isInteractive: mock(() => true),
    assumeYes: mock(() => false),
    ...overrides,
  };
}

describe('uninstall', () => {
  test('dev build: refuses and removes nothing', async () => {
    const deps = makeDeps({ isDevBuild: mock(() => true) });
    await expect(uninstall({}, deps)).rejects.toThrow(/dev build/);
    expect(deps.removeBinary).not.toHaveBeenCalled();
    expect(deps.removeDir).not.toHaveBeenCalled();
  });

  test('--force: removes only the binary + backups, no extras', async () => {
    const deps = makeDeps();
    await uninstall({ force: true }, deps);

    expect(deps.removeBinaryBackups).toHaveBeenCalledWith(BINARY);
    expect(deps.removeBinary).toHaveBeenCalledWith(BINARY);
    // --force skips both the primary prompt and the optional offers.
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.tearDownDocker).not.toHaveBeenCalled();
    expect(deps.removeDir).not.toHaveBeenCalled();
  });

  test('--purge: removes binary, sandbox device, legacy config, and the project', async () => {
    const deps = makeDeps({ assumeYes: mock(() => true) }); // skip primary prompt
    await uninstall({ purge: true }, deps);

    expect(deps.tearDownDocker).toHaveBeenCalledWith(PROJECT);
    expect(deps.removeDir).toHaveBeenCalledWith(PROJECT);
    expect(deps.removeDir).toHaveBeenCalledWith(LEGACY);
    expect(deps.disconnectSandboxDevice).toHaveBeenCalledTimes(1);
    expect(deps.removeBinary).toHaveBeenCalledWith(BINARY);
    // --purge selects extras non-interactively — no prompting.
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  test('--purge with no project: removes the legacy config only, no teardown', async () => {
    const deps = makeDeps({
      assumeYes: mock(() => true),
      findProject: mock(() => null),
    });
    await uninstall({ purge: true }, deps);

    expect(deps.tearDownDocker).not.toHaveBeenCalled();
    expect(deps.removeDir).toHaveBeenCalledTimes(1);
    expect(deps.removeDir).toHaveBeenCalledWith(LEGACY);
    expect(deps.removeBinary).toHaveBeenCalledWith(BINARY);
  });

  test('declining the primary prompt cancels — nothing removed', async () => {
    const deps = makeDeps({ confirm: mock(async () => false) });
    await uninstall({}, deps);

    expect(deps.removeBinary).not.toHaveBeenCalled();
    expect(deps.removeDir).not.toHaveBeenCalled();
    expect(deps.tearDownDocker).not.toHaveBeenCalled();
  });

  test('non-interactive without --purge/--force: only the binary is offered', async () => {
    // assumeYes skips the primary prompt; not a TTY → optional offers default
    // to "no", so CI never surprise-deletes data.
    const deps = makeDeps({
      assumeYes: mock(() => true),
      isInteractive: mock(() => false),
    });
    await uninstall({}, deps);

    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.removeBinary).toHaveBeenCalledWith(BINARY);
    expect(deps.tearDownDocker).not.toHaveBeenCalled();
    expect(deps.removeDir).not.toHaveBeenCalled();
  });

  test('--dry-run: removes nothing and never prompts', async () => {
    const deps = makeDeps();
    await uninstall({ dryRun: true, purge: true }, deps);

    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.removeBinary).not.toHaveBeenCalled();
    expect(deps.removeBinaryBackups).not.toHaveBeenCalled();
    expect(deps.removeDir).not.toHaveBeenCalled();
    expect(deps.tearDownDocker).not.toHaveBeenCalled();
    expect(deps.disconnectSandboxDevice).not.toHaveBeenCalled();
  });

  test('Docker teardown failure still deletes the project dir and the binary', async () => {
    const deps = makeDeps({
      assumeYes: mock(() => true),
      tearDownDocker: mock(async () => {
        throw new Error('docker daemon not running');
      }),
    });
    await uninstall({ purge: true }, deps);

    expect(deps.removeDir).toHaveBeenCalledWith(PROJECT);
    expect(deps.removeBinary).toHaveBeenCalledWith(BINARY);
  });

  test('interactive: offers extras via prompt and honors per-offer answers', async () => {
    // Accept the primary + project teardown, decline the device and the
    // retired config.
    const confirm = mock(
      async (message: string) =>
        !message.includes('sandbox device') && !message.includes('retired'),
    );
    const deps = makeDeps({ confirm });
    await uninstall({}, deps);

    expect(deps.tearDownDocker).toHaveBeenCalledWith(PROJECT);
    expect(deps.removeDir).toHaveBeenCalledWith(PROJECT);
    expect(deps.removeDir).not.toHaveBeenCalledWith(LEGACY);
    expect(deps.disconnectSandboxDevice).not.toHaveBeenCalled();
    expect(deps.removeBinary).toHaveBeenCalledWith(BINARY);
  });

  test('a machine with no device and no leftovers is offered neither', async () => {
    const confirm = mock(async () => true);
    const deps = makeDeps({
      confirm,
      findProject: mock(() => null),
      findSandboxDevice: mock(async () => null),
      legacyUserDirs: mock(() => []),
    });
    await uninstall({}, deps);

    // Only the primary prompt.
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(deps.disconnectSandboxDevice).not.toHaveBeenCalled();
    expect(deps.removeBinary).toHaveBeenCalledWith(BINARY);
  });

  test('a failed device disconnect keeps the CLI and removes nothing', async () => {
    const deps = makeDeps({
      assumeYes: mock(() => true),
      disconnectSandboxDevice: mock(async () => {
        throw new Error('docker daemon not running');
      }),
    });
    await expect(uninstall({ purge: true }, deps)).rejects.toThrow(
      /sandbox device \(docker daemon not running\); nothing was uninstalled/,
    );
    // The device's containers restart with Docker: the CLI that can stop
    // them stays, and nothing else was half-done.
    expect(deps.removeBinary).not.toHaveBeenCalled();
    expect(deps.tearDownDocker).not.toHaveBeenCalled();
    expect(deps.removeDir).not.toHaveBeenCalled();
  });
});
