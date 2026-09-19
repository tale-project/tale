import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { firstForeignUpload } from '../files/upload-intents.ts';
import { loadProjectOrThrow, type ProjectRow } from '../projects/service.ts';
import { type TaskRow, updateTask } from './service.ts';

vi.mock('../collab/service.ts', () => ({
  autoSubscribe: vi.fn(),
  notifyTaskAssigned: vi.fn(),
  notifyTaskReviewerAssigned: vi.fn(),
  notifyTaskStatusChanged: vi.fn(),
}));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../files/upload-intents.ts', () => ({
  firstForeignUpload: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember: vi.fn().mockResolvedValue({
    userId: 'u-bob',
    role: 'member',
    email: 'bob@example.com',
    disabled: false,
  }),
}));
vi.mock('./reviews.ts', () => ({
  closePendingTaskReviewOnStatusLeave: vi.fn(),
  collectPendingReviewsForProjects: vi.fn(() => Promise.resolve([])),
  requestTaskReview: vi.fn(),
}));
vi.mock('./agent-runs.ts', () => ({
  cancelAgentRunInTx: vi.fn(),
  kickAgentRun: vi.fn(),
}));
vi.mock('../projects/service.ts', () => ({
  listProjects: vi.fn(),
  loadProjectOrThrow: vi.fn(),
}));

/**
 * `updateTask` writes per-field `task_activity` rows so the product Activity
 * tab stops reading just "Updated" — it shows old → new for every changed
 * key. This pins the shape: one row per actually-changed field, the right
 * action naming, no stale `updated` rows, and label ids resolved to NAMES
 * (not raw ids that nobody can read).
 *
 * The whole interaction is stubbed via {@link fakeTx} (the same shape the
 * attachments suite uses); we only inspect the `INSERT INTO app.task_activity`
 * statements the call emits, in order.
 */

const auth = {
  organizationId: 'org-1',
  userId: 'u-owner',
  email: 'owner@example.com',
  role: 'owner',
  teamIds: [] as string[],
};

const project: ProjectRow = {
  id: 'p-1',
  organizationId: 'org-1',
  name: 'Board',
  description: null,
  icon: null,
  color: null,
  key: 'BRD',
  externalItemId: null,
  taskCounter: 1,
  openTaskCount: 1,
  doneTaskCount: 0,
  projectAgentCount: 0,
  teamId: null,
  sharedWithTeamIds: [],
  teamIds: [],
  instructions: null,
  knowledgeMode: null,
  agentMode: null,
  recommendedAgentSlugs: [],
  allowedAgentSlugs: [],
  modelMode: null,
  recommendedModels: [],
  allowedModels: [],
  connectorsMode: null,
  allowedConnectorSlugs: [],
  createdBy: 'u-owner',
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  pinnedAt: null,
};

function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't-1',
    organizationId: 'org-1',
    projectId: 'p-1',
    title: 'Old title',
    description: 'Old body',
    attachments: null,
    outputs: null,
    number: 1,
    status: 'todo',
    priority: 'p2',
    labelIds: ['lbl-bug'],
    assigneeType: null,
    assigneeId: null,
    reviewerUserId: 'u-alice',
    parentTaskId: null,
    commentCount: 0,
    rank: 'a0',
    externalSystem: null,
    externalId: null,
    externalUrl: null,
    threadId: null,
    discussionThreadId: null,
    sourceDiscussionThreadId: null,
    startDate: 1_000,
    startNotifiedAt: null,
    dueDate: 2_000,
    slaLevel: null,
    slaLevelAt: null,
    statusChangedAt: null,
    totalCostCents: null,
    agentRunCount: 0,
    lastAgentRunAt: null,
    claimedAt: null,
    completedAt: null,
    externalClosedAt: null,
    createdBy: 'u-owner',
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

