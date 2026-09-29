import { readFileSync } from 'node:fs';

import { EPOCH_MS_MAX } from '@tale/shared/schemas/epoch-ms';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskRepeat } from '../../../lib/shared/task-repeat.ts';
import { organizationTableExists } from '../automations/triggers.ts';
import { createDueRepeatCopies } from './repeat-on-due.ts';
import { createDueRepeatCopy, REPEAT_OPEN_COPIES_MAX } from './repeat.ts';

const { transactSerializable } = vi.hoisted(() => ({
  transactSerializable: vi.fn(),
}));

vi.mock('@tale/shared/db/serializable', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/shared/db/serializable')>()),
  transactSerializable,
}));
vi.mock('../automations/triggers.ts', () => ({
  organizationTableExists: vi.fn(),
}));
vi.mock('./repeat.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./repeat.ts')>()),
  createDueRepeatCopy: vi.fn(),
}));

/**
 * The due-date scan: which tasks it lists, which of them it judges due in
 * their rule's own zone, and how it hands each to the writer — one
 * transaction per task, a failure never holding up the rest, a series at
 * its cap named at most once an hour, an organization that is gone never
 * served. The writer's own decision under the lock is `repeat.test.ts`'s.
 */

const ZURICH = 'Europe/Zurich';
/** Monday 2026-09-28, 12:00 in Zurich. */
const NOW = Date.UTC(2026, 8, 28, 10);
/** Midnight in Zurich on Monday 28 and Tuesday 29 September. */
const MONDAY = Date.UTC(2026, 8, 27, 22);
const TUESDAY = Date.UTC(2026, 8, 28, 22);

const onDue: TaskRepeat = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [1, 2],
  timezone: ZURICH,
  createOn: 'dueDate',
};

function candidate(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    organizationId: 'org-1',
    dueDate: MONDAY,
    repeat: onDue,
    assigneeType: null,
    assigneeId: null,
    createdByType: 'user',
    orgMissing: false,
    ...overrides,
  };
}

interface Statement {
  text: string;
  values: unknown[];
}

/** A Sql stand-in answering each candidate page from `pages` in turn. */
function fakeSql(pages: object[][]): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  let page = 0;
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT t.id, t.org_id AS "organizationId"')) {
      const rows = pages[page] ?? [];
      page += 1;
      return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the scan only tags queries and hands the object to the (mocked) transaction runner
  return { sql: tag as unknown as Sql, statements };
}

