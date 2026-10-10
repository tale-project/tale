// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { RunnerStopped } from '../core/runner';
import { nodeVmRunner, runnerProcessCount } from './node-vm';
import { withRunnerTenant } from './tenant';

/**
 * The runner pool: several runner processes, each exactly the supervised
 * child one runner was before, with evaluations spread over them, a kill
 * failing only what its own process held, and the waiting work of
 * different tenants served in turn.
 */

const LIMITS = { timeoutMs: 2000 };

/** A body that keeps its process busy for `ms` and says when it ran. */
function busyFor(ms: number): string {
  return `const started = Date.now(); while (Date.now() - started < ${ms}) {} return { started, ended: Date.now() };`;
}

interface Span {
  started: number;
  ended: number;
}

function isSpan(value: unknown): value is Span {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'started') === 'number' &&
    typeof Reflect.get(value, 'ended') === 'number'
  );
}

async function span(
  runner: ReturnType<typeof nodeVmRunner>,
  ms: number,
): Promise<Span> {
  const value = await runner.runBody(busyFor(ms), {}, LIMITS);
  if (!isSpan(value)) throw new Error('the body answered no span');
  return value;
}

describe('the runner pool', () => {
  it('runs bodies on several processes at once', async () => {
    const runner = nodeVmRunner({ processes: 2, pipeline: 1 });
    const [first, second] = await Promise.all([
      span(runner, 150),
      span(runner, 150),
    ]);
    if (first === undefined || second === undefined) throw new Error('lost');
    // Each ran in its own process: their times overlap.
    expect(first.started).toBeLessThan(second.ended);
    expect(second.started).toBeLessThan(first.ended);
    expect(runnerProcessCount(runner)).toBe(2);
  });

  it('runs one process exactly as one runner did, by default', async () => {
    const runner = nodeVmRunner();
    const [first, second] = await Promise.all([
      span(runner, 60),
      span(runner, 60),
    ]);
    if (first === undefined || second === undefined) throw new Error('lost');
    // One process: the second ran after the first.
    expect(second.started).toBeGreaterThanOrEqual(first.ended);
    expect(runnerProcessCount(runner)).toBe(1);
  });

  it('grows only when every process holds its pipeline', async () => {
    const runner = nodeVmRunner({ processes: 3, pipeline: 2 });
    await Promise.all([span(runner, 40), span(runner, 40)]);
    expect(runnerProcessCount(runner)).toBe(1);
    await Promise.all([span(runner, 40), span(runner, 40), span(runner, 40)]);
    expect(runnerProcessCount(runner)).toBe(2);
  });

  it('retires a process beyond the first once it has been idle', async () => {
    const runner = nodeVmRunner({ processes: 2, pipeline: 1, idleMs: 50 });
    await Promise.all([span(runner, 30), span(runner, 30)]);
    expect(runnerProcessCount(runner)).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(runnerProcessCount(runner)).toBe(1);
    // The pool still serves, and grows again when it must.
    await Promise.all([span(runner, 30), span(runner, 30)]);
    expect(runnerProcessCount(runner)).toBe(2);
  });

  it('a kill fails only what its own process held', async () => {
    const runner = nodeVmRunner({
      processes: 2,
      pipeline: 1,
      killGraceMs: 100,
    });
    const parked = runner.runBody(
      'await new Promise(() => {}); return 1;',
      {},
      { timeoutMs: 150 },
      { async: true },
    );
    const served = span(runner, 300);
    await expect(parked).rejects.toBeInstanceOf(RunnerStopped);
    await expect(served).resolves.toSatisfy(isSpan);
  });

  it("serves different tenants' waiting work in turn", async () => {
    const runner = nodeVmRunner({ processes: 1, pipeline: 1 });
    const order: string[] = [];
    const run = (tenant: string, label: string) =>
      withRunnerTenant(tenant, async () => {
        await span(runner, 20);
        order.push(label);
      });
    // One organization queues five evaluations, then another queues one: it
    // waits behind one of the first's, not behind all five.
    const burst = [1, 2, 3, 4, 5].map((n) => run('org-a', `a${n}`));
    const other = run('org-b', 'b1');
    await Promise.all([...burst, other]);
    expect(order.indexOf('b1')).toBeLessThanOrEqual(2);
    expect(order.filter((label) => label.startsWith('a'))).toEqual([
      'a1',
      'a2',
      'a3',
      'a4',
      'a5',
    ]);
  });
});
