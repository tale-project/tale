// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { findIoAccess, hasTopLevelReturn } from './body';
import { scopeNamesFor } from './globals';
import { parseBody } from './parse';

function ast(code: string) {
  const parsed = parseBody(code);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.ast;
}

const io = (code: string) =>
  findIoAccess(ast(code), code, scopeNamesFor('code'));

describe('findIoAccess', () => {
  it('names the first module, network or process access', () => {
    expect(io('const r = fetch ("x");\nreturn require("fs");')).toEqual({
      token: 'fetch (',
      range: [10, 17],
    });
    expect(io('return process.env.HOME;')?.token).toBe('process.');
    expect(io('return import("x");')?.token).toBe('import(');
  });

  it('ignores strings, comments and locals of the same name', () => {
    expect(
      io(
        [
          '// fetch("x") would fail',
          'const label = "process.env";',
          'const fetch = (u) => u;',
          'return fetch(label);',
        ].join('\n'),
      ),
    ).toBeNull();
  });
});

describe('hasTopLevelReturn', () => {
  it('counts only a return of the body itself', () => {
    expect(hasTopLevelReturn(ast('if (input.x) { return 1; }'))).toBe(true);
    expect(hasTopLevelReturn(ast('const f = () => { return 1; };'))).toBe(
      false,
    );
    expect(hasTopLevelReturn(ast('// return 1\nconst a = 1;'))).toBe(false);
  });
});
