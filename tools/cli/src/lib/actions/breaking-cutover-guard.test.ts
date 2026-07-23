import { describe, expect, mock, test } from 'bun:test';

import { checkBreakingCutover } from './breaking-cutover-guard';

function makeDeps(
  overrides: Partial<Parameters<typeof checkBreakingCutover>[1]> = {},
) {
  return {
    getCurrentColor: mock(async () => 'blue' as const),
    getContainerVersion: mock(async () => '0.3.11'),
    getPreviousVersion: mock(async () => null),
    getProjectId: mock(() => 'tale'),
    ...overrides,
  };
}

const BASE = { deployDir: '/project', targetVersion: '0.4.0' };

describe('checkBreakingCutover', () => {
  test('refuses deploying >= 0.4 over a running pre-0.4 instance', async () => {
    const deps = makeDeps();
    await expect(checkBreakingCutover(BASE, deps)).rejects.toThrow(
      /breaking release with no upgrade path/,
    );
    expect(deps.getContainerVersion).toHaveBeenCalledWith('tale-platform-blue');
  });

  test('passes on a first deploy (no color state)', async () => {
    const deps = makeDeps({ getCurrentColor: mock(async () => null) });
    await expect(checkBreakingCutover(BASE, deps)).resolves.toBeUndefined();
    expect(deps.getContainerVersion).not.toHaveBeenCalled();
  });

  test('passes when the running instance is already post-baseline', async () => {
    const deps = makeDeps({ getContainerVersion: mock(async () => '0.4.2') });
    await expect(
      checkBreakingCutover({ ...BASE, targetVersion: '0.4.3' }, deps),
    ).resolves.toBeUndefined();
  });

  test('falls back to the previous-version state file when the container label is unreadable', async () => {
    const deps = makeDeps({
      getContainerVersion: mock(async () => null),
      getPreviousVersion: mock(async () => '0.4.1'),
    });
    await expect(checkBreakingCutover(BASE, deps)).resolves.toBeUndefined();
    expect(deps.getPreviousVersion).toHaveBeenCalledWith('/project');
  });

  test('refuses conservatively when deployment state exists but no version is determinable', async () => {
    const deps = makeDeps({
      getContainerVersion: mock(async () => null),
      getPreviousVersion: mock(async () => null),
    });
    await expect(checkBreakingCutover(BASE, deps)).rejects.toThrow(
      /cannot be determined/,
    );
  });

  test('--accept-data-loss proceeds with a warning instead of refusing', async () => {
    const deps = makeDeps();
    await expect(
      checkBreakingCutover({ ...BASE, acceptDataLoss: true }, deps),
    ).resolves.toBeUndefined();
  });

  test('dry-run reports the refusal without throwing', async () => {
    const deps = makeDeps();
    await expect(
      checkBreakingCutover({ ...BASE, dryRun: true }, deps),
    ).resolves.toBeUndefined();
  });

  test('dev builds deploying `latest` are guarded like post-baseline targets', async () => {
    const deps = makeDeps();
    await expect(
      checkBreakingCutover({ ...BASE, targetVersion: 'latest' }, deps),
    ).rejects.toThrow(/breaking release/);
  });

  test('a pre-baseline target (old CLI line) is not guarded', async () => {
    const deps = makeDeps();
    await expect(
      checkBreakingCutover({ ...BASE, targetVersion: '0.3.12' }, deps),
    ).resolves.toBeUndefined();
    expect(deps.getCurrentColor).not.toHaveBeenCalled();
  });
});
