import { describe, expect, mock, test } from 'bun:test';

import { pruneSupersededImages } from './prune-superseded-images';

const REGISTRY = 'ghcr.io/tale-project/tale';

// Fresh fakes per test, injected directly — `mock.module` is process-global in
// Bun and leaks across files.
function fakeDeps(
  images: string[],
  {
    listOk = true,
    refuse = {},
  }: { listOk?: boolean; refuse?: Record<string, string> } = {},
) {
  const docker = mock((...args: string[]) => {
    if (args[0] === 'image' && args[1] === 'ls') {
      return Promise.resolve({
        success: listOk,
        exitCode: listOk ? 0 : 1,
        stdout: listOk ? `${images.join('\n')}\n` : '',
        stderr: listOk ? '' : 'Cannot connect to the Docker daemon',
      });
    }
    const reference = args[2] ?? '';
    const stderr = refuse[reference];
    return Promise.resolve({
      success: stderr === undefined,
      exitCode: stderr === undefined ? 0 : 1,
      stdout: '',
      stderr: stderr ?? '',
    });
  });
  return { docker, logger: { info: mock(), warn: mock(), debug: mock() } };
}

const removedBy = (docker: ReturnType<typeof fakeDeps>['docker']) =>
  docker.mock.calls
    .filter((call) => call[0] === 'image' && call[1] === 'rm')
    .map((call) => call[2]);

describe('pruneSupersededImages', () => {
  test('removes versions older than the live and rollback versions', async () => {
    const deps = fakeDeps([
      `${REGISTRY}/tale-sandbox-runtime:0.5.78`,
      `${REGISTRY}/tale-sandbox-runtime:0.5.77`,
      `${REGISTRY}/tale-sandbox-runtime:0.5.76`,
      `${REGISTRY}/tale-platform:0.5.78`,
      `${REGISTRY}/tale-platform:0.5.77`,
      `${REGISTRY}/tale-platform:0.5.70`,
      `${REGISTRY}/tale-db:0.4.9`,
    ]);

    const result = await pruneSupersededImages(
      REGISTRY,
      ['0.5.78', '0.5.77'],
      deps,
    );

    expect(removedBy(deps.docker)).toEqual([
      `${REGISTRY}/tale-sandbox-runtime:0.5.76`,
      `${REGISTRY}/tale-platform:0.5.70`,
      `${REGISTRY}/tale-db:0.4.9`,
    ]);
    expect(result).toEqual({
      removed: removedBy(deps.docker),
      inUse: [],
      failed: [],
    });
  });

  test('keeps an image loaded ahead for a later version', async () => {
    const deps = fakeDeps([
      `${REGISTRY}/tale-platform:0.5.79`,
      `${REGISTRY}/tale-platform:0.5.78`,
      `${REGISTRY}/tale-platform:0.5.76`,
    ]);

    await pruneSupersededImages(REGISTRY, ['0.5.78', '0.5.77'], deps);

    expect(removedBy(deps.docker)).toEqual([
      `${REGISTRY}/tale-platform:0.5.76`,
    ]);
  });

  test('keeps the rollback target after a downgrade', async () => {
    // Deploying 0.5.76 over 0.5.78 records 0.5.78 as the rollback target.
    const deps = fakeDeps([
      `${REGISTRY}/tale-platform:0.5.78`,
      `${REGISTRY}/tale-platform:0.5.76`,
      `${REGISTRY}/tale-platform:0.5.75`,
    ]);

    await pruneSupersededImages(REGISTRY, ['0.5.76', '0.5.78'], deps);

    expect(removedBy(deps.docker)).toEqual([
      `${REGISTRY}/tale-platform:0.5.75`,
    ]);
  });

  test('keeps the newest earlier version when no distinct rollback target is recorded', async () => {
    const deps = fakeDeps([
      `${REGISTRY}/tale-platform:0.5.78`,
      `${REGISTRY}/tale-platform:0.5.77`,
      `${REGISTRY}/tale-sandbox-runtime:0.5.77`,
      `${REGISTRY}/tale-platform:0.5.76`,
    ]);

    // A redeploy of the live version records it as its own rollback target.
    await pruneSupersededImages(REGISTRY, ['0.5.78', '0.5.78'], deps);

    expect(removedBy(deps.docker)).toEqual([
      `${REGISTRY}/tale-platform:0.5.76`,
    ]);
  });

  test('touches only release tags of this registry’s tale repositories', async () => {
    const deps = fakeDeps([
      `${REGISTRY}/tale-sandbox-runtime:latest`,
      `${REGISTRY}/tale-platform:pr-4512`,
      `${REGISTRY}/tale-platform:<none>`,
      'tale-sandbox-runtime:latest',
      'tale-sandbox-runtime:0.5.1',
      'ghcr.io/someone-else/tale/tale-platform:0.1.0',
      `${REGISTRY}/other-service:0.1.0`,
      'postgres:16.4',
      `${REGISTRY}/tale-platform:0.5.70`,
    ]);

    await pruneSupersededImages(REGISTRY, ['0.5.78', '0.5.77'], deps);

    expect(removedBy(deps.docker)).toEqual([
      `${REGISTRY}/tale-platform:0.5.70`,
    ]);
  });

  test('never forces: an image a container uses is reported and kept', async () => {
    const inUse = `${REGISTRY}/tale-sandbox-runtime:0.5.70`;
    const broken = `${REGISTRY}/tale-platform:0.5.70`;
    const deps = fakeDeps([inUse, broken, `${REGISTRY}/tale-db:0.5.70`], {
      refuse: {
        [inUse]:
          'Error response from daemon: conflict: unable to remove repository reference "…" (must force) - container 1f2e is using its referenced image 9a8b',
        [broken]: 'Error response from daemon: unexpected I/O error',
      },
    });

    const result = await pruneSupersededImages(
      REGISTRY,
      ['0.5.78', '0.5.77'],
      deps,
    );

    expect(
      deps.docker.mock.calls.some((call) => call.includes('--force')),
    ).toBe(false);
    expect(result).toEqual({
      removed: [`${REGISTRY}/tale-db:0.5.70`],
      inUse: [inUse],
      failed: [broken],
    });
    expect(deps.logger.warn).toHaveBeenCalledTimes(1);
  });

  test('a dry run lists what it would remove and removes nothing', async () => {
    const deps = fakeDeps([
      `${REGISTRY}/tale-platform:0.5.78`,
      `${REGISTRY}/tale-platform:0.5.70`,
    ]);

    const result = await pruneSupersededImages(REGISTRY, ['0.5.78', '0.5.77'], {
      ...deps,
      dryRun: true,
    });

    expect(result.removed).toEqual([`${REGISTRY}/tale-platform:0.5.70`]);
    expect(removedBy(deps.docker)).toEqual([]);
  });

  test('does nothing without a known version to keep', async () => {
    const deps = fakeDeps([`${REGISTRY}/tale-platform:0.5.70`]);

    await pruneSupersededImages(REGISTRY, [null, 'latest'], deps);

    expect(deps.docker).not.toHaveBeenCalled();
  });

  test('an unreachable daemon is a warning, not a failure', async () => {
    const deps = fakeDeps([], { listOk: false });

    const result = await pruneSupersededImages(
      REGISTRY,
      ['0.5.78', '0.5.77'],
      deps,
    );

    expect(result).toEqual({ removed: [], inUse: [], failed: [] });
    expect(deps.logger.warn).toHaveBeenCalledTimes(1);
  });
});
