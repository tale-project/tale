// @vitest-environment node

import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { saveAgentFileMetadata } from './agent-file-metadata.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeTx(updated: boolean): {
  tx: TransactionSql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(
      updated && text.startsWith('UPDATE') ? [{ id: 'file-1' }] : [],
    );
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template fake standing in for the transaction
  return { tx: run as unknown as TransactionSql, statements };
}

const FILE = {
  organizationId: 'org-1',
  storageId: 's3:out',
  fileName: 'contacts.csv',
  contentType: 'text/csv',
  size: 10,
};

describe('claiming a file as a task output [TASK-R36]', () => {
  it('lets go of the run’s transcript and of the person who started the run', async () => {
    const { tx, statements } = fakeTx(true);

    await saveAgentFileMetadata(tx, { ...FILE, source: 'task-output' });

    const update = statements[0];
    expect(update?.text).toContain(
      "thread_id = CASE WHEN ? = 'task-output' THEN NULL ELSE thread_id END",
    );
    expect(update?.text).toContain(
      "uploaded_by = CASE WHEN ? = 'task-output' THEN NULL ELSE uploaded_by END",
    );
    // The same source decides the column and both lets-go.
    expect(
      update?.values.filter((value) => value === 'task-output'),
    ).toHaveLength(3);
  });

  it('leaves a file recorded as the agent’s own bound to what made it', async () => {
    const { tx, statements } = fakeTx(true);

    await saveAgentFileMetadata(tx, FILE);

    // The default source is 'agent': none of the three source values is a
    // task output, so neither column is cleared.
    expect(
      statements[0]?.values.filter((value) => value === 'task-output'),
    ).toHaveLength(0);
    expect(
      statements[0]?.values.filter((value) => value === 'agent'),
    ).toHaveLength(3);
  });

  it('records a blob no row names yet', async () => {
    const { tx, statements } = fakeTx(false);

    await saveAgentFileMetadata(tx, { ...FILE, source: 'task-output' });

    expect(statements).toHaveLength(2);
    expect(statements[1]?.text).toContain('INSERT INTO app.file_metadata');
  });
});
