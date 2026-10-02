import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
} from '../../core/tasks/helpers.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { beginRunInTx } from '../automations/store.ts';
import {
  findTaskByExternalRef,
  resolveSetupFolderId,
  startWorkflowForTask,
  startWorkflowForTaskInTx,
  taskWorkflowStartLockKey,
  upsertTaskByExternalRef,
} from './external-ref.ts';
import {
  closePendingTaskReviewOnStatusLeave,
  getPendingReviewForTask,
  requestTaskReview,
} from './reviews.ts';
import { TaskError, type TaskRow } from './service.ts';

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn().mockResolvedValue(null),
}));
vi.mock('../automations/store.ts', () => ({
  beginRunInTx: vi.fn(),
  cancelRunInTx: vi.fn(),
}));
vi.mock('./reviews.ts', () => ({
  getPendingReviewForTask: vi.fn(),
  closePendingTaskReviewOnStatusLeave: vi.fn(),
  collectPendingReviewsForProjects: vi.fn(() => Promise.resolve([])),
  requestTaskReview: vi.fn(),
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../collab/service.ts', () => ({
  autoSubscribe: vi.fn(),
  notifyTaskAssigned: vi.fn(),
  notifyTaskStatusChanged: vi.fn(),
}));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('./agent-runs.ts', () => ({
  cancelAgentRunInTx: vi.fn(),
  kickAgentRun: vi.fn(),
}));
vi.mock('../projects/service.ts', () => ({
  listProjects: vi.fn(),
  loadProjectOrThrow: vi.fn(),
}));

/** A tagged-template stand-in that records every statement and answers
 * through `answer`; `begin` (root only) runs the callback on the same tag. */
function fakeDb(answer: (text: string, values: unknown[]) => unknown[]): {
  sql: Sql;
  tx: TransactionSql;
  statements: string[];
} {
  const statements: string[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    return Promise.resolve(answer(text, values));
  };
  const tx = Object.assign(tag, {
    json: (value: unknown) => value,
    unsafe: (text: string): unknown => text,
    // postgres.js `savepoint(cb)` runs the callback on a savepoint-scoped
    // handle and rethrows on error; the stand-in is its own scope.
    savepoint: (cb: (sql: TransactionSql) => unknown): Promise<unknown> =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stand-in serves as its own savepoint handle
      Promise.resolve(cb(tx as unknown as TransactionSql)),
  });
  const sql = Object.assign(tx, {
    begin: (callback: (tx: TransactionSql) => unknown) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the same stand-in serves as the transaction handle
      callback(tx as unknown as TransactionSql),
  });
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a four-member stand-in for the postgres.js root instance
    sql: sql as unknown as Sql,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a three-member stand-in for the postgres.js transaction function
    tx: tx as unknown as TransactionSql,
    statements,
  };
}

const task = {
  id: 't-1',
  title: 'Ship it',
  status: 'todo' as const,
  projectId: 'p-1',
  externalSystem: null,
  externalId: null,
  externalUrl: null,
};

