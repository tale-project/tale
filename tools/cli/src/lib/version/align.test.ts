import { afterEach, describe, expect, mock, test } from 'bun:test';

import { type AlignDeps, ALIGN_GUARD_ENV, ensureAligned } from './align';
import type { InstallHandle, ReleaseInfo } from './self-update';

const RELEASE: ReleaseInfo = {
  tag: 'v0.9.0',
  version: '0.9.0',
  assetNames: ['tale_macos'],
};
const HANDLE: InstallHandle = {
  installPath: '/usr/local/bin/tale',
  backupPath: '/usr/local/bin/tale.bak',
};

/** Build a fully-mocked AlignDeps; every field is a bun mock for assertions. */
function makeDeps(overrides: Partial<AlignDeps> = {}): AlignDeps {
  return {
    currentVersion: '0.8.0',
    isDevBuild: mock(() => false),
    findProject: mock(() => '/project'),
    readWorkspaceVersion: mock(async () => '0.9.0'),
    resolveRelease: mock(async () => ({ release: RELEASE })),
    installBinary: mock(async () => HANDLE),
    commitInstall: mock(async () => {}),
    reExec: mock(() => {}),
    ...overrides,
  };
}

afterEach(() => {
  delete process.env[ALIGN_GUARD_ENV];
});

describe('ensureAligned', () => {
  test('mismatch: installs the workspace version and re-execs', async () => {
    const deps = makeDeps({ currentVersion: '0.8.0' }); // workspace = 0.9.0
    await ensureAligned('status', deps);

    expect(deps.resolveRelease).toHaveBeenCalledWith({ version: '0.9.0' });
    expect(deps.installBinary).toHaveBeenCalledWith(RELEASE);
    expect(deps.commitInstall).toHaveBeenCalledTimes(1);
    expect(deps.reExec).toHaveBeenCalledTimes(1);
  });

  test('downgrade mismatch also aligns (workspace older than binary)', async () => {
    const deps = makeDeps({
      currentVersion: '0.9.0',
      readWorkspaceVersion: mock(async () => '0.8.0'),
      resolveRelease: mock(async () => ({
        release: { tag: 'v0.8.0', version: '0.8.0', assetNames: [] },
      })),
    });
    await ensureAligned('status', deps);

    expect(deps.resolveRelease).toHaveBeenCalledWith({ version: '0.8.0' });
    expect(deps.installBinary).toHaveBeenCalledTimes(1);
    expect(deps.reExec).toHaveBeenCalledTimes(1);
  });

  test('already aligned: no install, no re-exec, no network', async () => {
    const deps = makeDeps({
      currentVersion: '0.9.0',
      readWorkspaceVersion: mock(async () => '0.9.0'),
    });
    await ensureAligned('status', deps);

    expect(deps.resolveRelease).not.toHaveBeenCalled();
    expect(deps.installBinary).not.toHaveBeenCalled();
    expect(deps.reExec).not.toHaveBeenCalled();
  });

  test('dev build: skips before touching the filesystem', async () => {
    const deps = makeDeps({ isDevBuild: mock(() => true) });
    await ensureAligned('status', deps);

    expect(deps.findProject).not.toHaveBeenCalled();
    expect(deps.installBinary).not.toHaveBeenCalled();
    expect(deps.reExec).not.toHaveBeenCalled();
  });

  test('no project: nothing to align to', async () => {
    const deps = makeDeps({ findProject: mock(() => null) });
    await ensureAligned('status', deps);

    expect(deps.readWorkspaceVersion).not.toHaveBeenCalled();
    expect(deps.reExec).not.toHaveBeenCalled();
  });

  test('self-managing commands (update/init) never align', async () => {
    const deps = makeDeps();
    await ensureAligned('update', deps);
    await ensureAligned('init', deps);

    expect(deps.findProject).not.toHaveBeenCalled();
    expect(deps.reExec).not.toHaveBeenCalled();
  });

  test('guard env set (re-exec child): skips to avoid an align loop', async () => {
    process.env[ALIGN_GUARD_ENV] = '1';
    const deps = makeDeps();
    await ensureAligned('status', deps);

    expect(deps.findProject).not.toHaveBeenCalled();
    expect(deps.reExec).not.toHaveBeenCalled();
  });

  test('offline (resolveRelease throws): warns and proceeds, no re-exec', async () => {
    const deps = makeDeps({
      resolveRelease: mock(async () => {
        throw new Error('network down');
      }),
    });
    await ensureAligned('status', deps);

    expect(deps.installBinary).not.toHaveBeenCalled();
    expect(deps.reExec).not.toHaveBeenCalled();
  });

  test('install failure: does not re-exec', async () => {
    const deps = makeDeps({
      installBinary: mock(async () => {
        throw new Error('permission denied');
      }),
    });
    await ensureAligned('status', deps);

    expect(deps.commitInstall).not.toHaveBeenCalled();
    expect(deps.reExec).not.toHaveBeenCalled();
  });

  test('unreadable tale.json: skips quietly', async () => {
    const deps = makeDeps({
      readWorkspaceVersion: mock(async () => {
        throw new Error('invalid tale.json');
      }),
    });
    await ensureAligned('status', deps);

    expect(deps.resolveRelease).not.toHaveBeenCalled();
    expect(deps.reExec).not.toHaveBeenCalled();
  });
});
