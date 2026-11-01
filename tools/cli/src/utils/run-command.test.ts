import { beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { detectCapabilities } from '@tale/shared/terminal';
import { configureReporter } from '@tale/shared/tux';

import {
  ExitCode,
  externalDepError,
  preconditionError,
  usageError,
} from './fail';
import { resolveOutputMode, setActiveOutputMode } from './output-mode';
import { confirm, NonInteractiveError } from './prompt';
import { action, handleError } from './run-command';

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`exit:${code}`);
  }
}

function fakeExit(code?: number | string | null): never {
  throw new ExitSignal(typeof code === 'number' ? code : 0);
}

function capture(fn: () => void | Promise<void>): {
  result: Promise<{ code: number; out: string; err: string }>;
} {
  const out: string[] = [];
  const err: string[] = [];
  const exitSpy = spyOn(process, 'exit').mockImplementation(fakeExit);
  const outSpy = spyOn(process.stdout, 'write').mockImplementation(
    (chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    },
  );
  const errSpy = spyOn(process.stderr, 'write').mockImplementation(
    (chunk: string | Uint8Array) => {
      err.push(String(chunk));
      return true;
    },
  );
  const run = async () => {
    let code = -1;
    try {
      await fn();
    } catch (e) {
      if (e instanceof ExitSignal) code = e.code;
      else throw e;
    } finally {
      exitSpy.mockRestore();
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
    return { code, out: out.join(''), err: err.join('') };
  };
  return { result: run() };
}

/** The error `confirm` throws with no terminal attached: `isInteractive()`
 *  reads the REAL TTY flags, so both are forced off while it asks. */
async function noTerminalError(): Promise<unknown> {
  const realStdinTty = process.stdin.isTTY;
  const realStdoutTty = process.stdout.isTTY;
  process.stdin.isTTY = false;
  process.stdout.isTTY = false;
  try {
    await confirm({ message: 'Deploy the selected Tale bundle?' });
    return undefined;
  } catch (e) {
    return e;
  } finally {
    process.stdin.isTTY = realStdinTty;
    process.stdout.isTTY = realStdoutTty;
  }
}

beforeEach(() => {
  configureReporter(detectCapabilities({ isTTY: false, env: {} }));
  setActiveOutputMode(resolveOutputMode({}, {}, { isTTY: false }));
});

describe('handleError — exit-code mapping', () => {
  test('precondition → 3', async () => {
    expect(
      (await capture(() => handleError(preconditionError('x'))).result).code,
    ).toBe(3);
  });
  test('usage → 2, external-dep → 5', async () => {
    expect(
      (await capture(() => handleError(usageError('x'))).result).code,
    ).toBe(2);
    expect(
      (await capture(() => handleError(externalDepError('x'))).result).code,
    ).toBe(5);
  });
  test('a prompt with no terminal → 4, naming --yes instead of a bare "Aborted."', async () => {
    const error = await noTerminalError();
    expect(error).toBeInstanceOf(NonInteractiveError);
    const r = await capture(() => handleError(error)).result;
    expect(r.code).toBe(ExitCode.UserAbort);
    expect(r.err).toContain('Deploy the selected Tale bundle?');
    expect(r.err).toContain('--yes');
    expect(r.err).not.toContain('Aborted.');
  });
  test('a declined prompt → 4 with its own message', async () => {
    const r = await capture(() =>
      handleError(new NonInteractiveError('Deployment was not confirmed.')),
    ).result;
    expect(r.code).toBe(ExitCode.UserAbort);
    expect(r.err).toContain('Deployment was not confirmed.');
  });
  test('a SIGINT-shaped exec result (exitCode 130) → 4 with a quiet "Aborted." line', async () => {
    const r = await capture(() => handleError({ exitCode: 130 })).result;
    expect(r.code).toBe(ExitCode.UserAbort);
    expect(r.err).toContain('Aborted.');
  });
  test('a plain Error → 1', async () => {
    expect(
      (await capture(() => handleError(new Error('boom'))).result).code,
    ).toBe(1);
  });
});

describe('handleError — --json mode', () => {
  test('emits a JSON error envelope on stdout and exits with the code', async () => {
    setActiveOutputMode(
      resolveOutputMode({ json: true }, {}, { isTTY: false }),
    );
    const r = await capture(() => handleError(preconditionError('no project')))
      .result;
    expect(r.code).toBe(3);
    const parsed = JSON.parse(r.out.trim());
    expect(parsed).toMatchObject({
      ok: false,
      error: { code: 3, summary: 'no project' },
    });
  });

  test('a prompt with no terminal → one envelope with code 4 that names --yes', async () => {
    const error = await noTerminalError();
    setActiveOutputMode(
      resolveOutputMode({ json: true }, {}, { isTTY: false }),
    );
    const r = await capture(() => handleError(error)).result;
    expect(r.code).toBe(ExitCode.UserAbort);
    expect(r.err).toBe('');
    expect(r.out.trim().split('\n')).toHaveLength(1);
    const parsed = JSON.parse(r.out.trim());
    expect(parsed).toMatchObject({ ok: false, error: { code: 4 } });
    expect(parsed.error.summary).toContain('--yes');
  });

  test('a user interrupt stays quiet', async () => {
    setActiveOutputMode(
      resolveOutputMode({ json: true }, {}, { isTTY: false }),
    );
    const r = await capture(() => handleError({ exitCode: 130 })).result;
    expect(r.code).toBe(ExitCode.UserAbort);
    expect(r.out + r.err).toBe('');
  });
});

describe('action()', () => {
  test('resolves on success', async () => {
    let ran = false;
    await action(async () => {
      ran = true;
    })();
    expect(ran).toBe(true);
  });

  test('routes a thrown error through handleError (mapped exit code)', async () => {
    const r = await capture(() =>
      action(async () => {
        throw externalDepError('registry down');
      })(),
    ).result;
    expect(r.code).toBe(5);
  });
});
