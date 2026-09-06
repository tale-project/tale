import { afterEach, describe, expect, mock, test } from 'bun:test';

import {
  resolveOutputMode,
  setActiveOutputMode,
} from '../../utils/output-mode';
import { type ReseedDeps, reseedAllOrgsFromBuiltin } from './reseed-all-orgs';

const confirmMock = mock();

mock.module('../../utils/prompt', () => ({ confirm: confirmMock }));
mock.module('../../utils/logger', () => ({
  info: mock(),
  error: mock(),
  warn: mock(),
  step: mock(),
  success: mock(),
  header: mock(),
  blank: mock(),
  debug: mock(),
  notice: mock(),
  table: mock(),
}));

const OK_RESULT = {
  success: true,
  exitCode: 0,
  stderr: '',
  stdout: JSON.stringify({ total: 1, succeeded: 1, failed: 0, results: [] }),
};

function makeDeps(): ReseedDeps & {
  isBackendTierRunning: ReturnType<typeof mock>;
  controlCall: ReturnType<typeof mock>;
} {
  return {
    isBackendTierRunning: mock(async () => true),
    controlCall: mock(async () => OK_RESULT),
  };
}

const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

/** Pretend stdin is a pipe (CI): the non-interactive consent gate applies. */
function detachTty(): void {
  Object.defineProperty(process.stdin, 'isTTY', {
    value: undefined,
    configurable: true,
  });
}

afterEach(() => {
  confirmMock.mockReset();
  setActiveOutputMode(resolveOutputMode({}, {}));
  if (stdinDescriptor) {
    Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
  } else {
    delete (process.stdin as { isTTY?: boolean }).isTTY;
  }
});

describe('reseedAllOrgsFromBuiltin', () => {
  test('non-TTY without any --yes refuses before touching the door', async () => {
    detachTty();
    const deps = makeDeps();

    await expect(
      reseedAllOrgsFromBuiltin({ dryRun: false, assumeYes: false }, deps),
    ).rejects.toThrow('requires --yes');
    expect(deps.isBackendTierRunning).not.toHaveBeenCalled();
    expect(deps.controlCall).not.toHaveBeenCalled();
  });

  test('non-TTY under the global `tale -y` proceeds with the local flag absent', async () => {
    detachTty();
    setActiveOutputMode(resolveOutputMode({ yes: true }, {}));
    const deps = makeDeps();

    await reseedAllOrgsFromBuiltin(
      { dryRun: false, assumeYes: undefined as unknown as boolean },
      deps,
    );

    expect(confirmMock).not.toHaveBeenCalled();
    expect(deps.controlCall).toHaveBeenCalledWith(
      'POST',
      '/api/control/reseed',
      expect.objectContaining({ timeoutS: 1800 }),
    );
  });

  test('--dry-run reports without confirming or calling the door', async () => {
    detachTty();
    const deps = makeDeps();

    await reseedAllOrgsFromBuiltin({ dryRun: true, assumeYes: false }, deps);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(deps.controlCall).not.toHaveBeenCalled();
  });
});
