import type { ManagedTaskReviewContext } from '@tale/shared/schemas/managed-configuration';
import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
import { loadProjectOrThrow } from '../projects/service.ts';
import { updateTaskReviewContextConfiguration } from './review-context.ts';
import { agentReviewerEligibility } from './reviews.ts';
import { lockAgentForStart } from './run-start.ts';
import { loadTaskOrThrow, type TaskRow } from './service.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../projects/service.ts', () => ({ loadProjectOrThrow: vi.fn() }));
vi.mock('./run-start.ts', async (original) => ({
  ...(await original<typeof import('./run-start.ts')>()),
  lockAgentForStart: vi.fn(),
}));
vi.mock('./reviews.ts', () => ({ agentReviewerEligibility: vi.fn() }));
vi.mock('./service.ts', () => ({
  loadTaskOrThrow: vi.fn(),
  assertTaskNotArchived: vi.fn(),
  assertTaskReadable: vi.fn(),
  assertTaskWorkable: vi.fn(),
}));

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task',
    organizationId: 'org',
    projectId: 'project',
    title: 'Review work',
    description: null,
    attachments: null,
    outputs: null,
    number: 1,
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
    externalSystem: null,
    externalId: null,
    externalUrl: null,
    threadId: null,
    discussionThreadId: null,
    sourceDiscussionThreadId: null,
    startDate: null,
    startNotifiedAt: null,
    dueDate: null,
    slaLevel: null,
    slaLevelAt: null,
    statusChangedAt: null,
    totalCostCents: null,
    agentRunCount: 0,
    lastAgentRunAt: null,
    claimedAt: null,
    completedAt: null,
    externalClosedAt: null,
    repeat: null,
    repeatNextTaskId: null,
    repeatContinued: false,
    createdByType: 'user',
    createdBy: 'creator',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

const config: ManagedTaskReviewContext = {
  projectId: 'project',
  taskId: 'task',
  reviewerAgentId: 'reviewer',
  enabled: true,
};
const auth = {
  organizationId: 'org',
  userId: 'editor',
  role: 'editor',
  teamIds: [],
};

function database(
  prior: ManagedTaskReviewContext | null = null,
  history = false,
) {
  const statements: string[] = [];
  const order: string[] = [];
  const tag = (parts: TemplateStringsArray) => {
    const text = parts.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.startsWith('UPDATE app.tasks'))
      order.push(text.includes('review_context = true') ? 'enroll' : 'task');
    if (text.startsWith('SELECT EXISTS'))
      return Promise.resolve([{ present: history }]);
    if (text.includes('FROM app.task_review_contexts'))
      return Promise.resolve(prior === null ? [] : [prior]);
    return Promise.resolve([]);
  };
  vi.mocked(lockAgentForStart).mockImplementation(async () => {
    order.push('agent');
    return null;
  });
  return { tx: tag as unknown as TransactionSql, statements, order };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadTaskOrThrow).mockResolvedValue(task());
  vi.mocked(loadProjectOrThrow).mockResolvedValue({
    id: 'project',
    organizationId: 'org',
    name: 'Review fixture',
    description: null,
    icon: null,
    color: null,
    key: null,
    externalItemId: null,
    taskCounter: 0,
    openTaskCount: 0,
    doneTaskCount: 0,
    projectAgentCount: 1,
    defaultTaskReviewerAgentId: null,
    teamIds: [],
    teamId: null,
    sharedWithTeamIds: [],
    instructions: null,
    createdBy: 'editor',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    pinnedAt: null,
  });
  vi.mocked(agentReviewerEligibility).mockResolvedValue('eligible');
});

describe('explicit pristine managed review context [TASK-R29]', () => {
  it('enrolls only after agent then actual task UPDATE fencing and actual history', async () => {
    const db = database();
    await updateTaskReviewContextConfiguration(db.tx, auth, config, null);
    expect(db.order).toEqual(['agent', 'task', 'enroll']);
    expect(
      db.statements.some((sql) =>
        sql.startsWith('INSERT INTO app.task_review_contexts'),
      ),
    ).toBe(true);
    const query =
      db.statements.find((sql) => sql.startsWith('SELECT EXISTS')) ?? '';
    for (const source of [
      'app.project_agent_runs',
      'app.approvals',
      'app.automation_runs',
      'source_thread_id IS NOT NULL',
      'review_context = true',
      'parent_task_id',
      'app.task_dependencies',
      'app.task_activity',
    ])
      expect(query).toContain(source);
    expect(query).not.toContain('agent_run_count');
  });

  it.each([
    { status: 'in_review' },
    { externalUrl: 'https://example.com/source' },
    { externalSystem: 'github' },
    { externalId: '1' },
    { parentTaskId: 'parent' },
    { repeat: {} },
    { repeatContinued: true },
    { repeatNextTaskId: 'copy' },
    { completedAt: 123 },
    { attachments: [{ fileId: 'source' }] },
    { outputs: [{ fileId: 'output' }] },
    { threadId: 'thread' },
    { sourceDiscussionThreadId: 'source' },
    { assigneeType: 'user', assigneeId: 'person' },
    { assigneeType: 'agent', assigneeId: 'another-agent' },
    { assigneeType: 'agent', assigneeId: null },
  ] satisfies Partial<TaskRow>[])(
    'rejects source or ordinary work at enrollment: %j',
    async (change) => {
      vi.mocked(loadTaskOrThrow).mockResolvedValue(task(change));
      const db = database();
      await expect(
        updateTaskReviewContextConfiguration(db.tx, auth, config, null),
      ).rejects.toMatchObject({ code: 'TASK_REVIEW_INVALID' });
      expect(db.statements.some((sql) => sql.startsWith('INSERT'))).toBe(false);
    },
  );

  it('refuses historical runs even when the stale summary counter says zero', async () => {
    const db = database(null, true);
    await expect(
      updateTaskReviewContextConfiguration(db.tx, auth, config, null),
    ).rejects.toMatchObject({ code: 'TASK_REVIEW_INVALID' });
  });

  it('requires project editor authority before taking admission locks', async () => {
    const db = database();
    await expect(
      updateTaskReviewContextConfiguration(
        db.tx,
        { ...auth, role: 'member' },
        config,
        null,
      ),
    ).rejects.toMatchObject({ code: 'RBAC_FORBIDDEN' });
    expect(db.order).toEqual([]);
  });

  it('refuses stale CAS and reviewer retargeting while disabled', async () => {
    const prior = { ...config, enabled: false };
    const db = database(prior);
    await expect(
      updateTaskReviewContextConfiguration(db.tx, auth, config, null),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    await expect(
      updateTaskReviewContextConfiguration(
        db.tx,
        auth,
        { ...config, reviewerAgentId: 'other' },
        managedConfigurationHash(prior),
      ),
    ).rejects.toMatchObject({ code: 'TASK_REVIEW_INVALID' });
  });

  it('refuses unavailable or unequipped reviewers on enrollment/re-enable', async () => {
    for (const result of [
      'reviewer_unavailable',
      'permission_missing',
    ] as const) {
      vi.mocked(agentReviewerEligibility).mockResolvedValue(result);
      const db = database();
      await expect(
        updateTaskReviewContextConfiguration(db.tx, auth, config, null),
      ).rejects.toMatchObject({ code: 'TASK_REVIEW_FORBIDDEN' });
    }
  });
});
