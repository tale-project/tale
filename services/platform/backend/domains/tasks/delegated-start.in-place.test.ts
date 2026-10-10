import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { inPlaceStartRefusal } from './delegated-start.ts';

/** A postgres.js tagged-template stand-in: the pending-review probe answers
 * one approval when `pendingReview` is set, every other statement nothing. */
function fakeTx(pendingReview: boolean): {
  tx: TransactionSql;
  statements: string[];
} {
  const statements: string[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    return Promise.resolve(
      pendingReview && text.includes('FROM app.approvals')
        ? [{ id: 'approval-1' }]
        : [],
    );
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-member stand-in for the postgres.js template function
  return { tx: tag as unknown as TransactionSql, statements };
}

const refusal = (status: string, pendingReview = false) => {
  const { tx, statements } = fakeTx(pendingReview);
  return inPlaceStartRefusal(tx, {
    organizationId: 'org-1',
    task: { id: 'task-1', status },
  }).then((answer) => ({ answer, statements }));
};

describe('inPlaceStartRefusal — the in-place rule the start and the wake scan share (#4540)', () => {
  it.each(['backlog', 'todo', 'in_progress'])(
    'lets an in-place start run under open work (%s)',
    async (status) => {
      await expect(refusal(status)).resolves.toMatchObject({ answer: null });
    },
  );

  it('answers in_review for a card at In review', async () => {
    await expect(refusal('in_review')).resolves.toMatchObject({
      answer: 'in_review',
    });
  });

  it('answers in_review for a pending task review, whatever the column', async () => {
    const { answer, statements } = await refusal('in_progress', true);
    expect(answer).toBe('in_review');
    expect(statements[0]).toContain("resource_type = 'task_review'");
    expect(statements[0]).toContain("status = 'pending'");
  });

  it.each(['done', 'cancelled'])(
    'answers closed for a %s card',
    async (status) => {
      await expect(refusal(status)).resolves.toMatchObject({
        answer: 'closed',
      });
    },
  );

  it('checks the pending review before the closed column, as the start always did', async () => {
    await expect(refusal('done', true)).resolves.toMatchObject({
      answer: 'in_review',
    });
  });
});
