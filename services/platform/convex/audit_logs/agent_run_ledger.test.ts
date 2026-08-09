// The provenance ledger against a real convex-test backend: one immutable
// `category: 'agent'` audit-chain entry per settled agent run, written INSIDE
// the run's exactly-once terminal mutation. Locks the exactly-once property
// (a raced double-settle writes no second entry), the payload shape and its
// caps, the live-only rule for automation runs (mock runs are tests), the
// hash-chain intactness of the entries, and the review-decision ↔ ledger join
// on runId.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { computeAuditHash } from '../lib/helpers/audit_hash';
import schema from '../schema';
import {
  AGENT_RUN_LEDGER_KNOWLEDGE_READS_CAP,
  AGENT_RUN_LEDGER_OUTPUTS_CAP,
} from './agent_run_ledger';
import { buildAuditRecordHashInput } from './helpers';

const TEST_DIR_FROM_CONVEX_ROOT = 'audit_logs';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG = 'org_ledger';
const EDITOR = 'u_editor';
const REVIEWER = 'u_reviewer';

type T = TestConvex<typeof schema>;

async function seedWorld(t: T): Promise<{
  projectId: Id<'projects'>;
  agentId: Id<'projectAgents'>;
  taskId: Id<'tasks'>;
}> {
  return t.run(async (ctx) => {
    for (const userId of [EDITOR, REVIEWER]) {
      await ctx.db.insert('memberMirror', {
        memberId: `m_${userId}_${ORG}`,
        userId,
        organizationId: ORG,
        role: 'editor',
        createdAt: 0,
      });
    }
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Apollo',
      createdBy: EDITOR,
      createdAt: 0,
      updatedAt: 0,
    });
    const agentId = await ctx.db.insert('projectAgents', {
      organizationId: ORG,
      projectId,
      name: 'PR Reviewer',
      harness: 'claude-code',
      model: 'z-ai/glm-5',
      skills: [],
      connectors: [],
      createdBy: EDITOR,
      createdAt: 0,
      updatedAt: 0,
    });
    const taskId = await ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 'Review the PR',
      status: 'todo',
      rank: 'a0',
      assigneeType: 'agent',
      assigneeId: String(agentId),
      createdBy: EDITOR,
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
    });
    return { projectId, agentId, taskId };
  });
}

/** Kick a run through the real public door and return its row. */
async function startRun(
  t: T,
  taskId: Id<'tasks'>,
): Promise<Doc<'projectAgentRuns'>> {
  const started = await t
    .withIdentity({ subject: EDITOR })
    .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
  expect(started).toEqual({ started: true });
  const run = await t.run(async (ctx) =>
    (await ctx.db.query('projectAgentRuns').collect()).at(-1),
  );
  if (!run) throw new Error('run row missing');
  return run;
}

async function ledgerRows(t: T): Promise<Doc<'auditLogs'>[]> {
  return t.run((ctx) =>
    ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_category', (q) =>
        q.eq('organizationId', ORG).eq('category', 'agent'),
      )
      .collect(),
  );
}

/** Walk the ORG's whole audit chain oldest-first: every row must link off its
 * predecessor's hash and recompute byte-for-byte — the ledger entries ride
 * the same tamper-evident chain as every other audit row. */
async function expectIntactChain(t: T): Promise<void> {
  const rows = await t.run((ctx) =>
    ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_timestamp', (q) =>
        q.eq('organizationId', ORG),
      )
      .collect(),
  );
  expect(rows.length).toBeGreaterThan(0);
  let previous = '';
  for (const row of rows) {
    expect(row.previousHash ?? '').toBe(previous);
    const recomputed = await computeAuditHash(
      previous,
      buildAuditRecordHashInput(row),
    );
    expect(row.integrityHash).toBe(recomputed);
    previous = row.integrityHash ?? '';
  }
}

