import { describe, expect, test } from 'bun:test';

import { lint } from '../src/lint';
import { repo, root } from './factories';

function run(read: Parameters<typeof lint>[0]['read']) {
  const out: string[] = [];
  const err: string[] = [];
  const code = lint({
    root: '/nowhere',
    log: (line) => out.push(line),
    error: (line) => err.push(line),
    read,
  });
  return { code, out, err };
}

describe('lint', () => {
  test('a clean tree exits 0 and reports every rule', () => {
    const { code, out, err } = run(() => repo());
    expect(code).toBe(0);
    expect(out.slice(0, 4)).toEqual([
      'ok    layout',
      'ok    suites',
      'ok    runs',
      'ok    references',
    ]);
    expect(out.at(-1)).toBe(
      '      1 tree(s), 2 boxes: services/app/tests/manual',
    );
    expect(err).toEqual([]);
  });

  test('a broken tree exits 1 and points at the line', () => {
    const { code, err } = run(() => repo(root({ entries: ['suites'] })));
    expect(code).toBe(1);
    expect(err[0]).toBe('FAIL  layout (5)');
    expect(err[1]).toContain('missing `readme.md`');
  });

  test('a checkout with no manual layer is not a failure', () => {
    const { code, out } = run(() => ({ roots: [] }));
    expect(code).toBe(0);
    expect(out).toEqual([
      'lint:manual — no tests/manual tree in this checkout',
    ]);
  });

  test('a finding with a line number prints it', () => {
    const ticked = root();
    ticked.suites[0].boxes[0].ticked = true;
    const { err } = run(() => repo(ticked));
    expect(err.some((line) => /suites\/smoke\.md:7 — /.test(line))).toBe(true);
  });
});
