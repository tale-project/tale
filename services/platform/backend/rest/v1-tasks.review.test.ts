import { Hono } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RestEnv } from './shared.ts';
import { createTaskRestRoutes } from './v1-tasks.ts';

const service = vi.hoisted(() => ({
  startWorkflowForTaskInTx: vi.fn(),
  addTaskComment: vi.fn(),
  updateTaskStatus: vi.fn(),
  getPendingReviewForTask: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock('../domains/tasks/external-ref.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/tasks/external-ref.ts')
  >()),
  startWorkflowForTaskInTx: service.startWorkflowForTaskInTx,
}));
vi.mock('../domains/tasks/comments.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/tasks/comments.ts')>()),
  addTaskComment: service.addTaskComment,
}));
vi.mock('../domains/tasks/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/tasks/service.ts')>()),
  updateTaskStatus: service.updateTaskStatus,
}));
vi.mock('../domains/tasks/reviews.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/tasks/reviews.ts')>()),
  getPendingReviewForTask: service.getPendingReviewForTask,
}));
vi.mock('../domains/audit_logs/service.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/audit_logs/service.ts')
  >()),
  createAuditLog: service.createAuditLog,
}));

interface Captured {
  text: string;
  values: unknown[];
  inTransaction: boolean;
}

const project = {
  id: 'p-1',
  organizationId: 'org-1',
  name: 'Ledger',
  teamId: 'team-1',
  sharedWithTeamIds: [],
  archivedAt: null,
};
const task = {
  id: 't-1',
  organizationId: 'org-1',
  projectId: 'p-1',
  title: 'VAT return 2026Q1',
  status: 'in_review',
  labelIds: [],
  externalSystem: 'vatplus',
  externalId: 'q-1',
  externalUrl: null,
  createdAt: 1,
  updatedAt: 2,
  archivedAt: null,
};
const review = {
  approvalId: 'appr-1',
  taskId: 't-1',
  round: 2,
  requestedFor: null,
  reviewer: null,
  agentSlug: null,
  runId: 'run-0',
  implementationAgentId: null,
  evidenceRevision: null,
  createdAt: 5,
};
const member = {
  id: 'user-9',
  email: 'reginald@example.com',
  emailVerified: true,
  role: 'editor',
};
const path = '/projects/p-1/tasks/t-1/review';

