// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  liveTurnCount,
  settleLiveChatTurns,
  trackLiveTurn,
  untrackLiveTurn,
} from './live-turns.ts';

/**
 * A chat turn lives in the process that took it. A process that stops used to
 * leave its turns `pending` for the generation sweep ten minutes on; it now
 * lets them finish for the rest of its drain budget and settles the others
 * itself (`live-turns.ts`, `shutdown-sequence.ts`).
 */

interface Statement {
  text: string;
  values: unknown[];
}

/** A tagged-template `sql` that records every statement and every
 * transaction's end. A `DELETE` answers the thread ids in `held`, as a
 * generation row that is still there does; a statement containing `failOn`
 * rejects. */
function fakeSql(
  held: string[],
  options: {
    failFor?: string;
    failOn?: string;
    /** Awaited when a transaction opens, before its callback runs. */
    beforeBegin?: () => Promise<void>;
  } = {},
) {
  const statements: Statement[] = [];
  const transactions: Array<'commit' | 'rollback'> = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (options.failOn !== undefined && text.includes(options.failOn)) {
      return Promise.reject(new Error('database closing'));
    }
    if (text.includes('DELETE FROM app.generations')) {
      const threadId = String(values[0]);
      if (options.failFor === threadId) {
        return Promise.reject(new Error('database closing'));
      }
      // The row held for a thread names that thread's own placeholder.
      return Promise.resolve(
        held.includes(threadId) && values[2] === `m-${threadId}`
          ? [{ threadId }]
          : [],
      );
    }
    return Promise.resolve([]);
  };
  const begin = async (callback: (tx: typeof tag) => Promise<unknown>) => {
    await options.beforeBegin?.();
    try {
      const result = await callback(tag);
      transactions.push('commit');
      return result;
    } catch (error) {
      transactions.push('rollback');
      throw error;
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the registry exercises exactly the tag and begin
  return {
    sql: Object.assign(tag, { begin }) as unknown as Sql,
    statements,
    transactions,
  };
}

const turn = (threadId: string) => ({
  organizationId: 'org_1',
  threadId,
  messageId: `m-${threadId}`,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const id of ['t1', 't2', 't3']) untrackLiveTurn(id);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('settleLiveChatTurns', () => {
  it('settles nothing when the process runs no turn', async () => {
    const f = fakeSql([]);

    expect(await settleLiveChatTurns(f.sql, 5_000)).toBe(0);
    expect(f.statements).toEqual([]);
  });

  it('lets the turns finish within the budget and then has nothing to settle', async () => {
    const f = fakeSql(['t1']);
    trackLiveTurn(turn('t1'));

    const settled = settleLiveChatTurns(f.sql, 10_000);
    await vi.advanceTimersByTimeAsync(2_000);
    untrackLiveTurn('t1');
    await vi.advanceTimersByTimeAsync(0);

    expect(await settled).toBe(0);
    expect(f.statements).toEqual([]);
  });

  it('settles a turn still running when the budget ends: its row gone, its thread idle, its placeholder failed', async () => {
    const f = fakeSql(['t1']);
    trackLiveTurn(turn('t1'));

    const settled = settleLiveChatTurns(f.sql, 3_000);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(await settled).toBe(1);
    const texts = f.statements.map((s) => s.text);
    expect(texts[0]).toContain('DELETE FROM app.generations');
    expect(f.statements[0]?.values).toEqual(['t1', 'org_1', 'm-t1']);
    expect(texts[1]).toContain("generation_status = 'idle'");
    expect(texts[2]).toContain("status = 'failed'");
    expect(texts[2]).toContain("status = 'pending'");
  });

  it('settles at once when the budget is already spent', async () => {
    const f = fakeSql(['t1']);
    trackLiveTurn(turn('t1'));

    expect(await settleLiveChatTurns(f.sql, 0)).toBe(1);
  });

  it('leaves a turn alone whose row ended on its own, and counts only the ones it settled', async () => {
    // t1 was still there; t2 settled between the wait and the delete.
    const f = fakeSql(['t1']);
    trackLiveTurn(turn('t1'));
    trackLiveTurn(turn('t2'));

    expect(await settleLiveChatTurns(f.sql, 0)).toBe(1);

    const settledThreads = f.statements
      .filter((s) => s.text.includes('UPDATE app.messages'))
      .map((s) => s.values[1]);
    expect(settledThreads).toEqual(['t1']);
  });

  it('leaves alone a generation row a successor turn took over', async () => {
    // t1's row now names another turn's placeholder.
    const f = fakeSql(['t1']);
    trackLiveTurn({
      organizationId: 'org_1',
      threadId: 't1',
      messageId: 'm-old',
    });

    expect(await settleLiveChatTurns(f.sql, 0)).toBe(0);
    expect(f.statements.map((s) => s.text.trim().split(/\s+/)[0])).toEqual([
      'DELETE',
    ]);
  });

  it('touches no thread this process did not run', async () => {
    const f = fakeSql(['t1', 'other']);
    trackLiveTurn(turn('t1'));

    await settleLiveChatTurns(f.sql, 0);

    expect(f.statements.some((s) => s.values.includes('other'))).toBe(false);
  });

  it('rolls a turn back whose settle fails, so its generation row stays for the sweep', async () => {
    const f = fakeSql(['t1'], { failOn: 'UPDATE app.messages' });
    trackLiveTurn(turn('t1'));

    expect(await settleLiveChatTurns(f.sql, 0)).toBe(0);

    // The delete and both updates rode one transaction, which ended undone.
    expect(f.transactions).toEqual(['rollback']);
    expect(console.warn).toHaveBeenCalledWith(
      '[chat] could not settle the interrupted turn of thread t1:',
      'database closing',
    );
  });

  it('settles eight turns at a time: not one after the other, not all at once', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `many-${i}`);
    const gate = { active: 0, most: 0, waiting: [] as Array<() => void> };
    const f = fakeSql(ids, {
      beforeBegin: async () => {
        gate.active += 1;
        gate.most = Math.max(gate.most, gate.active);
        await new Promise<void>((resolve) => gate.waiting.push(resolve));
        gate.active -= 1;
      },
    });
    for (const id of ids) trackLiveTurn(turn(id));

    const settled = settleLiveChatTurns(f.sql, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(gate.active).toBe(8);
    while (gate.waiting.length > 0) {
      gate.waiting.shift()?.();
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(await settled).toBe(20);
    expect(gate.most).toBe(8);
    for (const id of ids) untrackLiveTurn(id);
  });

  it('stops settling when its budget runs out, and says how many turns it leaves to the sweep', async () => {
    // A database that is away: no settle ever answers.
    const f = fakeSql(['b1', 'b2', 'b3'], {
      beforeBegin: () => new Promise<void>(() => {}),
    });
    for (const id of ['b1', 'b2', 'b3']) trackLiveTurn(turn(id));

    const settled = settleLiveChatTurns(f.sql, 0, { settleBudgetMs: 2_000 });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await settled).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(
      '[chat] 3 interrupted turn(s) left to the generation sweep: the shutdown budget ran out',
    );
    for (const id of ['b1', 'b2', 'b3']) untrackLiveTurn(id);
  });

  it('settles the rest when one thread fails, and says which', async () => {
    const f = fakeSql(['t1', 't2', 't3'], { failFor: 't2' });
    trackLiveTurn(turn('t1'));
    trackLiveTurn(turn('t2'));
    trackLiveTurn(turn('t3'));

    expect(await settleLiveChatTurns(f.sql, 0)).toBe(2);
    expect(console.warn).toHaveBeenCalledWith(
      '[chat] could not settle the interrupted turn of thread t2:',
      'database closing',
    );
  });
});

describe('the turns of this process', () => {
  it('are counted from the moment they are tracked until they end', () => {
    const before = liveTurnCount();

    trackLiveTurn(turn('t1'));
    trackLiveTurn(turn('t1'));
    expect(liveTurnCount()).toBe(before + 1);

    untrackLiveTurn('t1');
    untrackLiveTurn('t1');
    expect(liveTurnCount()).toBe(before);
  });
});
