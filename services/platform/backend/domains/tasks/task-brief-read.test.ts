// @vitest-environment node

/**
 * The labels the brief of a task's run names, read the one way every
 * agent-facing door reads them (`agent-labels.ts`): the project's own
 * spelling, sorted without regard to case, within the organization. Postgres
 * proves the read over real rows in `agent-read-tools.integration.ts`.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { composeTaskBrief } from '../../../lib/agent/task-brief.ts';
import { readAgentTaskLabels } from './agent-labels.ts';
import { readTaskBrief } from './task-brief-read.ts';

interface CatalogRow {
  id: string;
  projectId: string;
  name: string;
}

const CATALOG: CatalogRow[] = [
  { id: 'l-hold', projectId: 'p-fleet', name: 'hold' },
  { id: 'l-human', projectId: 'p-fleet', name: 'Needs-human' },
  { id: 'l-other', projectId: 'p-billing', name: 'Billing only' },
];

/** A `sql` stand-in for the brief's reads: one task of the Fleet project
 * wearing `labelIds`, no discussion, and `CATALOG` as the labels. Records
 * each statement and its values. */
function briefSql(
  labelIds: string[],
  files: { attachments: unknown[]; outputs: unknown[] } = {
    attachments: [],
    outputs: [],
  },
) {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.tasks')) {
      return Promise.resolve([
        {
          title: 'Renew the certificate',
          description: null,
          labelIds,
          number: 12,
          projectId: 'p-fleet',
          attachments: files.attachments,
          outputs: files.outputs,
          organizationId: 'org-1',
        },
      ]);
    }
    if (text.includes('FROM app.projects')) {
      return Promise.resolve([{ name: 'Fleet', key: 'FL' }]);
    }
    if (text.includes('FROM app.task_labels')) return Promise.resolve(CATALOG);
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag call is all the reads make
  return { sql: tag as unknown as Sql, statements };
}

describe('the labels a run’s brief names [TASK-R83]', () => {
  it('names them as task_find and task_get do: the project’s own, sorted, within the organization', async () => {
    const labelIds = ['l-human', 'l-other', 'l-hold'];
    const { sql, statements } = briefSql(labelIds);
    const brief = await readTaskBrief(sql, 't-1');
    expect(brief?.labels).toEqual(['hold', 'Needs-human']);
    const labelReads = statements.filter((statement) =>
      statement.text.includes('FROM app.task_labels'),
    );
    expect(labelReads).toHaveLength(1);
    expect(labelReads[0]?.text).toContain('WHERE org_id = ? AND id = ANY(?)');
    expect(labelReads[0]?.values).toEqual(['org-1', labelIds]);
    // The same answer the task's own row and read give.
    const tools = await readAgentTaskLabels(briefSql(labelIds).sql, 'org-1', [
      { id: 't-1', projectId: 'p-fleet', labelIds },
    ]);
    expect(brief?.labels).toEqual(tools.get('t-1'));
    expect(composeTaskBrief({ brief: brief ?? { title: '' } })).toContain(
      'Labels: hold, Needs-human',
    );
  });

  it('says nothing of labels for a task that wears none, or only another project’s', async () => {
    const bare = briefSql([]);
    const bareBrief = await readTaskBrief(bare.sql, 't-1');
    expect(bareBrief).not.toHaveProperty('labels');
    expect(
      bare.statements.some((statement) =>
        statement.text.includes('FROM app.task_labels'),
      ),
    ).toBe(false);

    const foreign = await readTaskBrief(briefSql(['l-other']).sql, 't-1');
    expect(foreign).not.toHaveProperty('labels');
    expect(composeTaskBrief({ brief: foreign ?? { title: '' } })).not.toContain(
      'Labels:',
    );
  });
});

describe('the files a run’s brief names', () => {
  it('keeps the size each entry records, so the stager can pack by it', async () => {
    const { sql } = briefSql([], {
      attachments: [
        {
          fileId: 's3:org-1/a',
          fileName: 'Afos.xlsx',
          fileType: 'application/vnd.ms-excel',
          fileSize: 2048,
        },
        { fileId: 's3:org-1/b', fileName: 'brief.pdf' },
      ],
      outputs: [
        { fileId: 's3:org-1/c', fileName: 'report.docx', fileSize: 'large' },
      ],
    });
    const brief = await readTaskBrief(sql, 't-1');
    expect(brief?.attachments).toEqual([
      { fileId: 's3:org-1/a', fileName: 'Afos.xlsx', fileSize: 2048 },
      { fileId: 's3:org-1/b', fileName: 'brief.pdf' },
    ]);
    expect(brief?.attachments[1]).not.toHaveProperty('fileSize');
    expect(brief?.outputs).toEqual([
      { fileId: 's3:org-1/c', fileName: 'report.docx' },
    ]);
    expect(brief?.outputs[0]).not.toHaveProperty('fileSize');
  });
});
