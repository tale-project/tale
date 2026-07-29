import { describe, expect, mock, test } from 'bun:test';

import type { InstallHandle, ResolvedRelease } from '../version/self-update';
import { type RunUpdateDeps, runUpdate } from './run-update';

const HANDLE: InstallHandle = {
  installPath: '/usr/local/bin/tale',
  backupPath: '/usr/local/bin/tale.bak',
};

function resolved(version: string): ResolvedRelease {
  return {
    release: { tag: `v${version}`, version, assetNames: ['tale_macos'] },
    skipped: [],
    newerLine: null,
  };
}

/** Fully-mocked deps; defaults describe a successful 0.8.0 → 0.9.0 update. */
function makeDeps(overrides: Partial<RunUpdateDeps> = {}): RunUpdateDeps {
  return {
    currentVersion: '0.8.0',
    isDevBuild: mock(() => false),
    requireProject: mock(() => '/project'),
    readWorkspaceVersion: mock(async () => '0.8.0'),
    writeWorkspaceVersion: mock(async () => {}),
    resolveRelease: mock(async () => resolved('0.9.0')),
    installBinary: mock(async () => HANDLE),
    commitInstall: mock(async () => {}),
    rollbackInstall: mock(async () => {}),
    spawnFileSync: mock((_args: string[]) => 0),
    syncProjectFiles: mock(async () => {}),
    ...overrides,
  };
}

describe('runUpdate', () => {
  test('happy path: installs target, syncs files, commits backup', async () => {
    const deps = makeDeps();
    await runUpdate({}, deps);

    expect(deps.installBinary).toHaveBeenCalledTimes(1);
    expect(deps.spawnFileSync).toHaveBeenCalledTimes(1);
    expect(deps.commitInstall).toHaveBeenCalledWith(HANDLE);
    expect(deps.rollbackInstall).not.toHaveBeenCalled();
  });

  test('does not deploy — only the file-sync child is spawned', async () => {
    const spawnFileSync = mock((_args: string[]) => 0);
    const deps = makeDeps({ spawnFileSync });
    await runUpdate({ force: true }, deps);

    const argv = spawnFileSync.mock.calls[0][0];
    expect(argv).toEqual(['update', '--internal-instance', '--force']);
  });

  test('file sync fails: rolls the CLI back and resets the workspace version', async () => {
    const deps = makeDeps({ spawnFileSync: mock((_args: string[]) => 1) });

    await expect(runUpdate({}, deps)).rejects.toThrow('rolled back to v0.8.0');

    expect(deps.rollbackInstall).toHaveBeenCalledWith(HANDLE);
    expect(deps.writeWorkspaceVersion).toHaveBeenCalledWith(
      '/project',
      '0.8.0',
    );
    expect(deps.commitInstall).not.toHaveBeenCalled();
  });

  test('already on target: syncs files in-process, no binary swap', async () => {
    const deps = makeDeps({
      currentVersion: '0.9.0',
      readWorkspaceVersion: mock(async () => '0.9.0'),
      resolveRelease: mock(async () => resolved('0.9.0')),
    });
    await runUpdate({}, deps);

    expect(deps.installBinary).not.toHaveBeenCalled();
    expect(deps.spawnFileSync).not.toHaveBeenCalled();
    expect(deps.syncProjectFiles).toHaveBeenCalledTimes(1);
  });

  test('internal-instance continuation: only runs the file-sync phase', async () => {
    const deps = makeDeps();
    await runUpdate({ internalInstance: true }, deps);

    expect(deps.syncProjectFiles).toHaveBeenCalledTimes(1);
    expect(deps.requireProject).not.toHaveBeenCalled();
    expect(deps.resolveRelease).not.toHaveBeenCalled();
    expect(deps.installBinary).not.toHaveBeenCalled();
  });

  test('pinned version: targets that release exactly', async () => {
    const resolveRelease = mock(async () => resolved('0.7.0'));
    const deps = makeDeps({ resolveRelease });
    await runUpdate({ version: '0.7.0' }, deps);

    expect(resolveRelease).toHaveBeenCalledWith({ version: '0.7.0' });
    expect(deps.installBinary).toHaveBeenCalledTimes(1);
  });

  test('newer release line available: still targets the in-line release', async () => {
    const resolveRelease = mock(async () => ({
      ...resolved('0.8.1'),
      newerLine: '0.9.0',
    }));
    const deps = makeDeps({ resolveRelease });
    await runUpdate({}, deps);

    expect(deps.installBinary).toHaveBeenCalledWith(
      expect.objectContaining({ version: '0.8.1' }),
    );
  });
});
