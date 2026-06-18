import { describe, expect, spyOn, test } from 'bun:test';

import { emitJson, emitJsonError } from './json-output';

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`exit:${code}`);
  }
}

function fakeExit(code?: number | string | null): never {
  throw new ExitSignal(typeof code === 'number' ? code : 0);
}

function capture(fn: () => void): { code: number; out: string } {
  const out: string[] = [];
  const exitSpy = spyOn(process, 'exit').mockImplementation(fakeExit);
  const outSpy = spyOn(process.stdout, 'write').mockImplementation(
    (chunk: string | Uint8Array) => {
      out.push(String(chunk));
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
  }
  return { code, out: out.join('') };
}

describe('emitJson', () => {
  test('writes exactly one parseable success envelope to stdout', () => {
    const { out } = capture(() => emitJson('status', { active: 'blue' }));
    expect(out.split('\n').filter(Boolean)).toHaveLength(1);
    const parsed = JSON.parse(out.trim());
    expect(parsed).toEqual({
      ok: true,
      command: 'status',
      data: { active: 'blue' },
    });
    expect(out).not.toContain('\x1b'); // zero escapes
  });
});

describe('emitJsonError', () => {
  test('writes a failure envelope and exits with the code', () => {
    const { code, out } = capture(() =>
      emitJsonError({ summary: 'no project', code: 3 }, 'status'),
    );
    expect(code).toBe(3);
    const parsed = JSON.parse(out.trim());
    expect(parsed).toEqual({
      ok: false,
      command: 'status',
      error: { summary: 'no project', code: 3, cause: undefined },
    });
  });
});
