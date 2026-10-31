import { afterEach, describe, expect, mock, test } from 'bun:test';

import {
  resolveOutputMode,
  setActiveOutputMode,
} from '../../utils/output-mode';
import { type ReseedDeps, reseedAllOrgsFromBuiltin } from './reseed-all-orgs';

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
  backendApiContainer: ReturnType<typeof mock>;
  controlCall: ReturnType<typeof mock>;
} {
  return {
    // The api is a replica set; the door is addressed to a discovered one.
    backendApiContainer: mock(async () => 'tale-blue-backend-api-1'),
    controlCall: mock(async () => OK_RESULT),
  };
}

const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

/** Pretend stdin is a pipe (CI). */
function detachTty(): void {
  Object.defineProperty(process.stdin, 'isTTY', {
    value: undefined,
    configurable: true,
  });
}

afterEach(() => {
  setActiveOutputMode(resolveOutputMode({}, {}));
  if (stdinDescriptor) {
    Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
  } else {
    delete (process.stdin as { isTTY?: boolean }).isTTY;
  }
});

describe('reseedAllOrgsFromBuiltin', () => {
  // Consent is confirmOverrideAll's, asked before the deploy began
  // (run-deploy.test.ts): a second gate here, after the rollout, would
  // refuse or ask over a deployment that is already live.
  test('reseeds through the door without asking again, even without a terminal or --yes', async () => {
    detachTty();
    setActiveOutputMode(resolveOutputMode({}, {}));
    const deps = makeDeps();

    await reseedAllOrgsFromBuiltin({ dryRun: false }, deps);

    expect(deps.controlCall).toHaveBeenCalledWith(
      'POST',
      '/api/control/reseed',
      expect.objectContaining({
        container: 'tale-blue-backend-api-1',
        timeoutS: 1800,
      }),
    );
  });

  test('--dry-run reports without looking up the api or calling the door', async () => {
    const deps = makeDeps();

    await reseedAllOrgsFromBuiltin({ dryRun: true }, deps);

    expect(deps.backendApiContainer).not.toHaveBeenCalled();
    expect(deps.controlCall).not.toHaveBeenCalled();
  });
});
