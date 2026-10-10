import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
import {
  projectReviewBatch,
  replayReviewBatch,
  REVIEW_BATCH_RUN_READ_LIMIT,
  type ReviewBatchRow,
} from './review-batch-store.ts';

const target = {
  taskId: '10000000-0000-4000-8000-000000000001',
  expected: {
    approvalId: 'approval',
    runId: 'source',
    evidenceRevision: 'a'.repeat(64),
  },
};
const envelopeHash = managedConfigurationHash([target]);
if (envelopeHash === null)
  throw new Error('Expected the fixed target envelope hash');
const batch: ReviewBatchRow = {
  id: 'batch',
  organizationId: 'org',
  projectId: 'project',
  contextTaskId: 'context',
  reviewerAgentId: 'reviewer',
  managerAgentId: 'manager',
  issuerRunId: 'manager-run',
  requestId: 'request',
  targets: [target],
  envelopeHash,
};

function database(answers: unknown[][]) {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (parts: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: parts.join('?').replaceAll(/\s+/g, ' ').trim(),
      values,
    });
    const answer = answers.shift();
    if (answer === undefined) throw new Error('Unexpected query');
    return Promise.resolve(answer);
  };
  return { tx: tag as unknown as TransactionSql, statements };
}

describe('native review batch storage boundaries', () => {
  it('refuses run-history overflow before reading decisions, never truncating to complete', async () => {
    const db = database([
      Array.from({ length: REVIEW_BATCH_RUN_READ_LIMIT + 1 }, (_, index) => ({
        runId: `run-${index}`,
        status: 'settled',
      })),
    ]);
    await expect(projectReviewBatch(db.tx, batch)).rejects.toMatchObject({
      code: 'TASK_REVIEW_STALE',
    });
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0]?.values.at(-1)).toBe(
      REVIEW_BATCH_RUN_READ_LIMIT + 1,
    );
  });

  it('uses only the complete native issuer cohort and bounded declared approvals', async () => {
    const db = database([[{ runId: 'review-attempt', status: 'settled' }], []]);
    const result = await projectReviewBatch(db.tx, batch);
    expect(result.outcome).toBe('incomplete');
    const query = db.statements[0];
    for (const guard of [
      'org_id = ?',
      'project_id = ?',
      'task_id = ?',
      'agent_id = ?',
      'review_batch_id = ?',
      'in_place = true',
      "started_via = 'agent'",
      'started_via_agent_id = ?',
      'started_via_run_id = ?',
      'ORDER BY seq LIMIT ?',
    ])
      expect(query?.text).toContain(guard);
    expect(query?.values).toEqual([
      'org',
      'project',
      'context',
      'reviewer',
      'batch',
      'manager',
      'manager-run',
      129,
    ]);
    expect(db.statements[1]?.values).toEqual(['org', ['approval']]);
    expect(db.statements[1]?.text).toContain('wf_execution_id IS NULL');
  });

  it('refuses corrupt durable envelopes before any issuer or receipt read', async () => {
    const db = database([]);
    await expect(
      projectReviewBatch(db.tx, { ...batch, envelopeHash: 'b'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'TASK_REVIEW_STALE' });
    expect(db.statements).toEqual([]);
  });

  it('replays an existing immutable envelope without insertion or another start', async () => {
    const db = database([
      [{ id: batch.id, envelopeHash: batch.envelopeHash }],
      [batch],
    ]);
    const request = {
      operation: 'start_batch' as const,
      contextTaskId: 'context',
      requestId: 'request',
      targets: [target],
    };
    await expect(
      replayReviewBatch(db.tx, {
        organizationId: 'org',
        projectId: 'project',
        managerAgentId: 'manager',
        request,
      }),
    ).resolves.toEqual(batch);
    expect(db.statements.every(({ text }) => text.startsWith('SELECT'))).toBe(
      true,
    );
    expect(db.statements[0]?.values).toEqual([
      'org',
      'project',
      'context',
      'manager',
      'request',
    ]);
  });

  it('refuses a reused request ID with changed targets before reading the old batch', async () => {
    const db = database([[{ id: batch.id, envelopeHash: batch.envelopeHash }]]);
    const request = {
      operation: 'start_batch' as const,
      contextTaskId: 'context',
      requestId: 'request',
      targets: [
        { ...target, expected: { ...target.expected, runId: 'changed' } },
      ],
    };
    await expect(
      replayReviewBatch(db.tx, {
        organizationId: 'org',
        projectId: 'project',
        managerAgentId: 'manager',
        request,
      }),
    ).rejects.toMatchObject({ code: 'TASK_REVIEW_STALE' });
    expect(db.statements).toHaveLength(1);
  });
});
