import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  isTaskInputMirrorStale,
  staleTaskInputMirrors,
  TASK_INPUT_MIRROR_RETENTION_MS,
  type TaskInputMirrorFacts,
} from './input-mirrors.ts';

const NOW = Date.UTC(2026, 9, 9, 12);
const DAY = 24 * 60 * 60 * 1000;

function task(facts: Partial<TaskInputMirrorFacts> = {}): TaskInputMirrorFacts {
  return {
    status: 'in_progress',
    archived: false,
    touchedAt: NOW - DAY,
    live: false,
    ...facts,
  };
}

describe('which copy of a task’s inputs a worker may drop', () => {
  it('keeps the copy of an open task touched within 30 days', () => {
    for (const status of ['backlog', 'todo', 'in_progress', 'in_review']) {
      expect(isTaskInputMirrorStale(task({ status }), NOW)).toBe(false);
    }
    expect(
      isTaskInputMirrorStale(
        task({ touchedAt: NOW - TASK_INPUT_MIRROR_RETENTION_MS + 1 }),
        NOW,
      ),
    ).toBe(false);
  });

  it('drops the copy of a closed, archived, gone or month-old task', () => {
    expect(isTaskInputMirrorStale(task({ status: 'done' }), NOW)).toBe(true);
    expect(isTaskInputMirrorStale(task({ status: 'cancelled' }), NOW)).toBe(
      true,
    );
    expect(isTaskInputMirrorStale(task({ archived: true }), NOW)).toBe(true);
    expect(isTaskInputMirrorStale(undefined, NOW)).toBe(true);
    expect(
      isTaskInputMirrorStale(task({ touchedAt: NOW - 30 * DAY }), NOW),
    ).toBe(true);
  });

  it('never drops the copy of a task with a live run', () => {
    expect(
      isTaskInputMirrorStale(
        task({
          status: 'done',
          archived: true,
          touchedAt: NOW - 90 * DAY,
          live: true,
        }),
        NOW,
      ),
    ).toBe(false);
  });
});

interface Statement {
  text: string;
  values: unknown[];
}

/** A postgres.js stand-in: every statement is recorded and answered by the
 * first matcher its whitespace-collapsed text contains. */
function fakeSql(answers: Array<[string, unknown[]]>): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    const hit = answers.find(([match]) => text.includes(match));
    return Promise.resolve(hit?.[1] ?? []);
  };
  const sql = Object.assign(tag, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

const HASH_OF = (n: number) => String(n).repeat(64).slice(0, 64);

describe('staleTaskInputMirrors', () => {
  it('names the stale task copies and review copies, organization-scoped', async () => {
    const { sql, statements } = fakeSql([
      [
        "encode(sha256(convert_to(t.id, 'UTF8')), 'hex') AS key",
        [
          { key: HASH_OF(1), ...task() },
          { key: HASH_OF(2), ...task({ status: 'done' }) },
        ],
      ],
      [
        'SELECT t.id AS key',
        [
          { key: 'task-open', ...task() },
          { key: 'task-done', ...task({ status: 'done' }) },
          { key: 'task-live', ...task({ status: 'done', live: true }) },
          { key: 'task-old', ...task({ touchedAt: NOW - 31 * DAY }) },
        ],
      ],
    ]);

    const stale = await staleTaskInputMirrors(sql, {
      organizationId: 'org-1',
      agentId: 'agent-scribe',
      taskIds: ['task-open', 'task-done', 'task-live', 'task-old', 'gone'],
      reviewHashes: [HASH_OF(1), HASH_OF(2), HASH_OF(3)],
      now: NOW,
    });

    expect(stale).toEqual({
      taskIds: ['task-done', 'task-old', 'gone'],
      // The third matches no task of the agent's project.
      reviewHashes: [HASH_OF(2), HASH_OF(3)],
    });
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement.text).toContain('t.org_id = ?');
      expect(statement.values).toContain('org-1');
      // A run that is queued, waiting or working keeps its task's copy.
      expect(statement.values).toContainEqual(
        expect.stringContaining("r.status IN ('queued', 'running')"),
      );
    }
    expect(statements[1]?.text).toContain('FROM app.project_agents a');
    expect(statements[1]?.values).toContain('agent-scribe');
  });

  it('reads nothing when the worker holds no copy to judge', async () => {
    const { sql, statements } = fakeSql([]);
    expect(
      await staleTaskInputMirrors(sql, {
        organizationId: 'org-1',
        agentId: 'agent-scribe',
        taskIds: [],
        reviewHashes: [],
      }),
    ).toEqual({ taskIds: [], reviewHashes: [] });
    expect(statements).toEqual([]);
  });
});
