// @vitest-environment node

/**
 * The label names an agent reads on a task (`task_find`'s rows, `task_get`'s
 * task): spelled as the project's catalog spells them, sorted without regard
 * to case, `[]` for a task without labels, and read once per page within the
 * organization. Postgres proves the read over real rows in
 * `agent-read-tools.integration.ts`.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { readAgentTaskLabels } from './agent-labels.ts';

interface CatalogRow {
  id: string;
  projectId: string;
  name: string;
}

/** A `sql` stand-in answering the catalog read with `rows`, recording each
 * statement and its values. */
function catalogSql(rows: CatalogRow[]) {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(rows);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag call is all the read makes
  return { sql: tag as unknown as Sql, statements };
}

const CATALOG: CatalogRow[] = [
  { id: 'l-hold', projectId: 'p-fleet', name: 'hold' },
  { id: 'l-human', projectId: 'p-fleet', name: 'Needs-human' },
  { id: 'l-blocked', projectId: 'p-fleet', name: 'blocked' },
  { id: 'l-other', projectId: 'p-billing', name: 'Billing only' },
];

describe('readAgentTaskLabels [TASK-R83]', () => {
  it('names each label as the catalog spells it, sorted without regard to case', async () => {
    const { sql } = catalogSql(CATALOG);
    const labels = await readAgentTaskLabels(sql, 'org-1', [
      {
        id: 't-1',
        projectId: 'p-fleet',
        labelIds: ['l-human', 'l-hold', 'l-blocked'],
      },
    ]);
    expect(labels.get('t-1')).toEqual(['blocked', 'hold', 'Needs-human']);
  });

  it('reads the whole page once, within the organization', async () => {
    const { sql, statements } = catalogSql(CATALOG);
    const labels = await readAgentTaskLabels(sql, 'org-1', [
      { id: 't-1', projectId: 'p-fleet', labelIds: ['l-hold', 'l-human'] },
      { id: 't-2', projectId: 'p-fleet', labelIds: ['l-hold'] },
      { id: 't-3', projectId: 'p-fleet', labelIds: [] },
    ]);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain('FROM app.task_labels');
    expect(statements[0]?.text).toContain('WHERE org_id = ? AND id = ANY(?)');
    expect(statements[0]?.values).toEqual(['org-1', ['l-hold', 'l-human']]);
    expect(labels.get('t-2')).toEqual(['hold']);
    expect(labels.get('t-3')).toEqual([]);
  });

  it('counts only a label the task’s own project holds, never a deleted or foreign id', async () => {
    const { sql } = catalogSql(CATALOG);
    const labels = await readAgentTaskLabels(sql, 'org-1', [
      {
        id: 't-1',
        projectId: 'p-fleet',
        labelIds: ['l-other', 'l-gone', 'l-hold', 'l-hold'],
      },
    ]);
    expect(labels.get('t-1')).toEqual(['hold']);
  });

  it('reads nothing when no task of the page wears a label', async () => {
    const { sql, statements } = catalogSql(CATALOG);
    const labels = await readAgentTaskLabels(sql, 'org-1', [
      { id: 't-1', projectId: 'p-fleet', labelIds: [] },
    ]);
    expect(statements).toEqual([]);
    expect(labels.get('t-1')).toEqual([]);
  });
});