function mount(
  options: {
    role?: string;
    taskStatus?: string;
    members?: object[];
    granted?: boolean;
    actorTeamIds?: string[];
    deployed?: boolean;
    /** Who created the task — nobody's own (an import's) by default. */
    taskCreatedBy?: string;
    /** The API key the call came with; none by default. */
    apiKeyId?: string;
  } = {},
) {
  const queries: Captured[] = [];
  const execute = (
    inTransaction: boolean,
    strings: TemplateStringsArray,
    values: unknown[],
  ) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values, inTransaction });
    if (text.includes('FROM "teamMember"')) {
      // The key holder sits on team-1; the actor's teams are the option's
      // (`getUserTeamIds` binds the user first, then the organization).
      const userId = values[0];
      return Promise.resolve(
        (userId === 'user-9'
          ? (options.actorTeamIds ?? ['team-1'])
          : ['team-1']
        ).map((teamId) => ({ teamId })),
      );
    }
    if (text.includes('FROM app.tasks WHERE id')) {
      return Promise.resolve([
        {
          ...task,
          status: options.taskStatus ?? 'in_review',
          ...(options.taskCreatedBy !== undefined
            ? { createdBy: options.taskCreatedBy, createdByType: 'user' }
            : {}),
        },
      ]);
    }
    if (text.includes('FROM app.projects WHERE id')) {
      return Promise.resolve([project]);
    }
    if (text.includes('FROM "user" u JOIN "member" m')) {
      return Promise.resolve(options.members ?? [member]);
    }
    if (text.includes('FROM app.competence_records')) {
      return Promise.resolve(
        options.granted ? [{ expiresAt: null, revokedAt: null }] : [],
      );
    }
    if (text.includes('FROM app.automations WHERE')) {
      return Promise.resolve([{ present: 1 }]);
    }
    if (text.includes('FROM app.automation_deployments')) {
      return Promise.resolve(
        options.deployed === false ? [] : [{ version: 1 }],
      );
    }
    if (text.includes('FROM app.automation_project_bindings')) {
      return Promise.resolve([{ projectId: 'p-1' }]);
    }
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve([{ value: '1' }]);
    }
    if (text.includes('FROM app.rate_limits')) {
      return Promise.resolve([{ value: '0', ts: String(Date.now()) }]);
    }
    return Promise.resolve([]);
  };
  const unsafe = (text: string) => ({ unsafe: text });
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) =>
    execute(false, strings, values);
  const tx = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) =>
      execute(true, strings, values),
    { unsafe },
  ) as unknown as TransactionSql;
  const begin = vi.fn(
    (
      first: string | ((tx: TransactionSql) => Promise<unknown>),
      callback?: (tx: TransactionSql) => Promise<unknown>,
    ) => (typeof first === 'function' ? first(tx) : callback?.(tx)),
  );
  const sql = Object.assign(tag, { unsafe, begin }) as unknown as Sql;
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'worker@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', options.role ?? 'admin');
    c.set('orgExplicit', true);
    c.set('clientIp', '203.0.113.9');
    if (options.apiKeyId !== undefined) c.set('apiKeyId', options.apiKeyId);
    return next();
  });
  app.route('/', createTaskRestRoutes({ sql }));
  const request = (method = 'GET', body?: unknown) =>
    app.request(`http://localhost${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: typeof body === 'string' ? body : JSON.stringify(body),
          }),
    });
  return { request, queries, tx };
}

const actor = { email: 'reginald@example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  service.getPendingReviewForTask.mockResolvedValue(review);
  service.updateTaskStatus.mockResolvedValue(undefined);
  service.addTaskComment.mockResolvedValue({ messageId: 'comment-1' });
  service.startWorkflowForTaskInTx.mockResolvedValue({
    runId: 'run-1',
    alreadyRunning: false,
  });
  service.createAuditLog.mockResolvedValue('audit-1');
});

describe('GET /projects/{id}/tasks/{taskId}/review', () => {
  it('answers the task’s status and its pending review to a member', async () => {
    const { request } = mount({ role: 'member' });
    const res = await request();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      task: { id: 't-1', status: 'in_review' },
      review,
    });
  });

  it('answers review: null when nothing is pending', async () => {
    service.getPendingReviewForTask.mockResolvedValue(null);
    const { request } = mount({ taskStatus: 'done' });
    expect(await (await request()).json()).toEqual({
      task: { id: 't-1', status: 'done' },
      review: null,
    });
  });

  it('preserves typed agent ownership and exact source evidence on the read door', async () => {
    const agentReview = {
      ...review,
      reviewer: { kind: 'agent', agentId: 'reviewer-b' },
      implementationAgentId: 'implementation-a',
      evidenceRevision: 'a'.repeat(64),
    };
    service.getPendingReviewForTask.mockResolvedValue(agentReview);
    const { request } = mount();
    expect(await (await request()).json()).toEqual({
      task: { id: 't-1', status: 'in_review' },
      review: agentReview,
    });
    expect(service.updateTaskStatus).not.toHaveBeenCalled();
  });
});

describe('POST /projects/{id}/tasks/{taskId}/review', () => {
  it('approves as the actor: the move to Done in a transaction, audited as a relay', async () => {
    const { request, tx, queries } = mount();
    const res = await request('POST', { decision: 'approve', actor });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      task: { id: 't-1', status: 'done' },
      decision: 'approve',
      approvalId: 'appr-1',
      actorUserId: 'user-9',
    });
    expect(service.updateTaskStatus).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: 'user-9',
        email: 'reginald@example.com',
        role: 'editor',
      }),
      't-1',
      'done',
    );
    expect(service.addTaskComment).not.toHaveBeenCalled();
    expect(service.startWorkflowForTaskInTx).not.toHaveBeenCalled();
    expect(service.createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'task.review_relayed',
        actorId: 'user-9',
        newState: { decision: 'approve', status: 'done' },
        metadata: expect.objectContaining({
          via: 'api-key',
          keyHolderUserId: 'user-1',
          approvalId: 'appr-1',
        }),
      }),
    );
    expect(
      queries.find((q) => q.text.includes('INSERT INTO app.rate_limits'))
        ?.values,
    ).toContain('rest:execute');
    // The task is re-read inside the transaction with the ACTOR's access.
    expect(
      queries.some(
        (q) => q.inTransaction && q.text.includes('FROM app.tasks WHERE id'),
      ),
    ).toBe(true);
  });

  it('requests changes as the actor: comment, withdraw the review, start the workflow again', async () => {
    const { request, tx } = mount();
    const res = await request('POST', {
      decision: 'request_changes',
      comment: 'Box 302 is too high — the January credit note is missing.',
      workflowSlug: 'vat-return-desk',
      actor,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      task: { id: 't-1', status: 'in_progress' },
      decision: 'request_changes',
      approvalId: 'appr-1',
      actorUserId: 'user-9',
      started: true,
      runId: 'run-1',
      executionId: 'run-1',
    });
    expect(service.addTaskComment).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ userId: 'user-9' }),
      {
        taskId: 't-1',
        body: 'Box 302 is too high — the January credit note is missing.',
      },
    );
    expect(service.updateTaskStatus).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ userId: 'user-9' }),
      't-1',
      'in_progress',
    );
    expect(service.startWorkflowForTaskInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        workflowSlug: 'vat-return-desk',
        startedByUserId: 'user-9',
        startedVia: 'api-key',
        task: expect.objectContaining({ id: 't-1', status: 'in_progress' }),
      }),
    );
  });

  it('decides with the person’s access and the key’s spend: what the decision starts books to the key [SBX-R14]', async () => {
    const { request, tx } = mount({ apiKeyId: 'key-1' });
    const res = await request('POST', {
      decision: 'request_changes',
      comment: 'Box 302 is too high — the January credit note is missing.',
      workflowSlug: 'vat-return-desk',
      actor,
    });
    expect(res.status).toBe(200);
    const relayed = expect.objectContaining({
      userId: 'user-9',
      apiKeyId: 'key-1',
    });
    expect(service.addTaskComment).toHaveBeenCalledWith(
      tx,
      relayed,
      expect.anything(),
    );
    expect(service.updateTaskStatus).toHaveBeenCalledWith(
      tx,
      relayed,
      't-1',
      'in_progress',
    );
    expect(service.startWorkflowForTaskInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ startedByUserId: 'user-9', apiKeyId: 'key-1' }),
    );
  });

  it('reports a live run it reused on request_changes', async () => {
    service.startWorkflowForTaskInTx.mockResolvedValue({
      runId: 'run-live',
      alreadyRunning: true,
    });
    const { request } = mount();
    const res = await request('POST', {
      decision: 'request_changes',
      comment: 'Again.',
      workflowSlug: 'vat-return-desk',
      actor,
    });
    expect(await res.json()).toMatchObject({
      started: false,
      runId: 'run-live',
    });
  });

  it('requires the actor, and comment + workflowSlug for request_changes, by field', async () => {
    const { request } = mount();
    const noActor = await request('POST', { decision: 'approve' });
    expect(noActor.status).toBe(400);
    expect(await noActor.json()).toMatchObject({
      code: 'INVALID_BODY',
      data: { issues: [expect.objectContaining({ path: 'actor' })] },
    });
    const bare = await request('POST', { decision: 'request_changes', actor });
    expect(bare.status).toBe(400);
    const issues = (
      (await bare.json()) as { data: { issues: { path: string }[] } }
    ).data.issues.map((issue) => issue.path);
    expect(issues).toEqual(expect.arrayContaining(['comment', 'workflowSlug']));
    expect(service.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('refuses a task that is not in review with 409 TASK_NOT_IN_REVIEW, deciding nothing', async () => {
    const { request } = mount({ taskStatus: 'in_progress' });
    const res = await request('POST', { decision: 'approve', actor });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'TASK_NOT_IN_REVIEW' });
    expect(service.updateTaskStatus).not.toHaveBeenCalled();
    expect(service.createAuditLog).not.toHaveBeenCalled();
  });

  it('refuses a key holder without the act-as right before the member lookup', async () => {
    const { request, queries } = mount({ role: 'editor', granted: false });
    const res = await request('POST', { decision: 'approve', actor });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ROLE_FORBIDDEN' });
    expect(queries.some((q) => q.text.includes('FROM "user" u'))).toBe(false);
    const granted = mount({ role: 'editor', granted: true });
    expect(
      (await granted.request('POST', { decision: 'approve', actor })).status,
    ).toBe(200);
  });

  it('decides with the PERSON’s access: an actor outside the project’s team is refused, and named', async () => {
    // The key holder (an admin) reaches the task — the project's existence
    // is theirs to know already — so a refusal of the member they relay for
    // speaks of that member: 403 ACTOR_FORBIDDEN, never a 404 the worker
    // would read as a vanished project.
    const { request } = mount({ actorTeamIds: ['team-other'] });
    const res = await request('POST', { decision: 'approve', actor });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ACTOR_FORBIDDEN' });
    expect(service.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('decides for a member on the task they created, and names a member on anyone else’s', async () => {
    // The work gate the board applies: a member decides the review of their
    // own task, and a relayed decision on someone else's is the member's
    // refusal, not the key's.
    const reader = { ...member, role: 'member' };
    const own = mount({ members: [reader], taskCreatedBy: 'user-9' });
    const decided = await own.request('POST', { decision: 'approve', actor });
    expect(decided.status).toBe(200);
    expect(service.updateTaskStatus).toHaveBeenCalledWith(
      own.tx,
      expect.objectContaining({ userId: 'user-9', role: 'member' }),
      't-1',
      'done',
    );

    service.updateTaskStatus.mockClear();
    const others = mount({ members: [reader], taskCreatedBy: 'user-2' });
    const refused = await others.request('POST', {
      decision: 'approve',
      actor,
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'ACTOR_FORBIDDEN' });
    expect(service.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('lets the review policy’s refusal through with its code', async () => {
    const { TaskReviewError } = await vi.importActual<
      typeof import('../domains/tasks/reviews.ts')
    >('../domains/tasks/reviews.ts');
    service.updateTaskStatus.mockRejectedValue(
      new TaskReviewError(
        'REVIEW_INDEPENDENT_REVIEWER_REQUIRED',
        'This organization requires an independent reviewer.',
        403,
      ),
    );
    const { request } = mount();
    const res = await request('POST', { decision: 'approve', actor });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: 'REVIEW_INDEPENDENT_REVIEWER_REQUIRED',
    });
    expect(service.createAuditLog).not.toHaveBeenCalled();
  });

  it('returns a registered 409 for agent-owned approval even with strict error-code validation', async () => {
    const { TaskReviewError } = await vi.importActual<
      typeof import('../domains/tasks/reviews.ts')
    >('../domains/tasks/reviews.ts');
    service.updateTaskStatus.mockRejectedValue(
      new TaskReviewError(
        'TASK_AGENT_REVIEW_REQUIRED',
        'This review belongs to an agent; explicitly transfer it before a human approval',
        409,
      ),
    );
    vi.stubEnv('TALE_STRICT_ERROR_CODES', '1');
    try {
      const { request } = mount();
      const response = await request('POST', { decision: 'approve', actor });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: 'TASK_AGENT_REVIEW_REQUIRED',
      });
      expect(service.createAuditLog).not.toHaveBeenCalled();
      expect(service.addTaskComment).not.toHaveBeenCalled();
      expect(service.startWorkflowForTaskInTx).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses an undeployed workflow on request_changes before charging or deciding', async () => {
    const { request, queries } = mount({ deployed: false });
    const res = await request('POST', {
      decision: 'request_changes',
      comment: 'Again.',
      workflowSlug: 'vat-return-desk',
      actor,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error:
        'The automation has no deployed version — deploy it before requesting changes through it.',
      code: 'AUTOMATION_NOT_DEPLOYED',
    });
    expect(
      queries.some((q) => q.text.includes('INSERT INTO app.rate_limits')),
    ).toBe(false);
    expect(service.updateTaskStatus).not.toHaveBeenCalled();
  });
});
