import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('nodeVmRunner — the fault boundary (a supervised child process)', () => {
  // A small heap so the runaway body dies fast; a short grace so a parked
  // await is killed promptly after vm's own timeout would have fired.
  const runner = nodeVmRunner({ maxHeapMb: 64, killGraceMs: 100 });
  const ALLOCATE_FOREVER =
    'const a = []; for (;;) a.push(new Array(1e6).fill(1)); return a.length;';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a body that allocates past the heap cap fails alone and the runner keeps serving', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      runner.runBody(ALLOCATE_FOREVER, {}, { timeoutMs: 10_000 }),
    ).rejects.toThrow(/heap|out of memory|process died/i);
    // The process that hosts this test is still here, and so is the runner:
    // the death was contained to the evaluation and its child process.
    await expect(runner.evalExpr('2 * 21', {}, LIMITS)).resolves.toBe(42);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/node-vm runner process died .*restarting/),
    );
  });

  it('a body parked inside await is killed at the deadline', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const started = Date.now();
    await expect(
      runner.runBody(
        'await new Promise(() => {}); return 1;',
        {},
        { timeoutMs: 200 },
        { async: true },
      ),
    ).rejects.toThrow(/timed out after 200ms.*killed/);
    expect(Date.now() - started).toBeLessThan(2_000);
    await expect(runner.evalExpr('"alive"', {}, LIMITS)).resolves.toBe('alive');
  });

  it('an evaluation queued behind a runaway body is served, not failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runaway = runner.runBody(ALLOCATE_FOREVER, {}, { timeoutMs: 10_000 });
    const queued = runner.evalExpr('40 + 2', {}, LIMITS);
    await expect(runaway).rejects.toThrow();
    await expect(queued).resolves.toBe(42);
  });

  it("dates evaluate in the host's zone: the runner process inherits TZ, not the rest of the environment", async () => {
    await expect(
      runner.evalExpr('new Date(0).getTimezoneOffset()', {}, LIMITS),
    ).resolves.toBe(new Date(0).getTimezoneOffset());
  });

  it("a busy loop hits vm's own timeout without costing the process", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      runner.evalExpr('(() => { for (;;) {} })()', {}, { timeoutMs: 50 }),
    ).rejects.toThrow(/timed out/i);
    await expect(runner.evalExpr('1', {}, LIMITS)).resolves.toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
