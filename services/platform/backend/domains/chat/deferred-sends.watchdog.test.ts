import { afterEach, describe, expect, it } from 'vitest';

import { setEnqueueBoss } from '../../jobs/enqueue.ts';
import { recoverStuckDeferredSends } from './deferred-sends.ts';

/**
 * Unit lock for the deferred-send crash-recovery waker (job-liveness class):
 * a severed waiting row is re-polled with a per-send singletonKey (so a live
 * chain is never doubled) and a wedged claimed row is cleared. The stale-window
 * scan rides the real-Postgres probe in `integration-check.ts`.
 */

// oxlint-disable-next-line typescript/no-explicit-any -- test double for the postgres.js tag
function scriptedSql(script: unknown[][]): any {
  let i = 0;
  const nextRows = (): unknown[] =>
    i < script.length ? (script[i++] ?? []) : [];
  return () => Promise.resolve(nextRows());
}

interface SentJob {
  name: string;
  data: Record<string, unknown>;
  options: { singletonKey?: string } | undefined;
}

afterEach(() => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reset the process-wide boss between tests
  setEnqueueBoss(null as never);
});

describe('recoverStuckDeferredSends', () => {
  it('re-polls severed waiting rows (singletonKey) and clears wedged claimed rows', async () => {
    const sent: SentJob[] = [];
    setEnqueueBoss({
      send: (
        name: string,
        data: Record<string, unknown>,
        options: { singletonKey?: string },
      ) => {
        sent.push({ name, data, options });
        return Promise.resolve('job-id');
      },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only `send` is exercised
    } as never);
    const sql = scriptedSql([
      // waiting rows the sever-recovery re-polls
      [{ id: 'wait_1' }, { id: 'wait_2' }],
      // claimed rows the wedge-recovery deletes
      [{ id: 'claim_1' }],
    ]);

    const result = await recoverStuckDeferredSends(sql);

    expect(result).toEqual({ repolled: 2, cleared: 1 });
    expect(sent).toHaveLength(2);
    expect(sent.every((job) => job.name === 'chat.deferred_send_poll')).toBe(
      true,
    );
    // The singletonKey is the send id — this is what dedups a live chain.
    expect(sent[0]?.data.deferredSendId).toBe('wait_1');
    expect(sent[0]?.options?.singletonKey).toBe('wait_1');
    expect(sent[1]?.options?.singletonKey).toBe('wait_2');
  });

  it('reports zero when nothing is stalled', async () => {
    const sent: SentJob[] = [];
    setEnqueueBoss({
      send: (name: string, data: Record<string, unknown>) => {
        sent.push({ name, data, options: undefined });
        return Promise.resolve('job-id');
      },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only `send` is exercised
    } as never);
    const sql = scriptedSql([[], []]);

    const result = await recoverStuckDeferredSends(sql);

    expect(result).toEqual({ repolled: 0, cleared: 0 });
    expect(sent).toHaveLength(0);
  });
});