beforeEach(() => {
  vi.mocked(readGovernancePolicyForOrg).mockResolvedValue(null);
  vi.mocked(beginRunInTx).mockReset();
  vi.mocked(requestTaskReview).mockReset();
  vi.mocked(closePendingTaskReviewOnStatusLeave).mockReset();
  vi.mocked(getPendingReviewForTask).mockReset().mockResolvedValue(null);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('startWorkflowForTask — the one-live-run guard is atomic', () => {
  it('takes the (org, automation, task) lock before looking for a live run, then inserts in the same transaction', async () => {
    vi.mocked(beginRunInTx).mockResolvedValue({ runId: 'run-1', version: 1 });
    const { sql, tx, statements } = fakeDb(() => []);

    const started = await startWorkflowForTask(sql, {
      organizationId: 'org-1',
      task,
      workflowSlug: 'triage',
      startedByUserId: 'u-1',
    });

    expect(started).toEqual({ runId: 'run-1', alreadyRunning: false });
    expect(statements[0]).toMatch(
      /^SELECT pg_advisory_xact_lock\(\s*hashtext\(\?\)\s*\)$/,
    );
    expect(statements[1]).toContain('UPDATE app.tasks');
    expect(statements[2]).toContain('SELECT id FROM app.project_agent_runs');
    expect(statements[3]).toContain('SELECT id FROM app.automation_runs');
    expect(beginRunInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        organizationId: 'org-1',
        name: 'triage',
        mode: 'live',
        startedBy: 'user:u-1',
        projectId: 'p-1',
      }),
    );
  });

  it('refuses a live agent run without starting an automation', async () => {
    const { sql } = fakeDb((text) =>
      text.includes('SELECT id FROM app.project_agent_runs')
        ? [{ id: 'agent-run-live' }]
        : [],
    );
    await expect(
      startWorkflowForTask(sql, {
        organizationId: 'org-1',
        task,
        workflowSlug: 'triage',
        startedByUserId: 'u-1',
      }),
    ).rejects.toMatchObject({ code: 'TASK_HAS_LIVE_RUN', status: 409 });
    expect(beginRunInTx).not.toHaveBeenCalled();
  });

  it('answers the live run it finds under the lock instead of inserting a twin', async () => {
    const { sql } = fakeDb((text) =>
      text.includes('SELECT id FROM app.automation_runs')
        ? [{ id: 'run-live' }]
        : [],
    );
    await expect(
      startWorkflowForTask(sql, {
        organizationId: 'org-1',
        task,
        workflowSlug: 'triage',
        startedByUserId: 'u-1',
      }),
    ).resolves.toEqual({ runId: 'run-live', alreadyRunning: true });
    expect(beginRunInTx).not.toHaveBeenCalled();
  });

  /**
   * The rule is per TASK: a live run of another automation on the same task
   * is the run a start reuses. The probe used to filter by the automation's
   * name, so a second automation slipped past the guard and two engines
   * mutated one card at once (2026-09-14 evaluation, round h, S2-3).
   */
  it('answers another automation’s live run on the task — the probe carries no name filter', async () => {
    const { sql, statements } = fakeDb((text) =>
      text.includes('SELECT id FROM app.automation_runs')
        ? [{ id: 'run-of-other-automation' }]
        : [],
    );
    await expect(
      startWorkflowForTask(sql, {
        organizationId: 'org-1',
        task,
        workflowSlug: 'triage',
        startedByUserId: 'u-1',
      }),
    ).resolves.toEqual({
      runId: 'run-of-other-automation',
      alreadyRunning: true,
    });
    expect(beginRunInTx).not.toHaveBeenCalled();
    const probe = statements.find((text) =>
      text.includes('SELECT id FROM app.automation_runs'),
    );
    expect(probe).toBeDefined();
    expect(probe).not.toContain('name =');
    expect(probe).toContain("input->'task'->>'id' = ?");
  });

  it('does not reuse a live task run attributed to another project', async () => {
    vi.mocked(beginRunInTx).mockResolvedValue({ runId: 'run-1', version: 1 });
    const { tx } = fakeDb((text, values) =>
      text.includes('SELECT id FROM app.automation_runs') &&
      !values.includes('p-1')
        ? [{ id: 'other-project-run' }]
        : [],
    );

    await expect(
      startWorkflowForTaskInTx(tx, {
        organizationId: 'org-1',
        task,
        workflowSlug: 'triage',
        startedByUserId: 'u-1',
        startedVia: 'api-key',
      }),
    ).resolves.toEqual({ runId: 'run-1', alreadyRunning: false });
    expect(beginRunInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        projectId: 'p-1',
        startedBy: 'api-key:u-1',
      }),
    );
  });

  it('refuses a new workflow when task automation is disabled', async () => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({ enabled: false });
    const { tx } = fakeDb(() => []);
    await expect(
      startWorkflowForTaskInTx(tx, {
        organizationId: 'org-1',
        task,
        workflowSlug: 'triage',
        startedByUserId: 'u-1',
      }),
    ).rejects.toMatchObject({ code: 'TASK_AUTOMATION_DISABLED', status: 403 });
    expect(beginRunInTx).not.toHaveBeenCalled();
  });

  it('reuses an existing workflow even after task automation is disabled', async () => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({ enabled: false });
    const { tx } = fakeDb((text) =>
      text.includes('SELECT id FROM app.automation_runs')
        ? [{ id: 'standing' }]
        : [],
    );
    await expect(
      startWorkflowForTaskInTx(tx, {
        organizationId: 'org-1',
        task,
        workflowSlug: 'triage',
        startedByUserId: 'u-1',
      }),
    ).resolves.toEqual({ runId: 'standing', alreadyRunning: true });
    expect(beginRunInTx).not.toHaveBeenCalled();
  });

  it('answers null for an undeployed automation only', async () => {
    vi.mocked(beginRunInTx).mockResolvedValue(null);
    const { sql } = fakeDb(() => []);
    await expect(
      startWorkflowForTask(sql, {
        organizationId: 'org-1',
        task,
        workflowSlug: 'ghost',
        startedByUserId: 'u-1',
      }),
    ).resolves.toBeNull();
  });

  it('propagates a start failure so the queue retries and the doors answer the refusal', async () => {
    const refusal = Object.assign(new Error('not bound to that project'), {
      code: 'AUTOMATION_PROJECT_FORBIDDEN',
      status: 403,
    });
    vi.mocked(beginRunInTx).mockRejectedValue(refusal);
    const { sql } = fakeDb(() => []);
    await expect(
      startWorkflowForTask(sql, {
        organizationId: 'org-1',
        task,
        workflowSlug: 'triage',
        startedByUserId: 'u-1',
      }),
    ).rejects.toBe(refusal);
  });

  it('keys the lock per (org, task) — every automation contends for the same task', () => {
    expect(taskWorkflowStartLockKey('org-1', 't-1')).toBe(
      'task-workflow-start:org-1:t-1',
    );
    expect(taskWorkflowStartLockKey('org-1', 't-2')).not.toBe(
      taskWorkflowStartLockKey('org-1', 't-1'),
    );
  });
});