/** The ids the writer was handed, in order. */
function continued(): unknown[] {
  return vi
    .mocked(createDueRepeatCopy)
    .mock.calls.map(([, args]) => args.taskId);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(organizationTableExists).mockResolvedValue(true);
  transactSerializable.mockImplementation(
    async (_sql: unknown, fn: (tx: unknown) => unknown) => await fn('tx'),
  );
  vi.mocked(createDueRepeatCopy).mockResolvedValue({
    kind: 'created',
    copy: { id: 'copy', number: 1, dueDate: TUESDAY },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The `tasks_repeat_on_due` partial index's predicate, clause by clause,
 * as the migration declares it. */
function onDueIndexPredicate(): string[] {
  const migration = readFileSync(
    new URL('../../db/migrations/0130_task_repeat.sql', import.meta.url),
    'utf8',
  );
  const where =
    /CREATE INDEX IF NOT EXISTS tasks_repeat_on_due\s+ON app\.tasks \(due_date_ms, id\)\s+WHERE ([^;]+);/.exec(
      migration,
    )?.[1];
  if (where === undefined) throw new Error('tasks_repeat_on_due not found');
  return where.split(/\s+AND\s+/).map((clause) => clause.trim());
}

describe('the candidates the scan lists', () => {
  it('repeats the partial index’s predicate word for word, so the planner can use it', async () => {
    const { sql, statements } = fakeSql([[]]);
    await createDueRepeatCopies(sql, { now: NOW });
    const query = statements[0]?.text ?? '';
    const predicate = onDueIndexPredicate();
    expect(predicate).toEqual([
      // A task that continued its series is never a candidate again, even
      // once that copy is deleted: the stamp, not the pointer.
      'repeat_continued_at_ms IS NULL',
      'archived_at_ms IS NULL',
      'parent_task_id IS NULL',
      "status NOT IN ('done', 'cancelled')",
      "(repeat_rule ->> 'createOn') = 'dueDate'",
    ]);
    const clauses = predicate.map((clause) =>
      clause.replace(/^(\(?)(\w+)/, '$1t.$2'),
    );
    expect(query).toContain(`WHERE ${clauses.join(' AND ')} AND`);
  });

  it('asks for exactly what the partial index holds, due within the lookahead, in live projects', async () => {
    const { sql, statements } = fakeSql([[]]);
    await createDueRepeatCopies(sql, { now: NOW });
    const query = statements[0];
    for (const clause of [
      'p.id = t.project_id AND p.archived_at_ms IS NULL',
      'SELECT 1 FROM "organization" o WHERE o."id" = t.org_id',
      'ORDER BY t.due_date_ms, t.id',
    ]) {
      expect(query?.text).toContain(clause);
    }
    // A due date up to fourteen hours ahead can already have begun in its
    // rule's zone; the rule decides.
    expect(query?.values[0]).toBe(NOW + 14 * 60 * 60 * 1000);
  });

  it('walks every page in (due date, id) order', async () => {
    const { sql, statements } = fakeSql([
      [candidate('a-1'), candidate('a-2', { dueDate: MONDAY + 1 })],
      [candidate('a-3', { dueDate: MONDAY + 2 })],
    ]);
    const result = await createDueRepeatCopies(sql, { now: NOW, pageSize: 2 });
    expect(result).toMatchObject({ pages: 2, examined: 3, created: 3 });
    expect(continued()).toEqual(['a-1', 'a-2', 'a-3']);
    // The second page starts after the first one's last row.
    expect(statements[1]?.values.slice(1, 4)).toEqual([
      'a-2',
      MONDAY + 1,
      'a-2',
    ]);
  });

  it('does nothing while this connection sees no organizations at all', async () => {
    vi.mocked(organizationTableExists).mockResolvedValue(false);
    const { sql, statements } = fakeSql([[candidate('b-1')]]);
    await expect(
      createDueRepeatCopies(sql, { now: NOW }),
    ).resolves.toMatchObject({ examined: 0, created: 0 });
    expect(statements).toEqual([]);
  });
});

describe('which candidates are due', () => {
  it('hands a due task to the writer, one transaction each, with the scan’s clock', async () => {
    const { sql } = fakeSql([[candidate('c-1')]]);
    await createDueRepeatCopies(sql, { now: NOW });
    expect(transactSerializable).toHaveBeenCalledTimes(1);
    expect(createDueRepeatCopy).toHaveBeenCalledWith('tx', {
      organizationId: 'org-1',
      taskId: 'c-1',
      now: NOW,
    });
  });

  it.each([
    ['its due day has not begun in its zone', { dueDate: TUESDAY }],
    ['its rule no longer validates', { repeat: { ...onDue, interval: 0 } }],
    [
      'its rule creates on close',
      { repeat: { ...onDue, createOn: undefined } },
    ],
    ['an automation owns it', { assigneeType: 'app', assigneeId: 'vat-desk' }],
    ['an automation filed it and nobody holds it', { createdByType: 'app' }],
  ])('leaves a task alone when %s', async (_name, overrides) => {
    const { sql } = fakeSql([[candidate('d-1', overrides)]]);
    const result = await createDueRepeatCopies(sql, { now: NOW });
    expect(result).toMatchObject({ examined: 1, notDue: 1, created: 0 });
    expect(createDueRepeatCopy).not.toHaveBeenCalled();
  });

  it('the due day begins at midnight in the rule’s zone', async () => {
    const zurich = fakeSql([[candidate('e-1', { dueDate: TUESDAY })]]);
    await createDueRepeatCopies(zurich.sql, { now: TUESDAY - 1 });
    expect(createDueRepeatCopy).not.toHaveBeenCalled();
    const again = fakeSql([[candidate('e-1', { dueDate: TUESDAY })]]);
    await createDueRepeatCopies(again.sql, { now: TUESDAY });
    expect(continued()).toEqual(['e-1']);

    // Tuesday in Los Angeles begins at 07:00 UTC — seven hours after UTC's.
    vi.mocked(createDueRepeatCopy).mockClear();
    const laMidnight = Date.UTC(2026, 8, 29, 7);
    const la = {
      ...onDue,
      timezone: 'America/Los_Angeles',
    };
    const utcDay = fakeSql([
      [candidate('e-2', { dueDate: laMidnight, repeat: la })],
    ]);
    await createDueRepeatCopies(utcDay.sql, { now: Date.UTC(2026, 8, 29, 0) });
    expect(createDueRepeatCopy).not.toHaveBeenCalled();
    const laDay = fakeSql([
      [candidate('e-2', { dueDate: laMidnight, repeat: la })],
    ]);
    await createDueRepeatCopies(laDay.sql, { now: laMidnight });
    expect(continued()).toEqual(['e-2']);
  });

  it('never serves an organization that no longer exists, and says so once an hour', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scan = async (now: number) => {
      const { sql } = fakeSql([
        [candidate('f-1', { orgMissing: true }), candidate('f-2')],
      ]);
      return await createDueRepeatCopies(sql, { now });
    };
    await expect(scan(NOW)).resolves.toMatchObject({ orphaned: 1, created: 1 });
    await scan(NOW + 5 * 60 * 1000);
    expect(continued()).toEqual(['f-2', 'f-2']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('f-1'));
    await scan(NOW + 61 * 60 * 1000);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('what the writer answers', () => {
  it('continues healthy work after a candidate whose calendar cannot be represented', async () => {
    const { sql } = fakeSql([
      [
        candidate('calendar-overflow', { dueDate: EPOCH_MS_MAX }),
        candidate('healthy-after-overflow'),
      ],
    ]);
    const result = await createDueRepeatCopies(sql, { now: EPOCH_MS_MAX });
    expect(result).toMatchObject({ failed: 1, created: 1 });
    expect(continued()).toEqual(['healthy-after-overflow']);
  });

  it(`a series at ${REPEAT_OPEN_COPIES_MAX} open tasks waits, named at most once an hour per task`, async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(createDueRepeatCopy).mockResolvedValue({
      kind: 'capped',
      openCopies: REPEAT_OPEN_COPIES_MAX,
    });
    const scan = async (now: number) =>
      await createDueRepeatCopies(fakeSql([[candidate('g-1')]]).sql, { now });
    await expect(scan(NOW)).resolves.toMatchObject({ capped: 1, created: 0 });
    await scan(NOW + 5 * 60 * 1000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `task g-1 is due, but its series already has ${REPEAT_OPEN_COPIES_MAX} open tasks`,
      ),
    );
    await scan(NOW + 61 * 60 * 1000);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('a task the writer leaves alone under its lock is counted as skipped', async () => {
    vi.mocked(createDueRepeatCopy).mockResolvedValue({ kind: 'skipped' });
    const result = await createDueRepeatCopies(
      fakeSql([[candidate('h-1')]]).sql,
      { now: NOW },
    );
    expect(result).toMatchObject({ skipped: 1, created: 0 });
  });

  it('one task’s failure is logged and never holds up the rest', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(createDueRepeatCopy)
      .mockRejectedValueOnce(new Error('lock timeout'))
      .mockResolvedValueOnce({
        kind: 'created',
        copy: { id: 'copy', number: 2, dueDate: TUESDAY },
      });
    const result = await createDueRepeatCopies(
      fakeSql([[candidate('i-1'), candidate('i-2')]]).sql,
      { now: NOW },
    );
    expect(result).toMatchObject({ failed: 1, created: 1 });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('task i-1 not continued'),
      expect.objectContaining({ message: 'lock timeout' }),
    );
  });

  it('stops between tasks once the job’s signal aborts', async () => {
    const controller = new AbortController();
    vi.mocked(createDueRepeatCopy).mockImplementation(async () => {
      controller.abort();
      return {
        kind: 'created',
        copy: { id: 'copy', number: 3, dueDate: TUESDAY },
      };
    });
    const result = await createDueRepeatCopies(
      fakeSql([[candidate('j-1'), candidate('j-2')]]).sql,
      { now: NOW, signal: controller.signal },
    );
    expect(result.created).toBe(1);
    expect(continued()).toEqual(['j-1']);
  });
});
