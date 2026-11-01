import type { TaskReviewBatchResult } from '@tale/shared/schemas/task-review-batch';
import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handoffStartError,
  handoffStartResult,
} from './mention-handoff-runner.ts';
import {
  type MentionHandoffFacts,
  nextHandoffStep,
  recordMentionHandoffInTx,
} from './mention-handoffs.ts';
import { getPendingReviewForTask, type PendingTaskReview } from './reviews.ts';
import { isTaskRunConfined } from './run-authority.ts';
import { recordActivity, type TaskRow } from './service.ts';

vi.mock('./reviews.ts', async (original) => ({
  ...(await original<typeof import('./reviews.ts')>()),
  getPendingReviewForTask: vi.fn(),
}));
vi.mock('./run-authority.ts', async (original) => ({
  ...(await original<typeof import('./run-authority.ts')>()),
  isTaskRunConfined: vi.fn(),
}));
vi.mock('./service.ts', async (original) => ({
  ...(await original<typeof import('./service.ts')>()),
  recordActivity: vi.fn(),
}));

/** A handoff whose writing run has ended on an idle task nobody holds. */
function facts(over: Partial<MentionHandoffFacts> = {}): MentionHandoffFacts {
  return {
    authorAtWork: false,
    commentGone: false,
    archived: false,
    closed: false,
    assignedToPerson: false,
    authorMayStartAgents: true,
    starterMayAct: true,
    holder: 'none',
    automationHoldsTask: false,
    review: { kind: 'none' },
    inReview: false,
    agentAvailable: true,
    ...over,
  };
}

const IN_REVIEW = {
  inReview: true,
  review: {
    kind: 'pending',
    startable: true,
    context: { taskId: 'review-context' },
  },
} satisfies Partial<MentionHandoffFacts>;

describe('when a pending handoff starts the agent it names', () => {
  it('starts the named agent once the writing run has ended and the task is free [TASK-R88]', () => {
    expect(nextHandoffStep(facts())).toEqual({ kind: 'start' });
  });

  it('waits while the writing run works, whichever task it works [TASK-R88]', () => {
    expect(nextHandoffStep(facts({ authorAtWork: true }))).toEqual({
      kind: 'wait',
    });
    // Nothing is decided while it works: not even a closed task drops it yet.
    expect(
      nextHandoffStep(facts({ authorAtWork: true, closed: true })),
    ).toEqual({ kind: 'wait' });
  });

  it('waits while another agent’s run holds the task [TASK-R88]', () => {
    expect(nextHandoffStep(facts({ holder: 'other' }))).toEqual({
      kind: 'wait',
    });
  });

  it('refuses a start an automation holding the task or a gone agent would refuse [TASK-R88]', () => {
    expect(nextHandoffStep(facts({ automationHoldsTask: true }))).toEqual({
      kind: 'refuse',
      reason: 'automation_holds_task',
    });
    expect(nextHandoffStep(facts({ agentAvailable: false }))).toEqual({
      kind: 'refuse',
      reason: 'agent_unavailable',
    });
  });
});

describe('a handoff on a task In review [TASK-R91]', () => {
  it('starts the reviewer in place on its review context [TASK-R91]', () => {
    expect(nextHandoffStep(facts(IN_REVIEW))).toEqual({
      kind: 'review',
      contextTaskId: 'review-context',
    });
  });

  it('waits while every review context of the reviewer is held [TASK-R91]', () => {
    expect(
      nextHandoffStep(
        facts({
          inReview: true,
          review: { kind: 'pending', startable: true, context: 'busy' },
        }),
      ),
    ).toEqual({ kind: 'wait' });
  });

  it('starts nothing for a reviewer with no review context [TASK-R91]', () => {
    expect(
      nextHandoffStep(
        facts({
          inReview: true,
          review: { kind: 'pending', startable: true, context: 'none' },
        }),
      ),
    ).toEqual({ kind: 'refuse', reason: 'no_review_context' });
  });

  it('refuses a review routed to someone else, or one no agent may start [TASK-R91]', () => {
    expect(nextHandoffStep(facts({ inReview: true }))).toEqual({
      kind: 'refuse',
      reason: 'in_review',
    });
    expect(
      nextHandoffStep(
        facts({
          inReview: true,
          review: { kind: 'pending', startable: false, context: 'none' },
        }),
      ),
    ).toEqual({ kind: 'refuse', reason: 'review_unavailable' });
  });

  it('waits for the reviewer’s context while its run is held there, and starts it after [TASK-R91]', () => {
    expect(
      handoffStartResult(
        {
          outcome: 'already_running',
          runId: 'run',
          taskId: 'review-context',
          agentId: 'reviewer',
        },
        'review',
      ),
    ).toEqual({ kind: 'wait' });
    // The context moved under the pick: another one may serve.
    expect(
      handoffStartResult(
        { outcome: 'in_review', taskId: 'review-context', agentId: 'reviewer' },
        'review',
      ),
    ).toEqual({ kind: 'wait' });
    const batch: TaskReviewBatchResult = {
      batchId: 'batch',
      contextTaskId: 'review-context',
      reviewerAgentId: 'reviewer',
      requestId: 'handoff',
      outcome: 'incomplete',
      runs: [{ runId: 'review-run', status: 'queued' }],
      targets: [],
    };
    expect(
      handoffStartResult({ outcome: 'review_batch', batch }, 'review'),
    ).toEqual({ kind: 'started', runId: 'review-run' });
    expect(
      handoffStartResult(
        { outcome: 'review_batch', batch: { ...batch, runs: [] } },
        'review',
      ),
    ).toEqual({
      kind: 'refuse',
      reason: 'start_refused',
      code: 'review_batch',
    });
  });
});