describe('upsertTaskByExternalRef — an archived task is read-only to the intake', () => {
  const archived: TaskRow = {
    id: 't-arch',
    organizationId: 'org-1',
    projectId: 'p-1',
    title: 'Hidden',
    description: null,
    attachments: null,
    outputs: null,
    number: 7,
    status: 'todo',
    priority: null,
    labelIds: [],
    assigneeType: null,
    assigneeId: null,
    reviewerUserId: null,
    reviewerAgentId: null,
    parentTaskId: null,
    commentCount: 0,
    rank: 'a0',
    externalSystem: 'github',
    externalId: '42',
    externalUrl: null,
    threadId: null,
    discussionThreadId: null,
    sourceDiscussionThreadId: null,
    startDate: null,
    startNotifiedAt: null,
    dueDate: null,
    slaLevel: null,
    slaLevelAt: null,
    statusChangedAt: 1,
    totalCostCents: null,
    agentRunCount: 0,
    lastAgentRunAt: null,
    claimedAt: null,
    completedAt: null,
    externalClosedAt: null,
    repeat: null,
    repeatNextTaskId: null,
    repeatContinued: false,
    createdBy: 'u-1',
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: 1_700_000_000_000,
  };

  it('resolves the ref but neither moves the card nor mints a review gate on an external close', async () => {
    const { tx, statements } = fakeDb((text) =>
      text.includes('FROM app.tasks WHERE org_id = ?') ? [archived] : [],
    );

    const result = await upsertTaskByExternalRef(tx, {
      organizationId: 'org-1',
      actorId: 'u-2',
      projectId: 'p-1',
      externalSystem: 'github',
      externalId: '42',
      title: 'Renamed upstream',
      externalState: 'closed',
      dedupeScope: 'project',
    });

    // The card keeps its own title — the one the answer names.
    expect(result).toEqual({
      taskId: 't-arch',
      created: false,
      title: 'Hidden',
    });
    expect(statements.filter((text) => /^(UPDATE|INSERT)/.test(text))).toEqual(
      [],
    );
    expect(requestTaskReview).not.toHaveBeenCalled();
  });
});

/**
 * The external lifecycle is a two-way door for the mirror (2026-09-13
 * evaluation, E2-02): a `closed` by anyone but the workflow engine parks
 * the task at `in_review` AND stamps the park as the mirror's; an `open`
 * lifts exactly such a park (and a `done`) back to the inbox and clears the
 * stamp; a park nobody stamped — a person's, an agent's — is left alone.
 * `closed` used to park and `open` to lift `done` alone, so a mirror could
 * never undo a close it made.
 */
