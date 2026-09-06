import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyUser } from '../collab/service.ts';
import { addTaskComment } from './comments.ts';
import {
  enforceTaskDatesForOrg,
  OVERDUE_NUDGE_BODY,
} from './date-notifications.ts';

vi.mock('../collab/service.ts', () => ({ notifyUser: vi.fn() }));
vi.mock('./comments.ts', () => ({ addTaskComment: vi.fn() }));

/**
 * The date ladder's delivery contract: each rung claims and announces a row
 * in ONE transaction, so a bell or nudge that throws rolls that row's stamp
 * back (the next tick re-claims it) while the other rows of the batch still
 * land. The real-Postgres proof (stamps, counts, the reschedule reset and
 * the by-locale nudge) rides `integration-check.ts`; this pins the shape.
 */

type Row = Record<string, unknown>;

function sweepRow(taskId: string, extra: Row = {}): Row {
  return {
    taskId,
    projectId: 'p-1',
    title: `Task ${taskId}`,
    assigneeType: 'user',
    assigneeId: 'u-assignee',
    taskCreatorId: 'u-creator',
    projectCreatorId: 'u-project',
    ...extra,
  };
}

/** A root `sql` whose `begin` runs the callback on the same tag and records
 * every transaction that rolled back (the callback threw). */
function fakeSql(answer: (text: string, values: unknown[]) => Row[]): {
  sql: Sql;
  rolledBack: string[];
} {
  const rolledBack: string[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Row[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    return Promise.resolve(answer(text, values));
  };
  const tx = Object.assign(tag, { unsafe: (text: string): unknown => text });
  const sql = Object.assign(tx, {
    begin: async (
      callback: (tx: TransactionSql) => unknown,
    ): Promise<unknown> => {
      try {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a two-member stand-in for the postgres.js transaction function
        return await callback(tx as unknown as TransactionSql);
      } catch (error) {
        rolledBack.push(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a three-member stand-in for the postgres.js root instance
  return { sql: sql as unknown as Sql, rolledBack };
}

beforeEach(() => {
  vi.mocked(notifyUser).mockReset();
  vi.mocked(addTaskComment).mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('enforceTaskDatesForOrg — each row is claimed and announced in its own transaction', () => {
  it('a bell that throws rolls its row back; the rest of the batch still lands', async () => {
    const { sql, rolledBack } = fakeSql((text, values) => {
      if (
        text.startsWith('SELECT t2.id FROM app.tasks t2') &&
        text.includes('start_date_ms')
      ) {
        return [{ id: 't-a' }, { id: 't-b' }];
      }
      if (text.startsWith('UPDATE app.tasks SET start_notified_at_ms')) {
        // `${now}` then `${id}` — the claim answers the row it was asked for.
        return [sweepRow(String(values[1]))];
      }
      return [];
    });
    vi.mocked(notifyUser).mockImplementation((_db, args) =>
      args.taskId === 't-a'
        ? Promise.reject(new Error('preferences table unreachable'))
        : Promise.resolve(),
    );

    const result = await enforceTaskDatesForOrg(sql, 'org-1');

    expect(result).toEqual({ start: 1, dueSoon: 0, overdue: 0 });
    expect(notifyUser).toHaveBeenCalledTimes(2);
    // The failed row's transaction was rolled back — its stamp is gone and
    // the next tick claims it again — and the sweep went on to the next row.
    expect(rolledBack).toEqual(['preferences table unreachable']);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('date rung for task t-a rolled back'),
      'preferences table unreachable',
    );
  });

  it('the claim re-checks the rung inside the transaction: a row another worker took is skipped', async () => {
    const { sql } = fakeSql((text) => {
      if (
        text.startsWith('SELECT t2.id FROM app.tasks t2') &&
        text.includes('start_date_ms')
      ) {
        return [{ id: 't-taken' }];
      }
      // The UPDATE's predicate no longer matches (already stamped).
      return [];
    });
    const result = await enforceTaskDatesForOrg(sql, 'org-1');
    expect(result.start).toBe(0);
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('the overdue nudge is posted on the row’s transaction, in every locale', async () => {
    let claimTx: unknown;
    const { sql } = fakeSql((text, values) => {
      if (
        text.startsWith('SELECT t2.id FROM app.tasks t2') &&
        text.includes('due_date_ms <= ?') &&
        text.includes('> coalesce(t2.sla_level, 0)')
      ) {
        return [{ id: 't-late' }];
      }
      // The `${targetLevel}` CASE fragment binds as one value here.
      if (
        text.startsWith('UPDATE app.tasks SET sla_level = ?, sla_level_at_ms')
      ) {
        const id = values.find((value) => value === 't-late');
        return id === undefined ? [] : [sweepRow('t-late', { newLevel: 2 })];
      }
      return [];
    });
    vi.mocked(addTaskComment).mockImplementation((tx) => {
      claimTx = tx;
      return Promise.resolve({
        messageId: 'm-1',
        threadId: 'th-1',
        unresolvedMentionTokens: [],
      });
    });

    const result = await enforceTaskDatesForOrg(sql, 'org-1');

    expect(result.overdue).toBe(1);
    expect(addTaskComment).toHaveBeenCalledTimes(1);
    const [, , args] = vi.mocked(addTaskComment).mock.calls[0] ?? [];
    expect(args).toEqual({
      taskId: 't-late',
      body: OVERDUE_NUDGE_BODY.en,
      bodyByLocale: OVERDUE_NUDGE_BODY,
      author: { actorType: 'agent', actorId: 'workflow' },
    });
    // On the transaction that stamped the level, not a sibling one.
    expect(claimTx).toBe(sql);
    expect(Object.keys(OVERDUE_NUDGE_BODY).sort()).toEqual(['de', 'en', 'fr']);
  });

  it('a refused nudge rolls the level-2 stamp back instead of burning it', async () => {
    const { sql, rolledBack } = fakeSql((text, values) => {
      if (
        text.startsWith('SELECT t2.id FROM app.tasks t2') &&
        text.includes('> coalesce(t2.sla_level, 0)')
      ) {
        return [{ id: 't-late' }];
      }
      if (
        text.startsWith('UPDATE app.tasks SET sla_level = ?, sla_level_at_ms')
      ) {
        return values.includes('t-late')
          ? [sweepRow('t-late', { newLevel: 2 })]
          : [];
      }
      return [];
    });
    vi.mocked(addTaskComment).mockRejectedValue(
      new Error('TASK_COMMENT_INVALID'),
    );

    const result = await enforceTaskDatesForOrg(sql, 'org-1');

    expect(result.overdue).toBe(0);
    expect(rolledBack).toEqual(['TASK_COMMENT_INVALID']);
  });
});
