import { describe, expect, mock, test } from 'bun:test';

import {
  SANDBOX_RUNTIME_LOCAL_TAG,
  ensureSandboxRuntimeImage,
} from './ensure-sandbox-runtime-image';

// Fresh fakes per test, injected directly — `mock.module` is process-global in
// Bun and leaks across files.
function fakeDeps(
  overrides: { inspectOk?: boolean; pullOk?: boolean; tagOk?: boolean } = {},
) {
  const { inspectOk = false, pullOk = true, tagOk = true } = overrides;
  const docker = mock((...args: string[]) => {
    if (args[0] === 'image' && args[1] === 'inspect') {
      return Promise.resolve({
        success: inspectOk,
        exitCode: inspectOk ? 0 : 1,
        stdout: '',
        stderr: inspectOk ? '' : 'No such image',
      });
    }
    if (args[0] === 'tag') {
      return Promise.resolve({
        success: tagOk,
        exitCode: tagOk ? 0 : 1,
        stdout: '',
        stderr: tagOk ? '' : 'tag refused',
      });
    }
    return Promise.resolve({
      success: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
  });
  return {
    docker,
    pullImage: mock(() => Promise.resolve(pullOk)),
    logger: { info: mock(), warn: mock() },
  };
}

const REGISTRY = 'ghcr.io/tale-project/tale';

describe('ensureSandboxRuntimeImage', () => {
  test('leaves a locally built image alone', async () => {
    const deps = fakeDeps({ inspectOk: true });

    expect(await ensureSandboxRuntimeImage(REGISTRY, '0.5.11', deps)).toBe(
      'present',
    );
    // Overwriting a contributor's source build with a released image would
    // silently discard what they are testing.
    expect(deps.pullImage).not.toHaveBeenCalled();
    expect(deps.docker).toHaveBeenCalledTimes(1);
  });

  test('pulls and re-tags when the spawner tag is missing', async () => {
    const deps = fakeDeps();

    expect(await ensureSandboxRuntimeImage(REGISTRY, '0.5.11', deps)).toBe(
      'fetched',
    );
    expect(deps.pullImage).toHaveBeenCalledWith(
      `${REGISTRY}/tale-sandbox-runtime:0.5.11`,
    );
    expect(deps.docker).toHaveBeenCalledWith(
      'tag',
      `${REGISTRY}/tale-sandbox-runtime:0.5.11`,
      SANDBOX_RUNTIME_LOCAL_TAG,
    );
  });

  test('warns instead of throwing when the pull fails', async () => {
    const deps = fakeDeps({ pullOk: false });

    // The rest of the stack is usable without a sandbox; a registry hiccup
    // must not block a local bring-up.
    expect(await ensureSandboxRuntimeImage(REGISTRY, '0.5.11', deps)).toBe(
      'unavailable',
    );
    expect(deps.logger.warn).toHaveBeenCalled();
    const [message] = deps.logger.warn.mock.calls[0] as [string];
    expect(message).toContain('Run code');
  });

  test('warns when the pull lands but the tag does not', async () => {
    const deps = fakeDeps({ tagOk: false });

    expect(await ensureSandboxRuntimeImage(REGISTRY, '0.5.11', deps)).toBe(
      'unavailable',
    );
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  test('follows the version it is given', async () => {
    const deps = fakeDeps();

    await ensureSandboxRuntimeImage(REGISTRY, 'latest', deps);

    expect(deps.pullImage).toHaveBeenCalledWith(
      `${REGISTRY}/tale-sandbox-runtime:latest`,
    );
  });
});