describe('upsertTaskByExternalRef — the mirror-owned reopen', () => {
  const parked = (overrides: Partial<TaskRow>): TaskRow => ({
    id: 't-park',
    organizationId: 'org-1',
    projectId: 'p-1',
    title: 'Mirrored',
    description: null,
    attachments: null,
    outputs: null,
    number: 9,
    status: 'in_review',
    priority: null,
    labelIds: [],
    assigneeType: null,
    assigneeId: null,
    reviewerUserId: null,
    reviewerAgentId: null,
    parentTaskId: null,
    commentCount: 0,
    rank: 'a0',
    externalSystem: 'crm',
    externalId: 'case-1',
    externalUrl: null,
    threadId: null,
    discussionThreadId: null,
    sourceDiscussionThreadId: null,
    startDate: null,
    startNotifiedAt: null,
    dueDate: null,
    slaLevel: null,
    slaLevelAt: null,
    statusChangedAt: 1,
    totalCostCents: null,
    agentRunCount: 0,
    lastAgentRunAt: null,
    claimedAt: null,
    completedAt: null,
    externalClosedAt: null,
    repeat: null,
    repeatNextTaskId: null,
    repeatContinued: false,
    createdBy: 'u-1',
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...overrides,
  });
  const intake = {
    organizationId: 'org-1',
    actorId: 'u-2',
    projectId: 'p-1',
    externalSystem: 'crm',
    externalId: 'case-1',
    title: 'Mirrored',
    dedupeScope: 'project' as const,
  };
  interface Update {
    text: string;
    values: unknown[];
  }
  /** The task UPDATE the reconcile writes, with a column reader — the
   * statement spells `column = ?` per assignment, in order. */
  const captured = (
    row: TaskRow,
  ): { tx: TransactionSql; updates: Update[] } => {
    const updates: Update[] = [];
    const { tx } = fakeDb((text, values) => {
      if (text.startsWith('UPDATE app.tasks SET'))
        updates.push({ text, values });
      return text.includes('FROM app.tasks WHERE org_id = ?') ? [row] : [];
    });
    return { tx, updates };
  };
  const column = (update: Update | undefined, name: string): unknown => {
    if (update === undefined) return undefined;
    const columns = [...update.text.matchAll(/(\w+) = \?/g)].map((m) => m[1]);
    return update.values[columns.indexOf(name)];
  };

  it('stamps a park it makes, at in_review, and requests the review', async () => {
    const { tx, updates } = captured(parked({ status: 'todo' }));
    const before = Date.now();
    await upsertTaskByExternalRef(tx, { ...intake, externalState: 'closed' });
    expect(column(updates[0], 'status')).toBe('in_review');
    expect(column(updates[0], 'completed_at_ms')).toBeNull();
    expect(column(updates[0], 'external_closed_at_ms')).toBeGreaterThanOrEqual(
      before,
    );
    expect(requestTaskReview).toHaveBeenCalledTimes(1);
  });

  it.each(['closed', 'open'] as const)(
    'records upstream %s while preserving a captured agent review',
    async (externalState) => {
      vi.mocked(getPendingReviewForTask).mockResolvedValue({
        approvalId: 'approval',
        taskId: 't-1',
        round: 0,
        reviewer: { kind: 'agent', agentId: 'reviewer' },
        requestedFor: null,
        agentSlug: null,
        implementationAgentId: 'author',
        evidenceRevision: 'a'.repeat(64),
        agentReviewBlockedReason: null,
        runId: 'run',
        createdAt: 1,
      });
      const { tx, updates } = captured(
        parked({
          status: 'in_review',
          externalClosedAt: externalState === 'open' ? 123 : null,
        }),
      );
      await upsertTaskByExternalRef(tx, {
        ...intake,
        actorId: 'workflow',
        externalState,
      });
      expect(column(updates[0], 'status')).toBe('in_review');
      expect(column(updates[0], 'completed_at_ms')).toBeNull();
      if (externalState === 'open')
        expect(column(updates[0], 'external_closed_at_ms')).toBeNull();
      else
        expect(column(updates[0], 'external_closed_at_ms')).toBeGreaterThan(
          123,
        );
      expect(closePendingTaskReviewOnStatusLeave).not.toHaveBeenCalled();
      expect(requestTaskReview).not.toHaveBeenCalled();
    },
  );

  it('reopens a park it stamped back to the inbox and clears the stamp', async () => {
    const { tx, updates } = captured(
      parked({ status: 'in_review', externalClosedAt: 1_789_000_000_000 }),
    );
    await upsertTaskByExternalRef(tx, { ...intake, externalState: 'open' });
    expect(column(updates[0], 'status')).toBe('backlog');
    expect(column(updates[0], 'external_closed_at_ms')).toBeNull();
    expect(closePendingTaskReviewOnStatusLeave).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ toStatus: 'backlog' }),
    );
    expect(requestTaskReview).not.toHaveBeenCalled();
  });

  it('leaves a park nobody stamped where it is', async () => {
    const { tx, updates } = captured(
      parked({ status: 'in_review', externalClosedAt: null }),
    );
    await upsertTaskByExternalRef(tx, { ...intake, externalState: 'open' });
    expect(column(updates[0], 'status')).toBe('in_review');
    expect(closePendingTaskReviewOnStatusLeave).not.toHaveBeenCalled();
  });

  it('still reopens a done task, stamped or not', async () => {
    for (const externalClosedAt of [null, 1_789_000_000_000]) {
      const { tx, updates } = captured(
        parked({ status: 'done', completedAt: 5, externalClosedAt }),
      );
      await upsertTaskByExternalRef(tx, { ...intake, externalState: 'open' });
      expect(column(updates[0], 'status')).toBe('backlog');
      expect(column(updates[0], 'completed_at_ms')).toBeNull();
      expect(column(updates[0], 'external_closed_at_ms')).toBeNull();
    }
  });

  it('does not touch a cancelled task in either direction', async () => {
    for (const externalState of ['open', 'closed'] as const) {
      const { tx, updates } = captured(parked({ status: 'cancelled' }));
      await upsertTaskByExternalRef(tx, { ...intake, externalState });
      expect(column(updates[0], 'status')).toBe('cancelled');
      expect(column(updates[0], 'external_closed_at_ms')).toBeNull();
    }
  });

  it.each(['github', 'glitchtip'])(
    '%s source-less intakes preserve Tale decisions for every actor and source state',
    async (externalSystem) => {
      for (const actorId of ['u-2', 'workflow']) {
        for (const externalState of ['open', 'closed'] as const) {
          for (const status of [
            'todo',
            'in_review',
            'done',
            'cancelled',
          ] as const) {
            const { tx, updates } = captured(
              parked({
                externalSystem,
                status,
                completedAt: status === 'done' ? 5 : null,
                externalClosedAt: 1_789_000_000_000,
              }),
            );
            await upsertTaskByExternalRef(tx, {
              ...intake,
              externalSystem,
              actorId,
              externalState,
            });
            expect(column(updates[0], 'status')).toBe(status);
            expect(column(updates[0], 'completed_at_ms')).toBe(
              status === 'done' ? 5 : null,
            );
            expect(column(updates[0], 'status_changed_at_ms')).toBe(1);
          }
        }
      }
      expect(requestTaskReview).not.toHaveBeenCalled();
      expect(closePendingTaskReviewOnStatusLeave).not.toHaveBeenCalled();
    },
  );

  it.each(['github', 'glitchtip'])(
    '%s source-less closed create starts in backlog even for a workflow',
    async (externalSystem) => {
      let inserted: unknown[] = [];
      const { tx } = fakeDb((text, values) => {
        if (text.startsWith('INSERT INTO app.tasks')) {
          inserted = values;
          return [{ id: 't-new' }];
        }
        if (text.startsWith('SELECT id FROM app.projects'))
          return [{ id: 'p-1' }];
        if (text.startsWith('UPDATE app.projects SET task_counter'))
          return [{ taskCounter: 3 }];
        return [];
      });
      await upsertTaskByExternalRef(tx, {
        ...intake,
        externalSystem,
        actorId: 'workflow',
        externalState: 'closed',
      });
      expect(inserted[4]).toBe('backlog');
    },
  );

  const weekly = {
    frequency: 'weekly',
    interval: 1,
    weekdays: [1],
    timezone: 'Europe/Zurich',
  };

  it('the workflow engine’s close continues no series: a repeating task gets no copy', async () => {
    const updates: Update[] = [];
    const { tx, statements } = fakeDb((text, values) => {
      if (text.startsWith('UPDATE app.tasks SET')) {
        updates.push({ text, values });
      }
      return text.includes('FROM app.tasks WHERE org_id = ?')
        ? [parked({ status: 'in_progress', repeat: weekly })]
        : [];
    });
    await upsertTaskByExternalRef(tx, {
      ...intake,
      actorId: 'workflow',
      externalState: 'closed',
    });
    // The close itself lands, and it is the only task write.
    expect(updates).toHaveLength(1);
    expect(column(updates[0], 'status')).toBe('done');
    expect(
      statements.some(
        (text) =>
          text.startsWith('INSERT INTO app.tasks') ||
          text.includes('repeat_next_task_id') ||
          text.includes('FOR UPDATE'),
      ),
    ).toBe(false);
  });

  it('handing an unassigned repeating task to its automation ends the series on the timeline', async () => {
    const activity: unknown[][] = [];
    const { tx, statements } = fakeDb((text, values) => {
      if (text.startsWith('INSERT INTO app.task_activity')) {
        activity.push(values);
      }
      return text.includes('FROM app.tasks WHERE org_id = ?')
        ? [parked({ status: 'todo', repeat: weekly })]
        : [];
    });
    await upsertTaskByExternalRef(tx, {
      ...intake,
      automationSlug: 'crm-desk',
    });
    expect(statements).toContain(
      'UPDATE app.tasks SET repeat_rule = NULL WHERE id = ?',
    );
    expect(
      activity.map((values) => [values[3], values[4], values[5], values[6]]),
    ).toEqual([['agent', 'u-2', 'repeat.changed', JSON.stringify(weekly)]]);
  });

  it('a repeating task someone already holds keeps its rule through the intake', async () => {
    const { tx, statements } = fakeDb((text) =>
      text.includes('FROM app.tasks WHERE org_id = ?')
        ? [
            parked({
              status: 'todo',
              repeat: weekly,
              assigneeType: 'user',
              assigneeId: 'u-1',
            }),
          ]
        : [],
    );
    await upsertTaskByExternalRef(tx, {
      ...intake,
      automationSlug: 'crm-desk',
    });
    expect(statements.some((text) => text.includes('repeat_rule'))).toBe(false);
  });
});

