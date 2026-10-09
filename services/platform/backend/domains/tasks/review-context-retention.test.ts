import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { assertReviewContextsRetirable } from './review-context-retention.ts';

const args = {
  organizationId: 'org',
  projectId: 'project',
  taskIds: ['context'],
};

function database(
  options: {
    context?: boolean;
    orgHeld?: boolean;
    author?: string;
    heldUser?: string;
    runStarter?: string;
  } = {},
) {
  const reads: string[] = [];
  const tag = (parts: TemplateStringsArray) => {
    const text = parts.join('?').replaceAll(/\s+/g, ' ').trim();
    reads.push(text);
    if (text.includes('FROM app.project_agent_runs'))
      return Promise.resolve(
        options.runStarter
          ? [{ taskId: 'context', startedBy: options.runStarter }]
          : [],
      );
    if (text.includes('FROM app.task_review_contexts'))
      return Promise.resolve(
        options.context
          ? [{ taskId: 'context', authorUserId: options.author ?? null }]
          : [],
      );
    if (text.includes('FROM app.legal_holds'))
      return Promise.resolve(
        options.orgHeld
          ? [{ targetType: 'org', targetId: 'org' }]
          : options.heldUser
            ? [{ targetType: 'userMembership', targetId: options.heldUser }]
            : [],
      );
    throw new Error(`Unexpected statement ${text}`);
  };
  return { tx: tag as unknown as TransactionSql, reads };
}

describe('managed review context custody', () => {
  it('leaves ordinary non-context retirement on its existing path', async () => {
    const db = database({ orgHeld: true });
    await assertReviewContextsRetirable(db.tx, args);
    expect(db.reads).toHaveLength(1);
  });

  it.each([
    { context: true, orgHeld: true },
    { context: true, author: 'custodian', heldUser: 'custodian' },
    { context: true, heldUser: 'custodian', runStarter: 'custodian' },
  ])(
    'refuses destruction through the maintained predicate for %j',
    async (options) => {
      const db = database(options);
      await expect(
        assertReviewContextsRetirable(db.tx, args),
      ).rejects.toMatchObject({ code: 'LEGAL_HOLD_ACTIVE' });
      expect(db.reads.every((sql) => sql.startsWith('SELECT'))).toBe(true);
    },
  );

  it('does not invent a hold for unrelated members or unheld contexts', async () => {
    for (const options of [
      { context: true },
      { context: true, author: 'author', heldUser: 'other' },
    ]) {
      await expect(
        assertReviewContextsRetirable(database(options).tx, args),
      ).resolves.toBeUndefined();
    }
  });
});
