import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RunnerLimits } from '../core/runner';
import { parseExpressionIn } from '../core/syntax/parse';
import { instrument, probePlan } from '../core/syntax/probe';
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

describe('nodeVmRunner — the deadline charges the evaluation, nothing around it', () => {
  // The short grace of the fault-boundary suite: a millisecond charged to
  // the wrong party shows up as a kill here.
  const runner = nodeVmRunner({ killGraceMs: 100 });
  const busyHost = (ms: number): void => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      // stall the host event loop on purpose
    }
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a large scope loads on its own budget, never on the expression’s', async () => {
    // Every prior node output rides along with each expression, and one
    // quarter's document extractions are this big. The expression itself is
    // a lookup; its budget must not pay for shipping and parsing the rest.
    const big = Array.from({ length: 300_000 }, (_, i) => ({
      id: i,
      text: 'x'.repeat(48),
    }));
    await expect(
      runner.evalExpr('small.v', { small: { v: 7 }, big }, { timeoutMs: 100 }),
    ).resolves.toBe(7);
  });

  it('a host event-loop stall after the child answered does not kill it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await runner.evalExpr('1', {}, LIMITS); // the process is up and acked
    const pending = runner.evalExpr(
      '(() => { const until = Date.now() + 80; while (Date.now() < until) {} return "done"; })()',
      {},
      { timeoutMs: 200 },
    );
    // The `started` ack has been processed and the deadline (200 + 100) is
    // armed; the answer lands in the pipe ~80ms in. Then the host is busy in
    // an I/O-phase callback for longer than the deadline — as a worker
    // process is when it clones a big scope or handles a database result.
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        busyHost(600);
        resolve();
      });
    });
    await expect(pending).resolves.toBe('done');
    expect(warn).not.toHaveBeenCalled();
  });

  it('a `__proto__` key in the data is a key, not a prototype', async () => {
    const o: unknown = JSON.parse('{"__proto__": {"x": 1}, "own": 2}');
    // `o.x` is undefined — null once it crosses back as JSON.
    await expect(
      runner.evalExpr('[o.x, o.own, Object.keys(o).length]', { o }, LIMITS),
    ).resolves.toEqual([null, 2, 2]);
  });
});

/** `text` with its planned probes spliced in. */
function instrumented(text: string): string {
  const parsed = parseExpressionIn(text, 0, text.length);
  if (!parsed.ok) throw new Error(parsed.message);
  const source = instrument(text, [0, text.length], probePlan(parsed));
  if (source === null) throw new Error('not instrumentable');
  return source;
}

describe('nodeVmRunner — probed expressions', () => {
  const runner = nodeVmRunner({ killGraceMs: 100 });
  async function evalExprProbed(
    source: string,
    scope: Record<string, unknown>,
    limits: RunnerLimits,
  ) {
    const answer = await runner.evalExprProbed?.(source, scope, limits);
    if (answer === undefined) throw new Error('node-vm probes');
    return answer;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers the value and what each probed sub-expression held', async () => {
    await expect(
      evalExprProbed(instrumented('input.n > 5'), { input: { n: 7 } }, LIMITS),
    ).resolves.toEqual({
      value: true,
      probes: [
        [1, { kind: 'number', text: '7', bytes: 1 }],
        [0, { kind: 'boolean', text: 'true', bytes: 4 }],
      ],
    });
  });

  it('answers an error the expression throws, in the words evalExpr rejects with', async () => {
    const scope = { input: { a: 2 } };
    const text = 'input.a > 1 && input.a.b.c';
    const answer = await evalExprProbed(instrumented(text), scope, LIMITS);
    const plain = await runner
      .evalExpr(text, scope, LIMITS)
      .catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    expect(answer.error).toEqual({ message: plain, name: 'TypeError' });
    expect(answer.value).toBeUndefined();
    expect(answer.probes.map(([k]) => k)).toEqual([2, 1]);
  });

  it('still rejects a timeout, and keeps serving', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      evalExprProbed(
        instrumented('input.n + (() => { for (;;) {} })()'),
        { input: { n: 1 } },
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow(/timed out/i);
    await expect(
      evalExprProbed(instrumented('input.n'), { input: { n: 1 } }, LIMITS),
    ).resolves.toMatchObject({ value: 1 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('evaluates in a fresh context each time, scope keys bound as evalExpr binds them', async () => {
    await evalExprProbed('(globalThis.leak = 1)', {}, LIMITS);
    await expect(
      evalExprProbed('typeof globalThis.leak', {}, LIMITS),
    ).resolves.toMatchObject({ value: 'undefined' });
    const scope = { input: 1, nodes: {}, 'not-valid': 2 };
    await expect(
      evalExprProbed('arguments.length', scope, LIMITS),
    ).resolves.toMatchObject({
      value: await runner.evalExpr('arguments.length', scope, LIMITS),
    });
  });

  it('rejects a scope that cannot cross as data, as evalExpr does', async () => {
    const scope: Record<string, unknown> = {};
    scope.self = scope;
    await expect(evalExprProbed('1', scope, LIMITS)).rejects.toThrow(
      /circular/i,
    );
  });
});
