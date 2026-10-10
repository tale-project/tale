import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
import { assertReviewBatchTarget } from './review-batch-scope.ts';

const auth = {
  organizationId: 'org',
  projectId: 'project',
  agentId: 'reviewer',
  sessionId: 'session',
  execId: 'exec',
};
const target = {
  taskId: '10000000-0000-4000-8000-000000000001',
  expected: {
    approvalId: 'approval',
    runId: 'source',
    evidenceRevision: 'a'.repeat(64),
  },
};
function database(row: unknown) {
  const statements: string[] = [];
  const tag = (parts: TemplateStringsArray) => {
    statements.push(parts.join('?').replaceAll(/\s+/g, ' ').trim());
    return Promise.resolve(row === undefined ? [] : [row]);
  };
  return { tx: tag as unknown as TransactionSql, statements };
}

describe('batch-bound review action scope', () => {
  it('preserves ordinary reviewer runs without a batch binding', async () => {
    await expect(
      assertReviewBatchTarget(
        database({ batchId: null }).tx,
        auth,
        'issuer',
        target,
      ),
    ).resolves.toBeUndefined();
  });

  it('accepts an exact target only through a native same-context issuer join', async () => {
    const db = database({
      batchId: 'batch',
      targets: [target],
      envelopeHash: managedConfigurationHash([target]),
    });
    await assertReviewBatchTarget(db.tx, auth, 'issuer', target);
    for (const guard of [
      'b.org_id = r.org_id',
      'b.project_id = r.project_id',
      'b.context_task_id = r.task_id',
      'b.reviewer_agent_id = r.agent_id',
      'r.started_via_run_id = b.issuer_run_id',
    ])
      expect(db.statements[0]).toContain(guard);
  });

  it.each(['taskId', 'approvalId', 'runId', 'evidenceRevision'])(
    'refuses a changed %s',
    async (field) => {
      const db = database({
        batchId: 'batch',
        targets: [target],
        envelopeHash: managedConfigurationHash([target]),
      });
      const changed =
        field === 'taskId'
          ? { ...target, taskId: 'different' }
          : {
              ...target,
              expected: { ...target.expected, [field]: 'different' },
            };
      await expect(
        assertReviewBatchTarget(db.tx, auth, 'issuer', changed),
      ).rejects.toMatchObject({ code: 'TASK_REVIEW_FORBIDDEN' });
    },
  );

  it('refuses a missing issuer, missing batch or corrupt stored hash', async () => {
    for (const row of [
      undefined,
      { batchId: 'batch', targets: null },
      { batchId: 'batch', targets: [target], envelopeHash: 'b'.repeat(64) },
    ]) {
      await expect(
        assertReviewBatchTarget(database(row).tx, auth, 'issuer', target),
      ).rejects.toMatchObject({ code: 'TASK_REVIEW_FORBIDDEN' });
    }
  });
});
