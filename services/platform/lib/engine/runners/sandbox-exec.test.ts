import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import type { RunnerLimits } from '../core/runner';
import {
  createSandboxExecRunner,
  createSessionTransport,
  SANDBOX_RESULT_CLOSE,
  SANDBOX_RESULT_OPEN,
  type SandboxExecTransport,
  type SandboxProgramRunner,
} from './sandbox-exec';

const LIMITS: RunnerLimits = { timeoutMs: 200 };

/** A fake transport that actually EXECUTES the runner's emitted expression
 * under real V8 semantics: it parses the scope, evaluates `code` (a string or
 * Promise-of-string envelope) against a `__scope` binding in a throwaway VM
 * context, and hands the envelope back. This is how the round-trip / data-only
 * / async tests observe that the emitted code enforces the convention. The
 * evaluation happens in-process here (a test double); the whole point of the
 * real backend is that it happens OUT of process. `vm.runInNewContext` — not
 * `new Function` — mirrors the repo's `no-implied-eval` precedent. */
function runningTransport(): SandboxExecTransport {
  return async ({ code, scopeJson }) => {
    try {
      const scope = JSON.parse(scopeJson) as Record<string, unknown>;
      const out: unknown = vm.runInNewContext(`(${code})`, { __scope: scope });
      return { ok: true, valueJson: String(await out) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

/** A fake {@link SandboxProgramRunner} that runs the WHOLE assembled program
 * (scope injection + result bracketing) in a throwaway VM context with a shim
 * `process`, capturing what it writes. Proves `createSessionTransport`'s program
 * actually works — end to end — on real V8. */
function executingProgramRunner(): SandboxProgramRunner {
  return async (program) => {
    let stdout = '';
    let stderr = '';
    const process = {
      stdout: {
        write: (text: string) => {
          stdout += text;
          return true;
        },
      },
      stderr: {
        write: (text: string) => {
          stderr += text;
          return true;
        },
      },
      exitCode: 0 as number | null,
    };
    vm.runInNewContext(program, { process });
    // The program settles its result on the microtask queue; a single macrotask
    // turn drains it before we read the captured streams.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { stdout, stderr, exitCode: process.exitCode, timedOut: false };
  };
}

describe('createSandboxExecRunner — the data-only calling convention', () => {
  const runner = createSandboxExecRunner(runningTransport());

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

  it('drops scope keys that are not identifiers', async () => {
    await expect(
      runner.evalExpr('typeof valid', { valid: 1, 'not-valid': 2 }, LIMITS),
    ).resolves.toBe('number');
  });

  describe('async bodies — the connector live-body shape', () => {
    it('runs an async body and keeps data-only results', async () => {
      await expect(
        runner.runBody(
          'const doubled = await Promise.resolve(input.n * 2);\nreturn { doubled };',
          { input: { n: 21 } },
          LIMITS,
          { async: true },
        ),
      ).resolves.toEqual({ doubled: 42 });
    });

    it('strips a function from an async result', async () => {
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

describe('createSandboxExecRunner — the out-of-process boundary contract', () => {
  it('enforces the deadline as a hard, killable one: an overrun rejects', async () => {
    let seenTimeout: number | undefined;
    const killTransport: SandboxExecTransport = async ({ limits }) => {
      seenTimeout = limits.timeoutMs;
      // The real transport KILLS the sandbox process on overrun — a thing the
      // in-process fallback cannot do to a body parked inside `await`. Simulate
      // that kill as a reported failure.
      return {
        ok: false,
        error: `run exceeded the ${limits.timeoutMs}ms deadline; sandbox process killed`,
      };
    };
    const runner = createSandboxExecRunner(killTransport);
    await expect(
      // A wedged async body: exactly the case node-vm's timeout can't interrupt.
      runner.runBody('while (true) {}', {}, { timeoutMs: 50 }, { async: true }),
    ).rejects.toThrow(/deadline|killed/i);
    // The deadline crossed the seam, so the transport could enforce it.
    expect(seenTimeout).toBe(50);
  });

  it('rejects with a clear message when the transport itself fails (dead session)', async () => {
    const deadSession: SandboxExecTransport = async () => {
      throw new Error('session abc123 not found');
    };
    await expect(
      createSandboxExecRunner(deadSession).evalExpr('1 + 1', {}, LIMITS),
    ).rejects.toThrow(/transport failed:[\s\S]*not found/i);
  });

  it('rejects a reported failure rather than resolving empty', async () => {
    const failing: SandboxExecTransport = async () => ({
      ok: false,
      error: 'ReferenceError: x is not defined',
    });
    await expect(
      createSandboxExecRunner(failing).evalExpr('x', {}, LIMITS),
    ).rejects.toThrow(/run failed:[\s\S]*ReferenceError/);
  });

  it('rejects when the result envelope is not JSON', async () => {
    const garbled: SandboxExecTransport = async () => ({
      ok: true,
      valueJson: 'not json at all',
    });
    await expect(
      createSandboxExecRunner(garbled).evalExpr('1', {}, LIMITS),
    ).rejects.toThrow(/not JSON/i);
  });

  it('treats an envelope without v as undefined (a body that returned nothing)', async () => {
    const empty: SandboxExecTransport = async () => ({
      ok: true,
      valueJson: '{}',
    });
    await expect(
      createSandboxExecRunner(empty).runBody('return undefined;', {}, LIMITS),
    ).resolves.toBeUndefined();
  });

  it('rejects an over-large scope before ever calling the transport', async () => {
    let called = false;
    const spy: SandboxExecTransport = async () => {
      called = true;
      return { ok: true, valueJson: '{}' };
    };
    const runner = createSandboxExecRunner(spy, { maxScopeBytes: 16 });
    await expect(
      runner.evalExpr(
        'x',
        { x: 'this string is comfortably longer than sixteen bytes' },
        LIMITS,
      ),
    ).rejects.toThrow(/over the 16-byte/i);
    expect(called).toBe(false);
  });

  it('identifies as sandbox-exec', () => {
    expect(
      createSandboxExecRunner(async () => ({
        ok: true,
        valueJson: '{}',
      })).kind(),
    ).toBe('sandbox-exec');
  });
});

describe('createSandboxExecRunner — compile-only checks stay local', () => {
  it('reports syntax errors without touching the transport', async () => {
    let called = false;
    const spy: SandboxExecTransport = async () => {
      called = true;
      return { ok: true, valueJson: '{}' };
    };
    const runner = createSandboxExecRunner(spy);

    await expect(runner.checkExpr('a +')).resolves.toMatch(/Unexpected/);
    await expect(runner.checkExpr('a + b')).resolves.toBeNull();
    await expect(runner.checkBody('return 1;')).resolves.toBeNull();
    await expect(runner.checkBody('return (;')).resolves.toMatch(/Unexpected/);

    // The whole point of a compile-only check: it runs nothing, so it never
    // reaches the sandbox.
    expect(called).toBe(false);
  });

  it('rejects a synchronous body that awaits, and accepts it as async', async () => {
    const runner = createSandboxExecRunner(async () => ({
      ok: true,
      valueJson: '{}',
    }));
    await expect(
      runner.checkBody('const v = await go(); return v;'),
    ).resolves.toMatch(/await/i);
    await expect(
      runner.checkBody('const v = await go(); return v;', { async: true }),
    ).resolves.toBeNull();
  });
});

describe('createSessionTransport — building a transport from a session', () => {
  it('assembles a program that inlines the scope, evaluates the code, and passes the deadline', async () => {
    let seenProgram = '';
    let seenTimeout = 0;
    const capture: SandboxProgramRunner = async (program, timeoutMs) => {
      seenProgram = program;
      seenTimeout = timeoutMs;
      return {
        stdout: `${SANDBOX_RESULT_OPEN}{"v":7}${SANDBOX_RESULT_CLOSE}`,
        stderr: '',
        exitCode: 0,
        timedOut: false,
      };
    };
    const transport = createSessionTransport(capture);
    await expect(
      transport({
        code: 'CODE_MARKER',
        scopeJson: '{"a":1}',
        limits: { timeoutMs: 1234 },
      }),
    ).resolves.toEqual({ ok: true, valueJson: '{"v":7}' });

    expect(seenProgram).toContain('CODE_MARKER');
    // Scope arrives as an inlined STRING LITERAL that is parsed — data, not code.
    expect(seenProgram).toContain(JSON.stringify('{"a":1}'));
    expect(seenProgram).toContain('JSON.parse');
    // The wall-clock deadline threads through to the process runner.
    expect(seenTimeout).toBe(1234);
  });

  it('ignores stray stdout before the bracketed result, end to end through the runner', async () => {
    const noisy: SandboxProgramRunner = async () => ({
      stdout: `chatter from the body\n${SANDBOX_RESULT_OPEN}{"v":42}${SANDBOX_RESULT_CLOSE}\n`,
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    const runner = createSandboxExecRunner(createSessionTransport(noisy));
    await expect(runner.evalExpr('unused', {}, LIMITS)).resolves.toBe(42);
  });

  it('maps a killed overrun to a failure the runner rejects', async () => {
    const timedOut: SandboxProgramRunner = async () => ({
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: true,
    });
    await expect(
      createSessionTransport(timedOut)({
        code: 'x',
        scopeJson: '{}',
        limits: { timeoutMs: 250 },
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      createSandboxExecRunner(createSessionTransport(timedOut)).evalExpr(
        'x',
        {},
        { timeoutMs: 250 },
      ),
    ).rejects.toThrow(/deadline|killed/i);
  });

  it('maps a non-zero exit to a failure carrying the stderr detail', async () => {
    const crashed: SandboxProgramRunner = async () => ({
      stdout: '',
      stderr: 'ReferenceError: boom is not defined\n    at file:1:1',
      exitCode: 1,
      timedOut: false,
    });
    await expect(
      createSessionTransport(crashed)({
        code: 'x',
        scopeJson: '{}',
        limits: LIMITS,
      }),
    ).resolves.toEqual({
      ok: false,
      error: expect.stringContaining('ReferenceError: boom is not defined'),
    });
  });

  it('maps a missing result envelope to a failure', async () => {
    const silent: SandboxProgramRunner = async () => ({
      stdout: 'logs, but no bracketed result',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    await expect(
      createSessionTransport(silent)({
        code: 'x',
        scopeJson: '{}',
        limits: LIMITS,
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  describe('running the whole assembled program under Node', () => {
    const runner = createSandboxExecRunner(
      createSessionTransport(executingProgramRunner()),
    );

    it('round-trips a data-only result through the full program', async () => {
      await expect(
        runner.runBody(
          'return { doubled: input.n * 2, fn: function () {} };',
          { input: { n: 21 } },
          LIMITS,
        ),
      ).resolves.toEqual({ doubled: 42 });
    });

    it('brackets the result so same-stream body output cannot corrupt it', async () => {
      await expect(
        runner.runBody(
          'process.stdout.write("chatter-before-result"); return input.v;',
          { input: { v: 5 } },
          LIMITS,
        ),
      ).resolves.toBe(5);
    });

    it('surfaces a thrown body as a rejection', async () => {
      await expect(
        runner.runBody('throw new Error("kaboom");', {}, LIMITS),
      ).rejects.toThrow(/kaboom/);
    });
  });
});