function fakeTx(
  fixture: TaskRow,
  extra: (text: string) => unknown[] | undefined = () => undefined,
): { tx: TransactionSql; statements: { text: string; values: unknown[] }[] } {
  const statements: { text: string; values: unknown[] }[] = [];
  const LABEL_CATALOG: Record<string, string> = {
    'lbl-bug': 'Bug',
    'lbl-feature': 'Feature',
  };
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    const scripted = extra(text);
    if (scripted !== undefined) return Promise.resolve(scripted);
    if (text.startsWith('SELECT ? FROM app.tasks WHERE id = ?')) {
      return Promise.resolve([fixture]);
    }
    // resolveProjectLabels: `WHERE project_id = ? AND lower(name) = lower(? LIMIT 1`
    if (
      text.startsWith('SELECT id FROM app.task_labels') &&
      text.includes('lower(name)')
    ) {
      const name = String(values[1]);
      const entry = Object.entries(LABEL_CATALOG).find(
        ([, knownName]) => knownName.toLowerCase() === name.toLowerCase(),
      );
      return Promise.resolve(entry ? [{ id: entry[0] }] : []);
    }
    // The labels-name resolver used by the activity row writer: `id, name FROM
    // app.task_labels WHERE project_id = ? AND id = ANY(?)`.
    if (text.startsWith('SELECT id, name FROM app.task_labels')) {
      const wanted = (values[1] as string[]) ?? [];
      return Promise.resolve(
        wanted.map((id) => ({ id, name: LABEL_CATALOG[id] ?? id })),
      );
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, {
    json: (value: unknown) => ({ json: value }),
    unsafe: (text: string): unknown => text,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- three-member stand-in for the postgres.js transaction function
  return { tx: tx as unknown as TransactionSql, statements };
}

function activityRows(
  statements: { text: string; values: unknown[] }[],
): { action: string; fromValue: unknown; toValue: unknown }[] {
  return statements
    .filter((statement) =>
      statement.text.startsWith('INSERT INTO app.task_activity'),
    )
    .map((statement) => ({
      action: statement.values[5] as string,
      fromValue: statement.values[6],
      toValue: statement.values[7],
    }));
}

beforeEach(() => {
  vi.mocked(loadProjectOrThrow).mockReset().mockResolvedValue(project);
  vi.mocked(firstForeignUpload).mockReset().mockResolvedValue(null);
  vi.mocked(addJobInTx).mockReset();
});

describe('updateTask — activity row per changed field', () => {
  it('writes one title.changed row when only the title moved', async () => {
    const { tx, statements } = fakeTx(taskRow());
    await updateTask(tx, auth, { taskId: 't-1', title: 'New title' });

    const rows = activityRows(statements);
    expect(rows).toEqual([
      { action: 'title.changed', fromValue: 'Old title', toValue: 'New title' },
    ]);
    // No legacy "updated" row leaks out.
    expect(rows.some((row) => row.action === 'updated')).toBe(false);
  });

  it('emits one row per changed field for a multi-field edit', async () => {
    const { tx, statements } = fakeTx(taskRow());
    await updateTask(tx, auth, {
      taskId: 't-1',
      title: 'Renamed',
      priority: 'p0',
      labels: ['Bug', 'Feature'],
      startDate: 1_500,
      dueDate: 3_000,
    });

    const rows = activityRows(statements);
    const actions = rows.map((row) => row.action).sort();
    expect(actions).toEqual([
      'dueDate.changed',
      'labels.changed',
      'priority.changed',
      'startDate.changed',
      'title.changed',
    ]);
    const titleRow = rows.find((row) => row.action === 'title.changed');
    const priorityRow = rows.find((row) => row.action === 'priority.changed');
    const labelsRow = rows.find((row) => row.action === 'labels.changed');
    expect(titleRow).toEqual({
      action: 'title.changed',
      fromValue: 'Old title',
      toValue: 'Renamed',
    });
    expect(priorityRow).toMatchObject({
      action: 'priority.changed',
      fromValue: 'p2',
      toValue: 'p0',
    });
    // Labels stored NAMES, not ids, so the reader is not staring at "lbl_bug".
    expect(labelsRow?.fromValue).toBe('Bug');
    expect(labelsRow?.toValue).toBe('Bug, Feature');
    // No generic legacy row.
    expect(rows.some((row) => row.action === 'updated')).toBe(false);
  });

  it('writes an empty toValue when priority is cleared (so the renderer maps to "No priority")', async () => {
    const { tx, statements } = fakeTx(taskRow({ priority: 'p1' }));
    await updateTask(tx, auth, { taskId: 't-1', priority: null });

    const rows = activityRows(statements);
    expect(rows).toEqual([
      { action: 'priority.changed', fromValue: 'p1', toValue: '' },
    ]);
  });

  it('stays silent on a no-op resave (priority / reviewer / labels unchanged)', async () => {
    const { tx, statements } = fakeTx(
      taskRow({ labelIds: ['lbl-feature', 'lbl-bug'] }),
    );
    await updateTask(tx, auth, {
      taskId: 't-1',
      priority: 'p2',
      labels: ['Bug', 'Feature'],
      reviewerUserId: 'u-alice',
    });

    // Nothing changed → no activity rows at all; the existing previous-state
    // guards skip writing the audit row too (no UPDATE happens either).
    expect(activityRows(statements)).toEqual([]);
    expect(
      statements.some((statement) =>
        statement.text.startsWith('UPDATE app.tasks'),
      ),
    ).toBe(false);
  });

  it('records a reviewer.changed row using the new reviewer id (renderer resolves the name)', async () => {
    const { tx, statements } = fakeTx(taskRow({ reviewerUserId: 'u-alice' }));
    await updateTask(tx, auth, { taskId: 't-1', reviewerUserId: 'u-bob' });

    const rows = activityRows(statements);
    expect(rows).toEqual([
      {
        action: 'reviewer.changed',
        fromValue: 'u-alice',
        toValue: 'u-bob',
      },
    ]);
  });
});