describe('task-run provenance ledger', () => {
  it('a settle writes exactly one chained agent entry carrying the run provenance', async () => {
    const t = convexTest(schema, modules);
    const { agentId, taskId } = await seedWorld(t);
    const run = await startRun(t, taskId);
    const runKey = String(run._id);

    const storageId = await t.run(async (ctx) => {
      // The turn's op row (what actually served the run) + its gateway-token
      // scope snapshot, as the node host writes them at turn start.
      await ctx.db.insert('sandboxSessionOps', {
        organizationId: ORG,
        sessionId: run.sessionId,
        execId: run.execId,
        kind: 'task-agent',
        status: 'running',
        startedAt: run.startedAt,
        modelRef: 'zhipu/glm-5',
        visionModelRef: 'glm-4.6v',
        mintedKeyId: 'vk_ledger_1',
        spentCents: 12,
      });
      await ctx.db.insert('sandboxSessionTokens', {
        organizationId: ORG,
        sessionId: run.sessionId,
        tokenHash: 'hash_1',
        llmGatewayKeyId: 'vk_ledger_1',
        scope: {
          agentKind: 'claude-code',
          allowedModels: ['glm-5'],
          connectorGrants: ['github'],
          budgetCents: 500,
          toolGrants: ['list_documents'],
        },
        createdAt: run.startedAt,
        expiresAt: run.deadlineAt,
      });
      // Knowledge read-set: a pre-window call must be excluded; duplicate
      // refs inside the window fold to one.
      await ctx.db.insert('sandboxToolCalls', {
        organizationId: ORG,
        sessionId: run.sessionId,
        tool: 'rag_search',
        outcome: 'ok',
        knowledgeRefs: ['file:stale'],
        calledAt: run.startedAt - 60_000,
      });
      await ctx.db.insert('sandboxToolCalls', {
        organizationId: ORG,
        sessionId: run.sessionId,
        tool: 'rag_search',
        outcome: 'ok',
        knowledgeRefs: ['file:handbook', 'url:https://example.com/spec'],
        calledAt: Date.now(),
      });
      await ctx.db.insert('sandboxToolCalls', {
        organizationId: ORG,
        sessionId: run.sessionId,
        tool: 'rag_fetch',
        outcome: 'ok',
        knowledgeRefs: ['file:handbook'],
        calledAt: Date.now(),
      });
      // Exec pinning: a row pinned to a SIBLING turn's exec is excluded even
      // inside the window (false provenance is worse than omission); a row
      // pinned to THIS run's exec is definitively included.
      await ctx.db.insert('sandboxToolCalls', {
        organizationId: ORG,
        sessionId: run.sessionId,
        tool: 'rag_search',
        outcome: 'ok',
        knowledgeRefs: ['file:sibling-turn-secret'],
        execId: 'exec_sibling',
        calledAt: Date.now(),
      });
      await ctx.db.insert('sandboxToolCalls', {
        organizationId: ORG,
        sessionId: run.sessionId,
        tool: 'rag_search',
        outcome: 'ok',
        knowledgeRefs: ['file:pinned-own-exec'],
        execId: run.execId,
        calledAt: Date.now(),
      });
      // Deliverables stamped with THIS runId: one Convex blob (sha256/size
      // from `_storage` system metadata) and one BYO-S3 ref (falls back to
      // the row's own size, hash omitted).
      const blobId = await ctx.storage.store(new Blob(['final report']));
      await ctx.db.patch(taskId, {
        outputs: [
          {
            fileId: blobId,
            fileName: 'report.md',
            fileType: 'text/markdown',
            fileSize: 12,
            producedAt: Date.now(),
            runId: run._id,
          },
          {
            fileId: 's3:acme/deadbeef',
            fileName: 'chart.png',
            fileType: 'image/png',
            fileSize: 2048,
            producedAt: Date.now(),
            runId: run._id,
          },
        ],
      });
      // The settle-minted review row (the park-and-mint runs BEFORE the
      // terminal mark in the settle choreography).
      await ctx.db.insert('approvals', {
        organizationId: ORG,
        resourceType: 'task_review',
        resourceId: String(taskId),
        priority: 'high',
        status: 'pending',
        metadata: {
          taskId: String(taskId),
          requestedFor: REVIEWER,
          round: 0,
          runId: runKey,
        },
      });
      return blobId;
    });

    await t.mutation(internal.tasks.agent_runs.markTaskAgentRunSettled, {
      runId: run._id,
      resultText: 'done',
      execId: run.execId,
    });

    const rows = await ledgerRows(t);
    expect(rows).toHaveLength(1);
    const entry = rows[0];
    expect(entry).toMatchObject({
      action: 'agent.run_settled',
      category: 'agent',
      resourceType: 'agent_run',
      resourceId: runKey,
      resourceName: 'Review the PR',
      actorId: EDITOR,
      actorType: 'user',
      status: 'success',
    });
    const sys = await t.run((ctx) => ctx.db.system.get(storageId));
    expect(entry?.metadata).toEqual({
      surface: 'task',
      runId: runKey,
      execId: run.execId,
      taskId: String(taskId),
      projectId: String(run.projectId),
      agentId: String(agentId),
      agentName: 'PR Reviewer',
      harness: 'claude-code',
      trigger: 'manual',
      finalStatus: 'settled',
      startedAt: run.startedAt,
      settledAt: expect.any(Number),
      durationMs: expect.any(Number),
      model: {
        requested: 'z-ai/glm-5',
        servedRef: 'zhipu/glm-5',
        visionRef: 'glm-4.6v',
      },
      gateway: {
        keyId: 'vk_ledger_1',
        allowedModels: ['glm-5'],
        budgetCents: 500,
        spentCents: 12,
      },
      grants: { connectors: ['github'], tools: ['list_documents'] },
      outputs: [
        { fileName: 'report.md', sha256: sys?.sha256, size: 12 },
        { fileName: 'chart.png', size: 2048 },
      ],
      outputCount: 2,
      knowledgeReads: expect.arrayContaining([
        'file:handbook',
        'url:https://example.com/spec',
        'file:pinned-own-exec',
      ]),
      review: { reviewerUserId: REVIEWER },
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape asserted by the toEqual above
    const metadata = entry?.metadata as { knowledgeReads: string[] };
    // Distinct; the pre-window call AND the sibling-exec-pinned call are
    // excluded, the own-exec-pinned call is included.
    expect(metadata.knowledgeReads).toHaveLength(3);
    expect(metadata.knowledgeReads).not.toContain('file:sibling-turn-secret');
    await expectIntactChain(t);
  });

  it('a raced double-settle and a late failure mark write no second entry', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    const run = await startRun(t, taskId);

    await t.mutation(internal.tasks.agent_runs.markTaskAgentRunSettled, {
      runId: run._id,
      resultText: 'first',
      execId: run.execId,
    });
    // The losing racers of the settle election: a replayed settle, then a
    // watchdog failure mark — both must no-op on the terminal status.
    await t.mutation(internal.tasks.agent_runs.markTaskAgentRunSettled, {
      runId: run._id,
      resultText: 'second',
      execId: run.execId,
    });
    await t.mutation(internal.tasks.agent_runs.markTaskAgentRunFailed, {
      runId: run._id,
      error: 'late watchdog',
      execId: run.execId,
    });

    const rows = await ledgerRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toMatchObject({ finalStatus: 'settled' });
  });

  it('a failed run writes a failure entry with the reason, tolerating a missing op row', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    const run = await startRun(t, taskId);

    // A start that died before writing its op row: no session op, no token —
    // the entry still lands, with the enrichment fields omitted.
    await t.mutation(internal.tasks.agent_runs.markTaskAgentRunFailed, {
      runId: run._id,
      error: 'the agent run could not start: model unresolvable',
      execId: run.execId,
    });

    const rows = await ledgerRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'failure',
      errorMessage: 'the agent run could not start: model unresolvable',
    });
    const metadata = rows[0]?.metadata ?? {};
    expect(metadata).toMatchObject({
      finalStatus: 'failed',
      model: { requested: 'z-ai/glm-5' },
    });
    expect(metadata).not.toHaveProperty('gateway');
    expect(metadata).not.toHaveProperty('grants');
    expect(metadata).not.toHaveProperty('outputs');
    expect(metadata).not.toHaveProperty('review');
    await expectIntactChain(t);
  });

  it('the public cancel door stamps the entry atomically with the cancel', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    const run = await startRun(t, taskId);

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.cancelTaskAgentRun, { taskId });

    const rows = await ledgerRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      resourceId: String(run._id),
      status: 'success',
    });
    expect(rows[0]?.metadata).toMatchObject({ finalStatus: 'cancelled' });

    // The raced settle of the already-cancelled run stays a no-op.
    await t.mutation(internal.tasks.agent_runs.markTaskAgentRunSettled, {
      runId: run._id,
      resultText: 'too late',
      execId: run.execId,
    });
    expect(await ledgerRows(t)).toHaveLength(1);
  });

  it('a malformed output fileId degrades to name+size — the settle never wedges', async () => {
    // A corrupt/foreign `task.outputs[].fileId` (non-`s3:`, not a decodable
    // `_storage` id) used to blind-cast into `db.system.get`, which THROWS —
    // aborting the terminal mutation forever (settle/fail/cancel all stuck).
    // Module doctrine: degrade to omitted fields, never to a failed settle.
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    const run = await startRun(t, taskId);
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, {
        outputs: [
          {
            fileId: 'corrupt-not-a-storage-id',
            fileName: 'broken.bin',
            fileType: 'application/octet-stream',
            fileSize: 77,
            producedAt: Date.now(),
            runId: run._id,
          },
        ],
      });
    });

    await t.mutation(internal.tasks.agent_runs.markTaskAgentRunSettled, {
      runId: run._id,
      resultText: 'done',
      execId: run.execId,
    });

    const runRow = await t.run((ctx) => ctx.db.get(run._id));
    expect(runRow?.status).toBe('settled');
    const rows = await ledgerRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toMatchObject({
      finalStatus: 'settled',
      outputs: [{ fileName: 'broken.bin', size: 77 }],
      outputCount: 1,
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape asserted above
    const metadata = rows[0]?.metadata as {
      outputs: Record<string, unknown>[];
    };
    expect(metadata.outputs[0]).not.toHaveProperty('sha256');
  });

  it('payload arrays respect their caps', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    const run = await startRun(t, taskId);

    const outputTotal = AGENT_RUN_LEDGER_OUTPUTS_CAP + 5;
    const refTotal = AGENT_RUN_LEDGER_KNOWLEDGE_READS_CAP + 25;
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, {
        outputs: Array.from({ length: outputTotal }, (_, i) => ({
          fileId: `s3:acme/blob-${i}`,
          fileName: `file-${i}.txt`,
          fileType: 'text/plain',
          fileSize: 10,
          producedAt: Date.now(),
          runId: run._id,
        })),
      });
      // 5 calls × 45 distinct refs = 225 > the 200 cap.
      for (let call = 0; call < 5; call++) {
        await ctx.db.insert('sandboxToolCalls', {
          organizationId: ORG,
          sessionId: run.sessionId,
          tool: 'rag_search',
          outcome: 'ok',
          knowledgeRefs: Array.from(
            { length: 45 },
            (_, i) => `file:ref-${call * 45 + i}`,
          ),
          calledAt: Date.now(),
        });
      }
    });

    await t.mutation(internal.tasks.agent_runs.markTaskAgentRunSettled, {
      runId: run._id,
      resultText: 'done',
      execId: run.execId,
    });

    const rows = await ledgerRows(t);
    expect(rows).toHaveLength(1);
    const metadata = rows[0]?.metadata as {
      outputs: unknown[];
      outputCount: number;
      knowledgeReads: string[];
    };
    expect(metadata.outputs).toHaveLength(AGENT_RUN_LEDGER_OUTPUTS_CAP);
    expect(metadata.outputCount).toBe(outputTotal);
    expect(metadata.knowledgeReads).toHaveLength(
      AGENT_RUN_LEDGER_KNOWLEDGE_READS_CAP,
    );
    expect(refTotal).toBeGreaterThan(AGENT_RUN_LEDGER_KNOWLEDGE_READS_CAP);
  });
});

