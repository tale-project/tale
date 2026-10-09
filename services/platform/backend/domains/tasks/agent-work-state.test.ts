/**
 * The run half of an agent's `task_get` (#3955) is read with the readers the
 * task sheet uses; this pins how it puts them together — what counts as
 * live, what waits on a person, and that a page of runs says whether an
 * older one exists. Postgres proves the reads in
 * `agent-read-tools.integration.ts`.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getPendingAskForRun } from '../automations/store.ts';
import { listTaskAgentRunSummaries } from './agent-runs.ts';
import { readTaskOccupancy, readTaskWorkState } from './agent-work-state.ts';
import {
  findLatestAutomationRunForTask,
  findLiveAutomationRunForTask,
} from './external-ref.ts';
import { readTaskReviewDecision } from './review-decision.ts';
import { readTaskReviewDelegation } from './review-delegation-receipt.ts';
import { getPendingReviewForTask } from './reviews.ts';

vi.mock('./agent-runs.ts', () => ({ listTaskAgentRunSummaries: vi.fn() }));
vi.mock('./external-ref.ts', () => ({
  findLiveAutomationRunForTask: vi.fn(),
  findLatestAutomationRunForTask: vi.fn(),
}));
vi.mock('./reviews.ts', () => ({ getPendingReviewForTask: vi.fn() }));
vi.mock('./review-delegation-receipt.ts', () => ({
  readTaskReviewDelegation: vi.fn(),
}));
vi.mock('./review-decision.ts', () => ({ readTaskReviewDecision: vi.fn() }));
vi.mock('../automations/store.ts', async (importOriginal) => ({
  // `runWaitingFor` stays the store's own: the park vocabulary is its.
  ...(await importOriginal<typeof import('../automations/store.ts')>()),
  getPendingAskForRun: vi.fn(),
}));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the readers are mocked; no statement runs
const sql = {} as Sql;
const ARGS = {
  organizationId: 'org-1',
  projectId: 'p-1',
  taskId: 't-1',
  runLimit: 2,
};

const summary = (id: string, seq: number, status = 'settled') => ({
  id,
  seq,
  agentId: 'agent-1',
  status,
  trigger: 'manual',
  startedAt: 1,
  launchedAt: 2,
  settledAt: status === 'running' ? null : 3,
  waitingForCapacity: false,
  failureCode: null,
  retryPending: false,
  feedback: null,
  feedbackTruncated: false,
});

describe('readTaskWorkState', () => {
  beforeEach(() => {
    vi.mocked(listTaskAgentRunSummaries).mockReset().mockResolvedValue([]);
    vi.mocked(findLiveAutomationRunForTask).mockReset().mockResolvedValue(null);
    vi.mocked(findLatestAutomationRunForTask)
      .mockReset()
      .mockResolvedValue(null);
    vi.mocked(getPendingAskForRun).mockReset().mockResolvedValue(null);
    vi.mocked(getPendingReviewForTask).mockReset().mockResolvedValue(null);
    vi.mocked(readTaskReviewDecision).mockReset().mockResolvedValue(null);
    vi.mocked(readTaskReviewDelegation).mockReset().mockResolvedValue(null);
  });

  it('keeps an exact historical run beside the newest occupant without review reads', async () => {
    vi.mocked(listTaskAgentRunSummaries).mockImplementation(
      async (_sql, args) =>
        args.runId === 'old'
          ? [summary('old', 1, 'failed')]
          : [summary('new', 2, 'running')],
    );
    const state = await readTaskOccupancy(sql, {
      ...ARGS,
      requestedRunId: 'old',
    });
    expect(state).toMatchObject({
      currentRun: { id: 'new', status: 'running' },
      requestedRun: { id: 'old', status: 'failed', retryPending: false },
      workflowRun: null,
    });
    expect(listTaskAgentRunSummaries).toHaveBeenNthCalledWith(2, sql, {
      organizationId: 'org-1',
      taskId: 't-1',
      limit: 1,
      runId: 'old',
    });
    expect(getPendingReviewForTask).not.toHaveBeenCalled();
    expect(readTaskReviewDecision).not.toHaveBeenCalled();
    expect(readTaskReviewDelegation).not.toHaveBeenCalled();
  });

  it('reuses the exact newest requested run and preserves an armed retry', async () => {
    vi.mocked(listTaskAgentRunSummaries).mockResolvedValue([
      { ...summary('new', 2, 'failed'), retryPending: true },
    ]);
    const state = await readTaskOccupancy(sql, {
      ...ARGS,
      requestedRunId: 'new',
    });
    expect(state?.requestedRun).toBe(state?.currentRun);
    expect(state?.requestedRun?.retryPending).toBe(true);
    expect(listTaskAgentRunSummaries).toHaveBeenCalledTimes(1);
  });

  it('refuses a missing requested run before reading workflows', async () => {
    expect(
      await readTaskOccupancy(sql, { ...ARGS, requestedRunId: 'missing' }),
    ).toBeNull();
    expect(findLiveAutomationRunForTask).not.toHaveBeenCalled();
    expect(findLatestAutomationRunForTask).not.toHaveBeenCalled();
    expect(getPendingReviewForTask).not.toHaveBeenCalled();
  });

  it('keeps workflow wait semantics in compact occupancy and propagates read failures', async () => {
    vi.mocked(findLiveAutomationRunForTask).mockResolvedValue({
      runId: 'waiting-run',
      name: 'workflow',
      status: 'waiting',
      version: 1,
      detail: 'agent:worker',
    });
    expect(await readTaskOccupancy(sql, ARGS)).toMatchObject({
      currentRun: null,
      workflowRun: { runId: 'waiting-run', live: true, waitingFor: 'agent' },
    });
    vi.mocked(listTaskAgentRunSummaries).mockRejectedValue(
      new Error('unavailable'),
    );
    await expect(readTaskOccupancy(sql, ARGS)).rejects.toThrow('unavailable');
  });

  it('reads one run past the page to say whether an older page exists', async () => {
    vi.mocked(listTaskAgentRunSummaries).mockResolvedValue([
      summary('run-3', 13, 'running'),
      summary('run-2', 12),
      summary('run-1', 11),
    ]);
    const state = await readTaskWorkState(sql, { ...ARGS, runsBeforeSeq: 14 });
    expect(listTaskAgentRunSummaries).toHaveBeenCalledWith(sql, {
      organizationId: 'org-1',
      taskId: 't-1',
      limit: 3,
      beforeSeq: 14,
    });
    expect(state.agentRuns.map((run) => run.id)).toEqual(['run-3', 'run-2']);
    expect(state.agentRunsHasMore).toBe(true);

    vi.mocked(listTaskAgentRunSummaries).mockResolvedValue([
      summary('run-1', 11),
    ]);
    const last = await readTaskWorkState(sql, ARGS);
    expect(last.agentRunsHasMore).toBe(false);
    expect(last.workflowRun).toBeNull();
    expect(last.pendingReview).toBeNull();
  });

  it('reads the automation run bound to the task and its own project', async () => {
    await readTaskWorkState(sql, ARGS);
    const subject = {
      organizationId: 'org-1',
      projectId: 'p-1',
      taskId: 't-1',
    };
    expect(findLiveAutomationRunForTask).toHaveBeenCalledWith(sql, subject);
    expect(findLatestAutomationRunForTask).toHaveBeenCalledWith(sql, subject);
    expect(getPendingReviewForTask).toHaveBeenCalledWith(sql, 'org-1', 't-1');
  });

  it('prefers the live automation run and names the question it waits on', async () => {
    vi.mocked(findLiveAutomationRunForTask).mockResolvedValue({
      runId: 'wf-live',
      name: 'intake',
      status: 'waiting',
      version: 3,
      detail: 'agent:triage',
    });
    vi.mocked(getPendingAskForRun).mockResolvedValue({
      askId: 'ask-1',
      runId: 'wf-live',
      nodeId: 'triage',
      question: 'Which ledger?',
      createdAt: 10,
      expiresAt: 20,
    });
    const state = await readTaskWorkState(sql, ARGS);
    expect(findLatestAutomationRunForTask).not.toHaveBeenCalled();
    expect(getPendingAskForRun).toHaveBeenCalledWith(sql, 'org-1', 'wf-live');
    // The question's text stays on its card and its task comment: the
    // indicator names the ask, not what it asks.
    expect(state.workflowRun).toEqual({
      runId: 'wf-live',
      automation: 'intake',
      status: 'waiting',
      live: true,
      waitingFor: 'ask',
      ask: { askId: 'ask-1', createdAt: 10, expiresAt: 20 },
    });
  });

  it('names the approval a waiting run is parked on', async () => {
    vi.mocked(findLiveAutomationRunForTask).mockResolvedValue({
      runId: 'wf-live',
      name: 'payout',
      status: 'waiting',
      version: 1,
      detail: 'approval:appr-7',
    });
    const state = await readTaskWorkState(sql, ARGS);
    expect(state.workflowRun).toEqual({
      runId: 'wf-live',
      automation: 'payout',
      status: 'waiting',
      live: true,
      waitingFor: 'approval',
      approvalId: 'appr-7',
    });
  });

  it('answers the latest finished run as not live, without looking for a question', async () => {
    vi.mocked(findLatestAutomationRunForTask).mockResolvedValue({
      runId: 'wf-old',
      name: 'intake',
      status: 'success',
      version: 2,
    });
    const state = await readTaskWorkState(sql, ARGS);
    expect(getPendingAskForRun).not.toHaveBeenCalled();
    expect(state.workflowRun).toEqual({
      runId: 'wf-old',
      automation: 'intake',
      status: 'success',
      live: false,
    });
  });

  it('carries the pending review a person decides', async () => {
    vi.mocked(getPendingReviewForTask).mockResolvedValue({
      approvalId: 'rev-1',
      taskId: 't-1',
      round: 2,
      requestedFor: 'user-9',
      reviewer: { kind: 'user', userId: 'user-9' },
      agentSlug: 'agent-1',
      implementationAgentId: 'agent-1',
      evidenceRevision: 'a'.repeat(64),
      agentReviewBlockedReason: null,
      runId: 'run-2',
      createdAt: 30,
    });
    const state = await readTaskWorkState(sql, ARGS);
    expect(state.pendingReview).toEqual({
      approvalId: 'rev-1',
      round: 2,
      runId: 'run-2',
      requestedFor: 'user-9',
      reviewer: { kind: 'user', userId: 'user-9' },
      implementationAgentId: 'agent-1',
      evidenceRevision: 'a'.repeat(64),
      agentReviewBlockedReason: null,
      createdAt: 30,
    });
  });

  it('lets a failed read fail the whole state', async () => {
    vi.mocked(getPendingReviewForTask).mockRejectedValue(
      new Error('connection terminated'),
    );
    await expect(readTaskWorkState(sql, ARGS)).rejects.toThrow(
      'connection terminated',
    );
  });

  it('carries the same blocked agent diagnosis to native task_get', async () => {
    vi.mocked(getPendingReviewForTask).mockResolvedValue({
      approvalId: 'agent-review',
      taskId: 't-1',
      round: 0,
      requestedFor: null,
      reviewer: { kind: 'agent', agentId: 'reviewer' },
      agentSlug: null,
      implementationAgentId: 'worker',
      evidenceRevision: 'a'.repeat(64),
      agentReviewBlockedReason: 'permission_missing',
      runId: 'run',
      createdAt: 1,
    });
    expect((await readTaskWorkState(sql, ARGS)).pendingReview).toMatchObject({
      reviewer: { kind: 'agent', agentId: 'reviewer' },
      agentReviewBlockedReason: 'permission_missing',
    });
  });
});
