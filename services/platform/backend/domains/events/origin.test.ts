// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { currentEventOrigin, withAutomationOrigin } from './origin.ts';

/**
 * The origin rides the work, not the signatures: a producer several awaits
 * deep inside a run's step reads the run, and nothing outside the step
 * does.
 */
describe('the event origin', () => {
  it('is the platform outside any run', () => {
    expect(currentEventOrigin()).toEqual({ kind: 'platform' });
  });

  it('names the run through awaits, timers and nested calls', async () => {
    const seen = await withAutomationOrigin('run-1', async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      const deep = async () => {
        await Promise.resolve();
        return currentEventOrigin();
      };
      return deep();
    });
    expect(seen).toEqual({ kind: 'automation', runId: 'run-1' });
  });

  it('ends with the work it wraps', async () => {
    await withAutomationOrigin('run-1', () => Promise.resolve());
    expect(currentEventOrigin()).toEqual({ kind: 'platform' });
  });

  it('keeps two runs working at once apart', async () => {
    const read = (runId: string, delay: number) =>
      withAutomationOrigin(runId, async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return currentEventOrigin();
      });
    const [first, second] = await Promise.all([
      read('run-a', 5),
      read('run-b', 1),
    ]);
    expect(first).toEqual({ kind: 'automation', runId: 'run-a' });
    expect(second).toEqual({ kind: 'automation', runId: 'run-b' });
  });

  it('lets an inner run name itself, and gives the outer one back after', async () => {
    const seen = await withAutomationOrigin('outer', async () => {
      const inner = await withAutomationOrigin('inner', async () =>
        currentEventOrigin(),
      );
      return { inner, outer: currentEventOrigin() };
    });
    expect(seen).toEqual({
      inner: { kind: 'automation', runId: 'inner' },
      outer: { kind: 'automation', runId: 'outer' },
    });
  });
});