/**
 * The external ref is canonical — NFC, trimmed — at every lookup and write,
 * the one rule the project family's `externalItemId` follows. A padded or
 * differently normalized repeat used to be a second task.
 */
describe('the external ref is canonical at the lookup and the write', () => {
  const nfd = 'café'.normalize('NFD');

  it('looks the ref up in its canonical form', async () => {
    const { tx, statements } = fakeDb(() => []);
    const captured: unknown[][] = [];
    const { tx: capturing } = fakeDb((text, values) => {
      if (text.includes('FROM app.tasks WHERE org_id = ?'))
        captured.push(values);
      return [];
    });
    await findTaskByExternalRef(capturing, {
      organizationId: 'org-1',
      projectId: 'p-1',
      externalSystem: ' crm ',
      externalId: `  ${nfd}-001\n`,
      dedupeScope: 'project',
    });
    // (columns, org_id, project_id, external_system, external_id)
    expect(captured[0]?.slice(3)).toEqual(['crm', 'café-001']);
    await expect(
      findTaskByExternalRef(tx, {
        organizationId: 'org-1',
        projectId: 'p-1',
        externalSystem: 'crm',
        externalId: '   ',
        dedupeScope: 'project',
      }),
    ).rejects.toMatchObject({ code: 'TASK_EXTERNAL_REF_INVALID', status: 400 });
    expect(statements).toEqual([]);
  });

  it('creates the task with the canonical ref and audits it that way', async () => {
    const values: Record<string, unknown[]> = {};
    const { tx } = fakeDb((text, args) => {
      if (text.startsWith('INSERT INTO app.tasks')) {
        values.insert = args;
        return [{ id: 't-new' }];
      }
      if (text.startsWith('SELECT id FROM app.projects'))
        return [{ id: 'p-1' }];
      if (text.startsWith('UPDATE app.projects SET task_counter'))
        return [{ taskCounter: 3 }];
      return [];
    });
    const result = await upsertTaskByExternalRef(tx, {
      organizationId: 'org-1',
      actorId: 'u-1',
      projectId: 'p-1',
      externalSystem: ' crm ',
      externalId: `  ${nfd}-001\n`,
      title: 'Prepare',
      dedupeScope: 'project',
    });
    expect(result).toEqual({
      taskId: 't-new',
      created: true,
      title: 'Prepare',
    });
    // (…, rank, number, external_system, external_id, …): the canonical pair.
    expect(values.insert).toEqual(expect.arrayContaining(['crm', 'café-001']));
    expect(values.insert).not.toEqual(expect.arrayContaining([' crm ']));
    expect(vi.mocked(createAuditLog).mock.calls.at(-1)?.[1]).toMatchObject({
      metadata: { externalSystem: 'crm', externalId: 'café-001' },
    });
  });
});

