import { describe, expect, mock, test } from 'bun:test';

import { pullImage } from './pull-image';

// Fresh fakes per test, injected directly — no `mock.module`, which is
// process-global in Bun and leaks across files (the shared docker/logger
// mocks used to make this suite order-fragile on Windows).
function fakeDeps() {
  return {
    docker: mock(),
    logger: { info: mock(), error: mock(), warn: mock() },
  };
}

describe('pullImage', () => {
  test('returns true on successful pull', async () => {
    const deps = fakeDeps();
    deps.docker.mockResolvedValue({ success: true, stdout: '', stderr: '' });

    const result = await pullImage(
      'ghcr.io/tale-project/tale/tale-platform:0.2.16',
      deps,
    );

    expect(result).toBe(true);
    expect(deps.docker).toHaveBeenCalledWith(
      'pull',
      'ghcr.io/tale-project/tale/tale-platform:0.2.16',
    );
  });

  test('returns false and logs error on failed pull', async () => {
    const deps = fakeDeps();
    deps.docker.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'some docker error',
    });

    const result = await pullImage(
      'ghcr.io/tale-project/tale/tale-platform:0.2.16',
      deps,
    );

    expect(result).toBe(false);
    expect(deps.logger.error).toHaveBeenCalled();
  });

  test('shows timing hint when manifest is not found', async () => {
    const deps = fakeDeps();
    deps.docker.mockResolvedValue({
      success: false,
      stdout: '',
      stderr:
        'Error response from daemon: manifest for ghcr.io/tale-project/tale/tale-platform:0.2.16 not found',
    });

    const result = await pullImage(
      'ghcr.io/tale-project/tale/tale-platform:0.2.16',
      deps,
    );

    expect(result).toBe(false);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('images may still be building'),
    );
  });

  test('shows timing hint for manifest unknown error', async () => {
    const deps = fakeDeps();
    deps.docker.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'manifest unknown: manifest unknown',
    });

    const result = await pullImage(
      'ghcr.io/tale-project/tale/tale-db:1.0.0',
      deps,
    );

    expect(result).toBe(false);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('images may still be building'),
    );
  });

  test('shows raw stderr for non-manifest errors', async () => {
    const deps = fakeDeps();
    deps.docker.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'network timeout connecting to registry',
    });

    const result = await pullImage(
      'ghcr.io/tale-project/tale/tale-platform:0.2.16',
      deps,
    );

    expect(result).toBe(false);
    expect(deps.logger.warn).not.toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalledWith(
      'network timeout connecting to registry',
    );
  });

  test('handles thrown exceptions gracefully', async () => {
    const deps = fakeDeps();
    deps.docker.mockRejectedValue(new Error('spawn failed'));

    const result = await pullImage(
      'ghcr.io/tale-project/tale/tale-proxy:0.2.16',
      deps,
    );

    expect(result).toBe(false);
    expect(deps.logger.error).toHaveBeenCalledWith('spawn failed');
  });
});
