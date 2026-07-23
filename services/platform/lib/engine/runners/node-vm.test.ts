import { describe, expect, it } from 'vitest';

import { nodeVmRunner } from './node-vm';

const LIMITS = { timeoutMs: 200 };

describe('nodeVmRunner — the data-only calling convention', () => {
  const runner = nodeVmRunner();

  it('evaluates expressions against the scope', async () => {
    await expect(
      runner.evalExpr('a + b.c', { a: 1, b: { c: 2 } }, LIMITS),
    ).resolves.toBe(3);
  });

  it('runs function bodies that return', async () => {
    await expect(
      runner.runBody(
        'return input.map((x) => x * 2);',
        { input: [1, 2] },
        LIMITS,
      ),
    ).resolves.toEqual([2, 4]);
  });

  it('scope crosses as data: host functions and prototypes never arrive', async () => {
    const scope = {
      fn: (() => 'host') as unknown as Record<string, unknown>,
      obj: Object.assign(Object.create({ proto: 'leak' }), { own: 1 }),
    };
    // A function is not JSON — it simply does not exist inside.
    await expect(runner.evalExpr('typeof fn', scope, LIMITS)).resolves.toBe(
      'undefined',
    );
    await expect(
      runner.evalExpr(
        'obj.proto === undefined && obj.own === 1',
        scope,
        LIMITS,
      ),
    ).resolves.toBe(true);
  });

  it('results come back as data: returned functions vanish, cycles fail loudly', async () => {
    await expect(
      runner.evalExpr('({ f: () => 1, v: 2 })', {}, LIMITS),
    ).resolves.toEqual({ v: 2 });
    await expect(
      runner.runBody('const a = {}; a.self = a; return a;', {}, LIMITS),
    ).rejects.toThrow();
  });

  it('enforces the wall-clock cap', async () => {
    await expect(
      runner.evalExpr('(() => { for (;;) {} })()', {}, { timeoutMs: 50 }),
    ).rejects.toThrow(/timed? ?out/i);
  });

  it('blocks eval-style code generation', async () => {
    await expect(
      runner.evalExpr('eval("1 + 1")', {}, LIMITS),
    ).rejects.toThrow();
  });

  it('checkExpr/checkBody report syntax errors without executing', async () => {
    await expect(runner.checkExpr('a +')).resolves.toMatch(/Unexpected/);
    await expect(runner.checkExpr('a + b')).resolves.toBeNull();
    await expect(runner.checkBody('return 1;')).resolves.toBeNull();
    await expect(runner.checkBody('return (;')).resolves.toMatch(/Unexpected/);
  });

  it('scope keys that are not identifiers are dropped, not quoted in', async () => {
    await expect(
      runner.evalExpr('typeof valid', { valid: 1, 'not-valid': 2 }, LIMITS),
    ).resolves.toBe('number');
  });

  describe('async bodies — the connector live-body shape', () => {
    it('rejects top-level await when the body is synchronous', async () => {
      await expect(
        runner.checkBody('const v = await go(); return v;'),
      ).resolves.toMatch(/await/i);
    });

    it('compiles and runs the same body as async', async () => {
      await expect(
        runner.checkBody('const v = await go(); return v;', { async: true }),
      ).resolves.toBeNull();
      await expect(
        runner.runBody(
          'const doubled = await Promise.resolve(input.n * 2);\nreturn { doubled };',
          { input: { n: 21 } },
          LIMITS,
          { async: true },
        ),
      ).resolves.toEqual({ doubled: 42 });
    });

    it('keeps the data-only convention for async results', async () => {
      await expect(
        runner.runBody(
          'return await Promise.resolve({ fn: function () {}, keep: 1 });',
          {},
          LIMITS,
          { async: true },
        ),
      ).resolves.toEqual({ keep: 1 });
    });

    it('surfaces a rejected body as a rejection', async () => {
      await expect(
        runner.runBody('await Promise.reject(new Error("boom"));', {}, LIMITS, {
          async: true,
        }),
      ).rejects.toThrow(/boom/);
    });
  });
});
