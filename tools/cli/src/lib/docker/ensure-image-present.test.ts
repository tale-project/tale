import { describe, expect, mock, test } from 'bun:test';

import { ensureImagePresent, imagePresent } from './ensure-image-present';

const IMAGE = 'ghcr.io/tale-project/tale/tale-platform:0.5.12';

function fakeDeps({ present = false, pullOk = true } = {}) {
  return {
    docker: mock(() =>
      Promise.resolve({
        success: present,
        exitCode: present ? 0 : 1,
        stdout: '',
        stderr: present ? '' : 'No such image',
      }),
    ),
    pullImage: mock(() => Promise.resolve(pullOk)),
    logger: { warn: mock() },
  };
}

describe('ensureImagePresent', () => {
  test('does not pull an image the daemon already holds', async () => {
    const deps = fakeDeps({ present: true });

    expect(await ensureImagePresent(IMAGE, deps)).toBe(true);
    expect(deps.pullImage).not.toHaveBeenCalled();
  });

  test('pulls a missing image', async () => {
    const deps = fakeDeps();

    expect(await ensureImagePresent(IMAGE, deps)).toBe(true);
    expect(deps.pullImage).toHaveBeenCalledWith(IMAGE);
  });

  test('warns instead of throwing when the pull fails', async () => {
    const deps = fakeDeps({ pullOk: false });

    // Compose pulls the same image moments later and reports its own failure;
    // throwing here would surface two errors for one cause.
    expect(await ensureImagePresent(IMAGE, deps)).toBe(false);
    expect(deps.logger.warn).toHaveBeenCalled();
  });
});

describe('imagePresent', () => {
  test('asks the daemon and reports what it says', async () => {
    const deps = fakeDeps({ present: true });

    expect(await imagePresent(IMAGE, deps.docker)).toBe(true);
    expect(deps.docker).toHaveBeenCalledWith('image', 'inspect', IMAGE);
  });
});
