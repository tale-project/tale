import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  requestTaskReview,
} from './reviews.ts';
import { TaskError, type TaskRow } from './service.ts';

vi.mock('../automations/store.ts', () => ({
  beginRunInTx: vi.fn(),
  cancelRunInTx: vi.fn(),
}));
vi.mock('./reviews.ts', () => ({
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
  vi.mocked(beginRunInTx).mockReset();
  vi.mocked(requestTaskReview).mockReset();
  vi.mocked(closePendingTaskReviewOnStatusLeave).mockReset();
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
    expect(statements[1]).toContain('SELECT id FROM app.automation_runs');
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

    expect(result).toEqual({ taskId: 't-arch', created: false });
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
    expect(result).toEqual({ taskId: 't-new', created: true });
    // (…, rank, number, external_system, external_id, …): the canonical pair.
    expect(values.insert).toEqual(expect.arrayContaining(['crm', 'café-001']));
    expect(values.insert).not.toEqual(expect.arrayContaining([' crm ']));
    expect(vi.mocked(createAuditLog).mock.calls.at(-1)?.[1]).toMatchObject({
      metadata: { externalSystem: 'crm', externalId: 'café-001' },
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

  it('fails closed on a name no root folder carries — SETUP_FOLDER_MISSING, naming the folder', async () => {
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
      message: 'Folder "Setup" does not exist in this project yet',
    });
  });
});