describe('automation-run provenance ledger', () => {
  async function seedRun(
    t: T,
    overrides: Partial<{
      mode: 'mock' | 'live';
      startedBy: string;
      status: 'running' | 'waiting' | 'queued';
      projectId: Id<'projects'>;
      input: unknown;
    }> = {},
  ): Promise<Id<'automationRuns'>> {
    return t.run((ctx) =>
      ctx.db.insert('automationRuns', {
        organizationId: ORG,
        name: 'ship-report',
        version: 3,
        ...(overrides.projectId !== undefined
          ? { projectId: overrides.projectId }
          : {}),
        status: overrides.status ?? 'running',
        mode: overrides.mode ?? 'live',
        startedBy: overrides.startedBy ?? 'trigger:tr_1',
        input: overrides.input ?? {},
        checkpoints: { nodes: {}, executions: 0 },
        claimEpoch: 5,
        startedAt: 1_000,
      }),
    );
  }

  const finish = async (
    t: T,
    runId: Id<'automationRuns'>,
    status: 'success' | 'failed' = 'success',
    epoch = 5,
  ) =>
    t.mutation(internal.automations.mutations.finishRun, {
      organizationId: ORG,
      runId,
      epoch,
      status,
      trace: [],
      effects: [{ node: 'a' }, { node: 'b' }],
      ...(status === 'failed' ? { detail: 'node-b: boom' } : {}),
      executions: 1,
    });

  it('a live finish writes the entry with approvals, effects and spend', async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    const runId = await seedRun(t);
    const runKey = String(runId);

    const approvalIds = await t.run(async (ctx) => {
      const ids = [];
      // The run's own gate rows, keyed `<runId>:<nodeId>`.
      for (const node of ['node-a', 'node-b']) {
        ids.push(
          await ctx.db.insert('approvals', {
            organizationId: ORG,
            resourceType: 'connector_operation',
            resourceId: `${runKey}:${node}`,
            priority: 'medium',
            status: 'completed',
          }),
        );
      }
      // A foreign run's row and a different resourceType must be excluded.
      await ctx.db.insert('approvals', {
        organizationId: ORG,
        resourceType: 'connector_operation',
        resourceId: 'other_run:node-a',
        priority: 'medium',
        status: 'pending',
      });
      await ctx.db.insert('approvals', {
        organizationId: ORG,
        resourceType: 'task_review',
        resourceId: `${runKey}:node-a`,
        priority: 'high',
        status: 'pending',
      });
      // The run's step session + its turn ops carry the polled spend.
      await ctx.db.insert('sandboxSessions', {
        organizationId: ORG,
        sessionId: 'wf-ledger-1',
        profile: 'agent',
        status: 'stopped',
        ownerType: 'workflow_run',
        ownerId: `${runKey}:step-1`,
        createdBy: 'system',
        createdAt: 1_000,
        expiresAt: 100_000,
      });
      await ctx.db.insert('sandboxSessionOps', {
        organizationId: ORG,
        sessionId: 'wf-ledger-1',
        execId: 'exec-a',
        kind: 'workflow-agent',
        status: 'completed',
        startedAt: 1_000,
        spentCents: 3,
      });
      await ctx.db.insert('sandboxSessionOps', {
        organizationId: ORG,
        sessionId: 'wf-ledger-1',
        execId: 'exec-b',
        kind: 'workflow-agent',
        status: 'completed',
        startedAt: 2_000,
        spentCents: 4,
      });
      return ids;
    });

    const finished = await finish(t, runId);
    expect(finished).toEqual({ status: 'success' });

    const rows = await ledgerRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'agent.run_settled',
      resourceType: 'agent_run',
      resourceId: runKey,
      resourceName: 'ship-report',
      actorId: 'trigger:tr_1',
      actorType: 'system',
      status: 'success',
    });
    expect(rows[0]?.metadata).toEqual({
      surface: 'automation',
      runId: runKey,
      automationName: 'ship-report',
      automationVersion: 3,
      startedBy: 'trigger:tr_1',
      finalStatus: 'success',
      startedAt: 1_000,
      settledAt: expect.any(Number),
      durationMs: expect.any(Number),
      approvals: approvalIds.map(String),
      effectsCount: 2,
      spentCents: 7,
    });
    await expectIntactChain(t);
  });

  it('a failed live finish writes a failure entry with the detail', async () => {
    const t = convexTest(schema, modules);
    const runId = await seedRun(t, { startedBy: 'user:u_ops' });

    await finish(t, runId, 'failed');

    const rows = await ledgerRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'failure',
      errorMessage: 'node-b: boom',
      actorId: 'u_ops',
      actorType: 'user',
    });
    expect(rows[0]?.metadata).toMatchObject({ finalStatus: 'failed' });
  });

  it('a mock run finish writes no entry', async () => {
    const t = convexTest(schema, modules);
    const runId = await seedRun(t, { mode: 'mock' });

    const finished = await finish(t, runId);
    expect(finished).toEqual({ status: 'success' });
    expect(await ledgerRows(t)).toHaveLength(0);
  });

  it('a duplicate finish and a stale-epoch finish write no second entry', async () => {
    const t = convexTest(schema, modules);
    const runId = await seedRun(t);

    await finish(t, runId);
    await finish(t, runId); // terminal-guard no-op
    await finish(t, runId, 'failed', 4); // stale claim epoch

    const rows = await ledgerRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toMatchObject({ finalStatus: 'success' });
  });

  it('an operator cancel writes the cancelled entry through the shared kernel', async () => {
    const t = convexTest(schema, modules);
    const { projectId } = await seedWorld(t);
    const runId = await seedRun(t, {
      projectId,
      startedBy: 'api-key:u_api',
      input: { task: { id: 'task-9' } },
    });

    const cancelled = await t.mutation(
      internal.automations.mutations.cancelTaskWorkflowRun,
      { organizationId: ORG, projectId, taskId: 'task-9' },
    );
    expect(cancelled).toEqual({ runId });

    const rows = await ledgerRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      resourceId: String(runId),
      actorId: 'u_api',
      actorType: 'api',
      status: 'success',
    });
    expect(rows[0]?.metadata).toMatchObject({ finalStatus: 'cancelled' });
    expect(rows[0]?.metadata).not.toHaveProperty('effectsCount');
  });
});

