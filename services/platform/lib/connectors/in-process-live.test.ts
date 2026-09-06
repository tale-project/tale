// The in-process live runner: host functions reach the body intact, the
// wall clock is enforced across awaits, and everything that is not the async
// live shape stays on the data-only backend.

import { describe, expect, it } from 'vitest';

import {
  IN_PROCESS_LIVE_RUNNER_KIND,
  inProcessLiveRunner,
} from './in-process-live';

const LIMITS = { timeoutMs: 2_000 };

describe('inProcessLiveRunner', () => {
  it('identifies as the in-process live backend', () => {
    expect(inProcessLiveRunner().kind()).toBe(IN_PROCESS_LIVE_RUNNER_KIND);
    expect(IN_PROCESS_LIVE_RUNNER_KIND).not.toBe('node-vm');
  });

  it('hands the host functions to an async live body by reference', async () => {
    const calls: string[] = [];
    const ctx = {
      secrets: { get: (name: string) => `secret:${name}` },
      http: {
        get: async (url: string) => {
          calls.push(url);
          return { status: 200, json: () => ({ ok: true }) };
        },
      },
    };
    const out = await inProcessLiveRunner().runBody(
      [
        "const r = await ctx.http.get('https://api.vendor.test/x?m=' + input.message);",
        'return { status: r.status, body: r.json(), token: ctx.secrets.get("token") };',
      ].join('\n'),
      { input: { message: 'hi' }, ctx },
      LIMITS,
      { async: true },
    );
    expect(out).toEqual({
      status: 200,
      body: { ok: true },
      token: 'secret:token',
    });
    expect(calls).toEqual(['https://api.vendor.test/x?m=hi']);
  });

  it('surfaces a body throw as a rejection with the original message', async () => {
    await expect(
      inProcessLiveRunner().runBody(
        'throw new Error("vendor said no");',
        { input: {}, ctx: {} },
        LIMITS,
        { async: true },
      ),
    ).rejects.toThrow('vendor said no');
  });

  it('ends an awaited body that outlives its time limit', async () => {
    await expect(
      inProcessLiveRunner().runBody(
        'await new Promise((resolve) => setTimeout(resolve, 200)); return 1;',
        { input: {}, ctx: {} },
        { timeoutMs: 20 },
        { async: true },
      ),
    ).rejects.toThrow(/exceeded its 20 ms time limit/);
  });

  it('rejects a body that does not parse', async () => {
    await expect(
      inProcessLiveRunner().runBody(
        'return {',
        { input: {}, ctx: {} },
        LIMITS,
        { async: true },
      ),
    ).rejects.toThrow(SyntaxError);
  });

  it('keeps sync bodies and expressions on the data-only backend', async () => {
    const runner = inProcessLiveRunner();
    // A function in the scope does not survive the data-only JSON boundary —
    // which is the whole point of that backend.
    const scope = { input: { n: 2 }, fn: () => 'host' };
    expect(await runner.runBody('return input.n * 2;', scope, LIMITS)).toBe(4);
    expect(await runner.evalExpr('typeof fn', scope, LIMITS)).toBe('undefined');
    expect(await runner.checkBody('return 1;')).toBeNull();
    expect(await runner.checkBody('return {', { async: true })).toMatch(
      /Unexpected/,
    );
  });
});