/**
 * Imported text is cut to the board's caps, never refused: the upsert is the
 * import verb, and one long issue body must not fail its item's create and
 * every reconcile after it. The title always was cut; the description used to
 * be stored at any length, where the board's own edit then refused it.
 */
describe('upsertTaskByExternalRef — an over-long description is cut, like the title', () => {
  const longBody = `${'d'.repeat(TASK_DESCRIPTION_MAX)} and the rest of the body`;
  const cutBody = `${'d'.repeat(TASK_DESCRIPTION_MAX - 1)}…`;
  const intake = {
    organizationId: 'org-1',
    actorId: 'agent-1',
    projectId: 'p-1',
    externalSystem: 'crm',
    externalId: 'case-7',
    dedupeScope: 'project' as const,
  };
  const existing: TaskRow = {
    id: 't-7',
    organizationId: 'org-1',
    projectId: 'p-1',
    title: 'Case 7',
    description: 'Short',
    attachments: null,
    outputs: null,
    number: 7,
    status: 'todo',
    priority: null,
    labelIds: [],
    assigneeType: null,
    assigneeId: null,
    reviewerUserId: null,
    reviewerAgentId: null,
    parentTaskId: null,
    commentCount: 0,
    rank: 'a0',
    externalSystem: 'crm',
    externalId: 'case-7',
    externalUrl: null,
    threadId: null,
    discussionThreadId: null,
    sourceDiscussionThreadId: null,
    startDate: null,
    startNotifiedAt: null,
    dueDate: null,
    slaLevel: null,
    slaLevelAt: null,
    statusChangedAt: 1,
    totalCostCents: null,
    agentRunCount: 0,
    lastAgentRunAt: null,
    claimedAt: null,
    completedAt: null,
    externalClosedAt: null,
    createdBy: 'u-1',
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    repeat: null,
    repeatNextTaskId: null,
    repeatContinued: false,
  };

  /** The create lane's INSERT values: (org, project, title, description, …). */
  async function created(description: string): Promise<unknown[]> {
    let inserted: unknown[] = [];
    const { tx } = fakeDb((text, values) => {
      if (text.startsWith('INSERT INTO app.tasks')) {
        inserted = values;
        return [{ id: 't-new' }];
      }
      if (text.startsWith('SELECT id FROM app.projects'))
        return [{ id: 'p-1' }];
      if (text.startsWith('UPDATE app.projects SET task_counter'))
        return [{ taskCounter: 7 }];
      return [];
    });
    await expect(
      upsertTaskByExternalRef(tx, {
        ...intake,
        title: 't'.repeat(TASK_TITLE_MAX + 1),
        description,
      }),
    ).resolves.toEqual({
      taskId: 't-new',
      created: true,
      title: `${'t'.repeat(TASK_TITLE_MAX - 1)}…`,
    });
    return inserted;
  }

  /** The description the reconcile lane's UPDATE writes. */
  async function reconciled(description: string): Promise<unknown> {
    let update: { text: string; values: unknown[] } | undefined;
    const { tx } = fakeDb((text, values) => {
      if (text.startsWith('UPDATE app.tasks SET')) update = { text, values };
      return text.includes('FROM app.tasks WHERE org_id = ?') ? [existing] : [];
    });
    await expect(
      upsertTaskByExternalRef(tx, { ...intake, title: 'Case 7', description }),
    ).resolves.toEqual({ taskId: 't-7', created: false, title: 'Case 7' });
    const columns = [...(update?.text ?? '').matchAll(/(\w+) = \?/g)].map(
      (match) => match[1],
    );
    return update?.values[columns.indexOf('description')];
  }

  it('creates the task with both cut to their caps, ending in "…"', async () => {
    const inserted = await created(longBody);
    expect(inserted[2]).toBe(`${'t'.repeat(TASK_TITLE_MAX - 1)}…`);
    expect(inserted[3]).toBe(cutBody);
  });

  it('reconciles an existing task with the description cut to the cap', async () => {
    await expect(reconciled(longBody)).resolves.toBe(cutBody);
  });

  it('keeps a description at the cap as sent, trimmed', async () => {
    const atCap = 'd'.repeat(TASK_DESCRIPTION_MAX);
    expect((await created(`  ${atCap}\n`))[3]).toBe(atCap);
    await expect(reconciled(`${atCap} `)).resolves.toBe(atCap);
  });
});