describe('a pending handoff that is no longer wanted [TASK-R92]', () => {
  it('drops a handoff whose review was decided first, and starts nothing [TASK-R92]', () => {
    expect(
      nextHandoffStep(facts({ inReview: false, review: { kind: 'decided' } })),
    ).toEqual({ kind: 'drop', reason: 'review_decided' });
  });

  it('drops a handoff for each reason the task, the comment or the writer gives [TASK-R92]', () => {
    for (const [over, reason] of [
      [{ commentGone: true }, 'comment_deleted'],
      [{ archived: true }, 'archived'],
      [{ closed: true }, 'closed'],
      [{ assignedToPerson: true }, 'assigned_to_person'],
      [{ authorMayStartAgents: false }, 'grant_lost'],
      [{ starterMayAct: false }, 'starter_lost'],
      [{ holder: 'named' }, 'already_working'],
    ] as const) {
      expect(nextHandoffStep(facts(over)), reason).toEqual({
        kind: 'drop',
        reason,
      });
    }
  });

  it('drops before it waits, and waits before it refuses [TASK-R92]', () => {
    // A closed task drops even while another run holds it.
    expect(nextHandoffStep(facts({ closed: true, holder: 'other' }))).toEqual({
      kind: 'drop',
      reason: 'closed',
    });
    // Another run's hold is waited out before an automation's refuses.
    expect(
      nextHandoffStep(facts({ holder: 'other', automationHoldsTask: true })),
    ).toEqual({ kind: 'wait' });
    // A decided review drops even where the card would refuse.
    expect(
      nextHandoffStep(facts({ inReview: true, review: { kind: 'decided' } })),
    ).toEqual({ kind: 'drop', reason: 'review_decided' });
  });

  it('drops or refuses what the start door answers, as its reason [TASK-R92]', () => {
    expect(handoffStartError('TASK_ARCHIVED')).toEqual({
      kind: 'drop',
      reason: 'archived',
    });
    expect(handoffStartError('PROJECT_ARCHIVED')).toEqual({
      kind: 'drop',
      reason: 'archived',
    });
    // The writer's grant or its starter's right went away under the start.
    expect(handoffStartError('AGENT_START_FORBIDDEN')).toEqual({
      kind: 'drop',
      reason: 'starter_lost',
    });
    expect(handoffStartError('TASK_HAS_LIVE_RUN')).toEqual({ kind: 'wait' });
    expect(handoffStartError('TASK_AUTOMATION_DISABLED')).toEqual({
      kind: 'refuse',
      reason: 'automation_disabled',
    });
    expect(handoffStartError('AGENT_MODEL_MISSING')).toEqual({
      kind: 'refuse',
      reason: 'agent_unavailable',
    });
    expect(handoffStartError('TASK_REVIEW_STALE')).toEqual({
      kind: 'refuse',
      reason: 'review_unavailable',
      code: 'TASK_REVIEW_STALE',
    });
    expect(handoffStartError('SOMETHING_ELSE')).toEqual({
      kind: 'refuse',
      reason: 'start_refused',
      code: 'SOMETHING_ELSE',
    });
  });

  it('records the fourth automatic start in an hour as refused, and a start that already works as dropped [TASK-R88]', () => {
    expect(
      handoffStartResult(
        {
          outcome: 'paused',
          taskId: 'task',
          agentId: 'reviewer',
          retryAfter: 0,
        },
        'task',
      ),
    ).toEqual({ kind: 'refuse', reason: 'task_circuit_breaker' });
    expect(
      handoffStartResult(
        {
          outcome: 'blocked',
          taskId: 'task',
          agentId: 'reviewer',
          blockedBy: ['other'],
        },
        'task',
      ),
    ).toEqual({ kind: 'refuse', reason: 'blocked' });
    expect(
      handoffStartResult(
        {
          outcome: 'already_running',
          runId: 'run',
          taskId: 'task',
          agentId: 'reviewer',
        },
        'task',
      ),
    ).toEqual({ kind: 'drop', reason: 'already_working' });
    expect(
      handoffStartResult(
        {
          outcome: 'started',
          runId: 'started-run',
          taskId: 'task',
          agentId: 'reviewer',
        },
        'task',
      ),
    ).toEqual({ kind: 'started', runId: 'started-run' });
  });
});