describe('review decision ↔ ledger join', () => {
  it('respondToTaskReview carries the reviewed runId in its audit metadata', async () => {
    const t = convexTest(schema, modules);
    const { projectId, agentId, taskId } = await seedWorld(t);
    // A settled run whose park minted the review (the real mint path, so the
    // metadata.runId join key is written by production code).
    const runId = await t.run((ctx) =>
      ctx.db.insert('projectAgentRuns', {
        organizationId: ORG,
        projectId,
        taskId,
        agentId,
        execId: 'exec-1',
        sessionId: 'pa-test',
        status: 'settled',
        harness: 'claude-code',
        model: 'z-ai/glm-5',
        startedBy: EDITOR,
        startedAt: 0,
        deadlineAt: 10_000,
        updatedAt: 0,
      }),
    );
    await t.run((ctx) => ctx.db.patch(taskId, { status: 'in_progress' }));
    const parked = await t.mutation(
      internal.tasks.internal_mutations.agentUpdateTaskStatus,
      {
        organizationId: ORG,
        actorId: String(agentId),
        taskId,
        status: 'in_review',
        review: { runId },
      },
    );
    expect(parked).toEqual({ ok: true });
    const review = await t.run(async (ctx) =>
      (await ctx.db.query('approvals').collect()).find(
        (row) => row.resourceType === 'task_review',
      ),
    );
    if (!review) throw new Error('review mint missing');

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.review_mutations.respondToTaskReview, {
        approvalId: review._id,
        decision: 'approve',
      });

    const responded = await t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).find(
        (row) => row.action === 'task.review_responded',
      ),
    );
    expect(responded?.metadata).toEqual({ runId: String(runId) });
    await expectIntactChain(t);
  });
});