/**
 * The upsert answers the title the task carries after the write, which the
 * workflow natives hand back to a run: the imported title as cut on a create
 * and a plain reconcile, the stored one where the write leaves the title
 * alone. It used to answer only `{taskId, created}`, and the natives echoed
 * the title they were sent — uncut, and on a source-snapshot reconcile (every
 * GitHub or GlitchTip sync) not the task's title at all.
 */
describe('upsertTaskByExternalRef — answers the title the task carries', () => {
  const long = `${'T'.repeat(TASK_TITLE_MAX)} and the rest of the title`;
  const cut = `${'T'.repeat(TASK_TITLE_MAX - 1)}…`;
  const intake = {
    organizationId: 'org-1',
    actorId: 'workflow',
    projectId: 'p-1',
    externalSystem: 'github',
    externalId: 'acme/widgets#42',
    dedupeScope: 'project' as const,
  };
  const stored: TaskRow = {
    id: 't-42',
    organizationId: 'org-1',
    projectId: 'p-1',
    title: 'Triaged in Tale',
    description: null,
    attachments: null,
    outputs: null,
    number: 42,
    status: 'todo',
    priority: null,
    labelIds: [],
    assigneeType: null,
    assigneeId: null,
    reviewerUserId: null,
    reviewerAgentId: null,
    parentTaskId: null,
    commentCount: 0,
    rank: 'a0',
    externalSystem: 'github',
    externalId: 'acme/widgets#42',
    externalUrl: null,
    threadId: null,
    discussionThreadId: null,
    sourceDiscussionThreadId: null,
    startDate: null,
    startNotifiedAt: null,
    dueDate: null,
    slaLevel: null,
    slaLevelAt: null,
    statusChangedAt: 1,
    totalCostCents: null,
    agentRunCount: 0,
    lastAgentRunAt: null,
    claimedAt: null,
    completedAt: null,
    externalClosedAt: null,
    createdBy: 'u-1',
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    repeat: null,
    repeatNextTaskId: null,
    repeatContinued: false,
  };
  const snapshot = {
    id: '9042',
    title: long,
    description: 'Upstream body',
    url: 'https://github.com/acme/widgets/issues/42',
    state: 'open' as const,
    syncedAt: 1_700_000_000_000,
    repositoryId: 7,
    number: 42,
  };
  /** The upsert over one existing row, with the task UPDATEs it wrote. */
  const reconciling = (
    row: TaskRow,
  ): { tx: TransactionSql; updates: string[] } => {
    const updates: string[] = [];
    const { tx } = fakeDb((text) => {
      if (text.startsWith('UPDATE app.tasks SET')) {
        updates.push(text);
        return [{ id: row.id }];
      }
      return text.includes('FROM app.tasks WHERE org_id = ?') ? [row] : [];
    });
    return { tx, updates };
  };

  it('answers the cut title a plain reconcile writes', async () => {
    const { tx, updates } = reconciling(stored);
    await expect(
      upsertTaskByExternalRef(tx, { ...intake, title: long }),
    ).resolves.toEqual({ taskId: 't-42', created: false, title: cut });
    expect(updates[0]).toMatch(/title = \?/);
  });

  it('answers the stored title a source-snapshot reconcile keeps', async () => {
    const { tx, updates } = reconciling(stored);
    await expect(
      upsertTaskByExternalRef(tx, {
        ...intake,
        title: long,
        externalIssue: snapshot,
      }),
    ).resolves.toEqual({
      taskId: 't-42',
      created: false,
      title: 'Triaged in Tale',
    });
    // The snapshot was recorded; no Tale field, the title included, was.
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain('external_issue = ?');
    expect(updates[0]).not.toMatch(/[ ,]title = \?/);
  });

  it('answers the cut title when nothing was materialized', async () => {
    const { tx } = fakeDb(() => []);
    await expect(
      upsertTaskByExternalRef(tx, {
        ...intake,
        title: long,
        createIfMissing: false,
      }),
    ).resolves.toEqual({ taskId: null, created: false, title: cut });
  });

  it('answers the winner’s title when a concurrent intake wins the insert', async () => {
    let lookups = 0;
    const { tx } = fakeDb((text) => {
      if (text.includes('FROM app.tasks WHERE org_id = ?')) {
        lookups += 1;
        // Missing at the first look, the winner's row at the second.
        return lookups === 1 ? [] : [{ ...stored, archivedAt: 5 }];
      }
      if (text.startsWith('SELECT id FROM app.projects'))
        return [{ id: 'p-1' }];
      if (text.startsWith('UPDATE app.projects SET task_counter'))
        return [{ taskCounter: 43 }];
      // `INSERT … ON CONFLICT DO NOTHING` answered no row: the race is lost.
      return [];
    });
    await expect(
      upsertTaskByExternalRef(tx, { ...intake, title: long }),
    ).resolves.toEqual({
      taskId: 't-42',
      created: false,
      title: 'Triaged in Tale',
    });
  });
});

