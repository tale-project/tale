// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { assessRefLiveness } from './liveness.ts';

/**
 * The two liveness verdicts for a blob ref, as the statement states them.
 * An emailed attachment keeps its corpus copy only while its conversation
 * does — not deleted, not marked spam, the verdict an email body gets — but
 * its bytes follow the file row alone: a spam verdict is lifted as often as
 * it is kept, and a deleted conversation's attachment is still a stored
 * file. The rows those clauses decide are proven on real Postgres in the
 * `checkEmailedAttachments` lane; this pins where each clause sits.
 */

function recorder(): { sql: Sql; statements: string[] } {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    statements.push(strings.join('?').replace(/\s+/g, ' ').trim());
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: tag as unknown as Sql, statements };
}

describe('assessRefLiveness — an emailed attachment', () => {
  it('ties the corpus copy to a live, unjunked conversation and the bytes to the file row', async () => {
    const { sql, statements } = recorder();
    await assessRefLiveness(sql, {
      organizationId: 'org-1',
      refs: ['s3:org-1/mail/cv.pdf'],
    });
    const [statement] = statements;
    const corpus = statement?.slice(0, statement.indexOf('AS "corpusLive"'));
    const blob = statement?.slice(statement.indexOf('AS "corpusLive"'));
    expect(corpus).toContain(
      "AND (fm.conversation_id IS NULL OR EXISTS( SELECT 1 FROM app.conversations c WHERE c.id = fm.conversation_id AND c.org_id = fm.org_id AND c.status IS DISTINCT FROM 'spam' ))",
    );
    expect(blob).not.toContain('app.conversations');
  });

  it('asks nothing for no ref', async () => {
    const { sql, statements } = recorder();
    expect(
      await assessRefLiveness(sql, { organizationId: 'org-1', refs: [] }),
    ).toEqual([]);
    expect(statements).toEqual([]);
  });
});