const ORG = 'org';
const PROJECT = 'project';
const CODER = 'agent-coder';
const REVIEWER = 'agent-reviewer';
const RUN = 'run-coder';
const mention = (id: string, name = 'Reviewer') =>
  `[@${name}](mention:agent/${id})`;

const task = {
  id: 'task',
  organizationId: ORG,
  projectId: PROJECT,
} as const satisfies Pick<TaskRow, 'id' | 'organizationId' | 'projectId'>;

/**
 * The comment-side record of a handoff against a scripted transaction: the
 * writing run the comment's session and execution name, the project's
 * agents and grants, and whose run holds the task. The integration lane
 * exercises real rows, locks and the run-end trigger.
 */
function scripted(
  over: {
    writer?: { agentId: string; startedVia: string | null } | null;
    projectAgents?: string[];
    granted?: boolean;
    working?: boolean;
    replaced?: {
      messageId: string;
      authorAgentId: string;
      authorRunId: string;
    }[];
  } = {},
) {
  const writer =
    over.writer === null
      ? null
      : {
          id: RUN,
          agentId: over.writer?.agentId ?? CODER,
          projectId: PROJECT,
          sessionId: 'session',
          startedBy: 'user:mia',
          startedVia: over.writer?.startedVia ?? null,
        };
  const projectAgents = over.projectAgents ?? [CODER, REVIEWER];
  const inserted: unknown[][] = [];
  const tag = (
    parts: TemplateStringsArray | unknown[],
    ...values: unknown[]
  ) => {
    if (!('raw' in parts)) return parts;
    const text = parts.join('?').replaceAll(/\s+/g, ' ').trim();
    if (text.includes('AND exec_id ='))
      return Promise.resolve(writer === null ? [] : [writer]);
    if (text.includes("'task_start_agent' = ANY(tools)"))
      return Promise.resolve(
        over.granted === false ? [] : [{ id: writer?.agentId }],
      );
    if (text.includes('AND id = ANY(')) {
      const ids = values[2];
      return Promise.resolve(
        Array.isArray(ids)
          ? projectAgents.filter((id) => ids.includes(id)).map((id) => ({ id }))
          : [],
      );
    }
    if (text.includes('FROM app.project_agent_runs WHERE task_id ='))
      return Promise.resolve(over.working === true ? [{ id: 'run-live' }] : []);
    if (text.startsWith('DELETE FROM app.task_mention_handoffs'))
      return Promise.resolve(over.replaced ?? []);
    if (text.startsWith('INSERT INTO app.task_mention_handoffs'))
      inserted.push(values);
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bounded SQL fake; the integration lane exercises real rows
  const tx = tag as unknown as TransactionSql;
  return { tx, inserted };
}

async function record(
  tx: TransactionSql,
  text: string,
  authorAgentId: string = CODER,
): Promise<void> {
  await recordMentionHandoffInTx(tx, {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the record reads only the task's ids
    task: task as unknown as TaskRow,
    messageId: 'comment',
    text,
    authorAgentId,
    from: { sessionId: 'session', execId: 'exec' },
  });
}

function recorded() {
  return vi.mocked(recordActivity).mock.calls.map(([, entry]) => ({
    action: entry.action,
    actorId: entry.actorId,
    toValue: entry.toValue,
  }));
}

const pendingReview = (agentId: string): PendingTaskReview => ({
  approvalId: 'approval',
  taskId: task.id,
  round: 1,
  requestedFor: null,
  reviewer: { kind: 'agent', agentId },
  agentSlug: null,
  implementationAgentId: CODER,
  evidenceRevision: 'evidence',
  agentReviewBlockedReason: null,
  runId: RUN,
  createdAt: 0,
});

describe('what an agent’s comment records as a handoff', () => {
  beforeEach(() => {
    vi.mocked(recordActivity).mockReset();
    vi.mocked(isTaskRunConfined).mockReset().mockResolvedValue(false);
    vi.mocked(getPendingReviewForTask).mockReset().mockResolvedValue(null);
  });

  it('records a pending handoff to the agent the comment names, bound to nothing on an idle task [TASK-R88]', async () => {
    const { tx, inserted } = scripted();
    await record(tx, `${mention(REVIEWER)} the branch is ready`);
    expect(inserted).toHaveLength(1);
    // org, project, task, named agent, comment, writer, its run, review.
    expect(inserted[0]?.slice(0, 8)).toEqual([
      ORG,
      PROJECT,
      task.id,
      REVIEWER,
      'comment',
      CODER,
      RUN,
      null,
    ]);
    expect(recorded()).toEqual([]);
  });

  it('binds the handoff to the pending review routed to the named agent [TASK-R91]', async () => {
    vi.mocked(getPendingReviewForTask).mockResolvedValue(
      pendingReview(REVIEWER),
    );
    const { tx, inserted } = scripted();
    await record(tx, `${mention(REVIEWER)} ready for review`);
    expect(inserted[0]?.[7]).toBe('approval');

    // A review routed to someone else binds nothing.
    vi.mocked(getPendingReviewForTask).mockResolvedValue(
      pendingReview('agent-someone-else'),
    );
    const other = scripted();
    await record(other.tx, `${mention(REVIEWER)} ready for review`);
    expect(other.inserted[0]?.[7]).toBeNull();
  });

  it('replaces an earlier handoff to the same agent, and records it superseded [TASK-R92]', async () => {
    const { tx, inserted } = scripted({
      replaced: [
        { messageId: 'earlier', authorAgentId: CODER, authorRunId: 'run-old' },
      ],
    });
    await record(tx, `${mention(REVIEWER)} one more thing`);
    expect(inserted).toHaveLength(1);
    expect(recorded()).toEqual([
      {
        action: 'mention_handoff.dropped',
        actorId: REVIEWER,
        toValue: 'superseded',
      },
    ]);
  });

  it('refuses and records a writer without the start grant, a second hop and a confined run [TASK-R89]', async () => {
    const cases = [
      { setup: scripted({ granted: false }), reason: 'no_start_grant' },
      {
        setup: scripted({ writer: { agentId: CODER, startedVia: 'agent' } }),
        reason: 'second_hop',
      },
      { setup: scripted(), reason: 'confined', confined: true },
    ];
    for (const { setup, reason, confined } of cases) {
      vi.mocked(recordActivity).mockReset();
      vi.mocked(isTaskRunConfined).mockResolvedValue(confined === true);
      await record(setup.tx, `${mention(REVIEWER)} please look`);
      expect(setup.inserted, reason).toEqual([]);
      expect(recorded(), reason).toEqual([
        {
          action: 'mention_handoff.refused',
          actorId: REVIEWER,
          toValue: reason,
        },
      ]);
    }
  });

  it('hands nothing on for a comment no live run of its agent wrote [TASK-R89]', async () => {
    const none = scripted({ writer: null });
    await record(none.tx, `${mention(REVIEWER)} please look`);
    // The session's live run is another agent's: not this comment's writer.
    const other = scripted({
      writer: { agentId: 'agent-lead', startedVia: null },
    });
    await record(other.tx, `${mention(REVIEWER)} please look`);
    expect([...none.inserted, ...other.inserted]).toEqual([]);
    expect(recorded()).toEqual([]);
  });

  it('starts nothing for a mention of the writer, in a quote or in code [TASK-R90]', async () => {
    for (const text of [
      `${mention(CODER, 'Coder')} done`,
      `> ${mention(REVIEWER)} said it is done`,
      `\`${mention(REVIEWER)}\` is how you name it`,
    ]) {
      const { tx, inserted } = scripted();
      await record(tx, text);
      expect(inserted, text).toEqual([]);
    }
    expect(recorded()).toEqual([]);
  });

  it('hands to the first agent named besides the writer, of the task’s project only [TASK-R90]', async () => {
    const { tx, inserted } = scripted({
      projectAgents: [CODER, REVIEWER, 'agent-lead'],
    });
    await record(
      tx,
      `${mention(CODER, 'Coder')} ${mention('agent-elsewhere', 'Elsewhere')} ${mention(REVIEWER)} ${mention('agent-lead', 'Lead')}`,
    );
    expect(inserted.map((values) => values[3])).toEqual([REVIEWER]);

    const elsewhere = scripted();
    await record(elsewhere.tx, `${mention('agent-elsewhere', 'Elsewhere')} go`);
    expect(elsewhere.inserted).toEqual([]);
  });

  it('neither hands to nor steers an agent whose run works the task [TASK-R90]', async () => {
    const { tx, inserted } = scripted({ working: true });
    await record(tx, `${mention(REVIEWER)} one more thing`);
    expect(inserted).toEqual([]);
    expect(recorded()).toEqual([]);
  });
});