/**
 * The desks' binding convention, resolved once for both doors: the app's
 * `from-external-issue` intake and the REST `setupFolderName` field hand
 * the folder's id to the task's `externalUrl` through this one lookup, so
 * the two cannot drift on what "the Setup folder" means — a root folder of
 * the project, by name, without regard to case.
 */
describe('resolveSetupFolderId — the Setup folder a desk binds by name', () => {
  it('answers the root folder’s id, matched by trimmed name without regard to case', async () => {
    let bound: unknown[] = [];
    const { tx, statements } = fakeDb((text, values) => {
      if (!text.includes('FROM app.folders')) return [];
      bound = values;
      return [{ id: 'folder-setup' }];
    });
    await expect(
      resolveSetupFolderId(tx, {
        organizationId: 'org-1',
        projectId: 'p-1',
        setupFolderName: '  Client Setup ',
      }),
    ).resolves.toBe('folder-setup');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('parent_id IS NULL');
    expect(statements[0]).toContain('lower(name) = ?');
    expect(bound).toEqual(['org-1', 'p-1', 'client setup']);
  });

  it('fails closed on a name no root folder carries — SETUP_FOLDER_MISSING, naming the rule, not the name', async () => {
    const { tx } = fakeDb(() => []);
    const attempt = resolveSetupFolderId(tx, {
      organizationId: 'org-1',
      projectId: 'p-1',
      setupFolderName: 'Setup',
    });
    await expect(attempt).rejects.toBeInstanceOf(TaskError);
    await expect(attempt).rejects.toMatchObject({
      code: 'SETUP_FOLDER_MISSING',
      status: 400,
      message:
        'No root folder of this project carries that setup folder name yet',
    });
  });
});
