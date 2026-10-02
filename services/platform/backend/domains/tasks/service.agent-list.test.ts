/**
 * `task_find`'s read is a keyset page (#3955): it used to read the first 200
 * rows of `status, rank` and stop, so a column past 200 cards could not be
 * listed at all. It now reads the rows strictly after a position in one of
 * two total orders — both ending on the task id, so tied ranks and tied
 * creation milliseconds still resume exactly after the row a page ended on.
 *
 * Postgres proves the walk itself (`agent-read-tools.integration.ts`); these
 * tests pin the statement: the order, the keyset predicate beside the board
 * filters, and the bound on one read.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { listTasksForAgent } from './service.ts';

const FRAGMENT = Symbol('fragment');
interface Fragment {
  [FRAGMENT]: true;
  text: string;
  values: unknown[];
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

/** A `sql` stand-in that inlines nested fragments the way postgres.js does,
 *  so a recorded statement is the one Postgres would see. */
function recordingSql() {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const flat: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += '?';
        flat.push(value);
      }
    });
    text = text.replace(/\s+/g, ' ').trim();
    statements.push({ text, values: flat });
    const fragment: Fragment = { [FRAGMENT]: true, text, values: flat };
    return Object.assign(Promise.resolve([]), fragment);
  };
  const sql = Object.assign(tag, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as Sql, statements };
}

const lastStatement = (statements: { text: string; values: unknown[] }[]) => {
  const statement = statements.at(-1);
  if (statement === undefined) throw new Error('no statement recorded');
  return statement;
};

describe('listTasksForAgent — the task_find page', () => {
  it('filters the newest captured workflow-free agent review, not the configured reviewer', async () => {
    const { sql, statements } = recordingSql();
    await listTasksForAgent(sql, {
      organizationId: 'org-1',
      projectId: 'p-1',
      reviewerAgentId: 'reviewer-1',
    });
    const { text, values } = lastStatement(statements);
    expect(text).toContain('a.resource_id = t.id');
    expect(text).toContain('a.org_id = t.org_id');
    expect(text).toContain("a.resource_type = 'task_review'");
    expect(text).toContain("a.status = 'pending'");
    expect(text).toContain('a.wf_execution_id IS NULL');
    expect(text).toContain('ORDER BY a.seq DESC LIMIT 1');
    expect(text).toContain("SELECT a.metadata -> 'reviewer'");
    expect(text).toContain(
      "jsonb_build_object('kind', 'agent', 'agentId', ?::text)",
    );
    expect(values).toContain('reviewer-1');
  });

  it('reads the board order, ending on the task id, with no position on page one', async () => {
    const { sql, statements } = recordingSql();
    await listTasksForAgent(sql, {
      organizationId: 'org-1',
      projectId: 'p-1',
      status: 'backlog',
    });
    const { text } = lastStatement(statements);
    expect(text).toContain('ORDER BY t.status ASC, t.rank ASC, t.id ASC');
    expect(text).toContain('AND TRUE ORDER BY');
    // One statement is still bounded when nobody names a page size.
    expect(lastStatement(statements).values.at(-1)).toBe(200);
  });

  it('resumes strictly after the board position, inside the board filters', async () => {
    const { sql, statements } = recordingSql();
    await listTasksForAgent(sql, {
      organizationId: 'org-1',
      projectId: 'p-1',
      status: 'backlog',
      order: 'board',
      after: {
        order: 'board',
        status: 'backlog',
        rank: '0|hzzzzz:',
        id: 't-9',
      },
      limit: 51,
    });
    const { text, values } = lastStatement(statements);
    expect(text).toContain(
      '(t.status, t.rank, t.id) > (?::text, ?::text, ?::text)',
    );
    // The keyset narrows the same statement the filters narrow: a match past
    // the position is never read as page one.
    expect(text.indexOf('t.status = ?')).toBeLessThan(
      text.indexOf('(t.status, t.rank, t.id) >'),
    );
    expect(values).toEqual(
      expect.arrayContaining(['backlog', '0|hzzzzz:', 't-9', 51]),
    );
  });

  it('walks the creation order on (created_at, id) and resumes after its position', async () => {
    const { sql, statements } = recordingSql();
    await listTasksForAgent(sql, {
      organizationId: 'org-1',
      projectIds: ['p-1', 'p-2'],
      order: 'created',
      after: { order: 'created', createdAt: 1_790_000_000_000, id: 't-3' },
      limit: 21,
    });
    const { text, values } = lastStatement(statements);
    expect(text).toContain('ORDER BY t.created_at_ms ASC, t.id ASC');
    expect(text).toContain('(t.created_at_ms, t.id) > (?::bigint, ?::text)');
    expect(values).toEqual(
      expect.arrayContaining([1_790_000_000_000, 't-3', 21]),
    );
  });

  it('continues the order a position was taken in', async () => {
    const { sql, statements } = recordingSql();
    await listTasksForAgent(sql, {
      organizationId: 'org-1',
      order: 'created',
      after: { order: 'board', status: 'todo', rank: 'a', id: 't-1' },
    });
    const { text } = lastStatement(statements);
    expect(text).toContain('ORDER BY t.status ASC, t.rank ASC, t.id ASC');
    expect(text).toContain('(t.status, t.rank, t.id) >');
  });

  it('bounds one read at 200 rows and at least one', async () => {
    const { sql, statements } = recordingSql();
    for (const limit of [10_000, 0, -5, Number.NaN, 2.7]) {
      await listTasksForAgent(sql, { organizationId: 'org-1', limit });
    }
    const reads = statements.filter((statement) =>
      statement.text.startsWith('SELECT'),
    );
    expect(reads.map((statement) => statement.values.at(-1))).toEqual([
      200, 1, 1, 200, 2,
    ]);
  });
});
