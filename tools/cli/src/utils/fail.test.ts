import { beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { detectCapabilities } from '@tale/shared/terminal';
import { configureReporter } from '@tale/shared/tux';

import {
  CliError,
  ExitCode,
  externalDepError,
  failWith,
  preconditionError,
  usageError,
} from './fail';
import { resolveOutputMode, setActiveOutputMode } from './output-mode';

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`exit:${code}`);
  }
}

function fakeExit(code?: number | string | null): never {
  throw new ExitSignal(typeof code === 'number' ? code : 0);
}

/** Run `fn`, capturing the exit code + stdout/stderr (process.exit → throw). */
function capture(fn: () => void): { code: number; out: string; err: string } {
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
  let code = -1;
  try {
    fn();
  } catch (e) {
    if (e instanceof ExitSignal) code = e.code;
    else throw e;
  } finally {
    exitSpy.mockRestore();
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
  return { code, out: out.join(''), err: err.join('') };
}

beforeEach(() => {
  configureReporter(detectCapabilities({ isTTY: false, env: {} }));
  setActiveOutputMode(resolveOutputMode({}, {}, { isTTY: false }));
});

describe('failWith — exit codes', () => {
  test('maps each error class to its code', () => {
    expect(
      capture(() => failWith({ summary: 'x', code: ExitCode.Generic })).code,
    ).toBe(1);
    expect(capture(() => failWith(preconditionError('x').info)).code).toBe(3);
    expect(capture(() => failWith(usageError('x').info)).code).toBe(2);
    expect(
      capture(() => failWith(externalDepError('x', new Error('y')).info)).code,
    ).toBe(5);
  });

  test('a bare summary defaults to the generic code', () => {
    expect(capture(() => failWith({ summary: 'boom' })).code).toBe(1);
  });
});

describe('failWith — rendering', () => {
  test('summary goes to stderr; cause + next-steps to stdout', () => {
    const r = capture(() =>
      failWith({
        summary: 'it broke',
        cause: new Error('underlying'),
        next: ['do a', 'do b'],
        code: ExitCode.Precondition,
      }),
    );
    expect(r.err).toContain('it broke');
    expect(r.out).toContain('Cause: underlying');
    expect(r.out).toContain('Try:');
    expect(r.out).toContain('do a');
  });

  test('verbose mode appends the stack', () => {
    setActiveOutputMode(
      resolveOutputMode({ verbose: true }, {}, { isTTY: false }),
    );
    const cause = new Error('deep');
    const r = capture(() => failWith({ summary: 's', cause }));
    expect(r.out).toContain('Cause: deep');
    // the stack has more than the message line
    expect(r.out.split('\n').length).toBeGreaterThan(2);
  });

  test('CliError carries its info', () => {
    const e = preconditionError('np', ['tale init']);
    expect(e).toBeInstanceOf(CliError);
    expect(e.info.code).toBe(ExitCode.Precondition);
    expect(e.info.next).toEqual(['tale init']);
  });
});
