/**
 * The tasks REST surface (the machine door), pinned at the delegation
 * boundary: which backing function each route calls, with which arguments
 * (the explicit minting-user identity above all), and which status each
 * refusal becomes. The postures that matter most: create is IDEMPOTENT per
 * project (201 create / 200 re-pick, same id), an invisible task or project
 * answers EXACTLY like an absent one (opaque 404), the start lane stamps
 * `api-key:` attribution and tops up the execute bucket, and a comment posts
 * as the key's USER. Full-DB behavior lives in `rest_machine_door.test.ts`.
 */

import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  httpAction: (handler: unknown) => handler,
}));

vi.mock('../lib/rate_limiter/helpers', () => ({
  checkIpRateLimit: vi.fn(),
  checkOrganizationRateLimit: vi.fn(),
  RateLimitExceededError: class RateLimitExceededError extends Error {},
}));

const getSession = vi.fn();
vi.mock('../auth', () => ({
  createAuth: () => ({ api: { getSession } }),
}));

import { checkIpRateLimit } from '../lib/rate_limiter/helpers';
import {
  anonymousRequest,
  argsOf,
  called,
  jsonBody,
  restCtx,
  restRequest,
  testSession,
  TEST_ORG_ID,
  TEST_USER_ID,
  type StubRoutes,
} from '../lib/rest/handler_kit.testkit';
import type { HttpCtx } from '../lib/rest/helpers';
import { createTaskRest, getTaskResource, taskPostActions } from './rest_api';

type Handler = (ctx: HttpCtx, request: Request) => Promise<Response>;

const RESOLVE_ORG =
  'organizations/resolve_user_organization:resolveUserOrganization';
const GET_PROJECT = 'projects/internal_queries:getProjectByIdForOrg';
const PROJECT_ACCESS = 'projects/internal_queries:getProjectAccessForUser';
const UPSERT = 'tasks/internal_mutations:agentUpsertTaskByExternalRef';
const SCHEDULE_START = 'tasks/internal_mutations:scheduleTaskWorkflowStart';
const START_RUN = 'automations/mutations:startTaskWorkflowRun';
const GET_TASK = 'tasks/rest_api:restGetTaskForUser';
const ADD_COMMENT = 'tasks/mutations:addTaskCommentForUser';

function projectRow() {
  return { _id: 'proj_1', name: 'Acme Books', key: 'ACME' };
}

function taskRow() {
  return {
    _id: 'task_1',
    title: 'Prepare VAT return',
    status: 'todo',
    projectId: 'proj_1',
    externalSystem: 'github',
    externalId: 'acme/books#7',
    externalUrl: 'https://github.com/acme/books/issues/7',
    description: 'Q1 filing',
    labels: ['vat'],
    createdAt: 1,
    updatedAt: 2,
  };
}

const canRead = { canRead: true, canEdit: true };
const invisible = { canRead: false, canEdit: false };

const createBody = {
  projectId: 'proj_1',
  externalSystem: 'github',
  externalId: 'acme/books#7',
  title: 'Prepare VAT return',
};

/** Routes for a create whose target project resolves and is visible. */
function creatable(routes: StubRoutes): StubRoutes {
  return {
    [GET_PROJECT]: () => projectRow(),
    [PROJECT_ACCESS]: () => canRead,
    ...routes,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(testSession());
  // `startWorkflowForTask` narrates refused/failed starts on the console;
  // the mapping is asserted on the response, not the log.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('authentication', () => {
  it('refuses a request with no Authorization header (401)', async () => {
    const { ctx } = restCtx();
    const response = await (getTaskResource as unknown as Handler)(
      ctx,
      anonymousRequest('/api/v1/tasks/task_1'),
    );
    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/tasks', () => {
  const request = (json: unknown = createBody) =>
    restRequest('/api/v1/tasks', { method: 'POST', json });

  it('creates via the session upsert (user creator, project dedupe) and answers 201', async () => {
    const { ctx, calls } = restCtx(
      creatable({ [UPSERT]: () => ({ taskId: 'task_new', created: true }) }),
    );
    const response = await (createTaskRest as unknown as Handler)(
      ctx,
      request({
        ...createBody,
        description: 'Q1 filing',
        labels: ['vat'],
        externalUrl: 'https://github.com/acme/books/issues/7',
      }),
    );
    expect(response.status).toBe(201);
    expect(await jsonBody(response)).toEqual({
      task: { id: 'task_new', created: true },
    });
    expect(argsOf(calls, UPSERT)).toEqual({
      organizationId: TEST_ORG_ID,
      actorId: TEST_USER_ID,
      projectId: 'proj_1',
      externalSystem: 'github',
      externalId: 'acme/books#7',
      title: 'Prepare VAT return',
      externalUrl: 'https://github.com/acme/books/issues/7',
      description: 'Q1 filing',
      labels: ['vat'],
      externalState: 'open',
      creatorType: 'user',
      dedupeScope: 'project',
    });
    // Visibility ran for the EXPLICIT minting user, before the write.
    expect(argsOf(calls, PROJECT_ACCESS)).toEqual({
      organizationId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      projectId: 'proj_1',
    });
    // The strict-org posture travels to org resolution.
    expect(argsOf(calls, RESOLVE_ORG)?.requireExplicitOrgSlug).toBe(true);
    expect(called(calls, SCHEDULE_START)).toBe(false);
  });

  it('forwards automationSlug so the automation becomes the owner (no start)', async () => {
    const { ctx, calls } = restCtx(
      creatable({
        [UPSERT]: () => ({ taskId: 'task_new', created: true }),
      }),
    );
    const response = await (createTaskRest as unknown as Handler)(
      ctx,
      request({ ...createBody, automationSlug: 'vat-return-desk' }),
    );
    expect(response.status).toBe(201);
    expect(argsOf(calls, UPSERT)?.automationSlug).toBe('vat-return-desk');
    // Attribution alone never schedules anything.
    expect(called(calls, SCHEDULE_START)).toBe(false);
  });

  it('answers an idempotent re-pick as 200 {created: false} with the SAME id', async () => {
    const { ctx, calls } = restCtx(
      creatable({
        [UPSERT]: () => ({ taskId: 'task_existing', created: false }),
      }),
    );
    const response = await (createTaskRest as unknown as Handler)(
      ctx,
      request({ ...createBody, runWorkflowSlug: 'vat/desk' }),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      task: { id: 'task_existing', created: false },
    });
    // A re-pick never re-kicks the workflow, and never claims an execution.
    expect(called(calls, SCHEDULE_START)).toBe(false);
  });

  it('schedules the workflow on a CREATED task with api-key attribution (executionId: null)', async () => {
    const { ctx, calls } = restCtx(
      creatable({
        [UPSERT]: () => ({ taskId: 'task_new', created: true }),
        [SCHEDULE_START]: () => null,
      }),
    );
    const response = await (createTaskRest as unknown as Handler)(
      ctx,
      request({ ...createBody, runWorkflowSlug: 'vat/desk' }),
    );
    expect(response.status).toBe(201);
    expect(await jsonBody(response)).toEqual({
      task: { id: 'task_new', created: true },
      executionId: null,
    });
    expect(argsOf(calls, SCHEDULE_START)).toEqual({
      organizationId: TEST_ORG_ID,
      taskId: 'task_new',
      workflowSlug: 'vat/desk',
      userId: TEST_USER_ID,
      startedVia: 'api-key',
    });
  });

  it.each(['projectId', 'externalSystem', 'externalId', 'title'])(
    'refuses a body without %s (400) before any backing call',
    async (field) => {
      const { ctx, calls } = restCtx(
        creatable({ [UPSERT]: () => ({ taskId: 'x', created: true }) }),
      );
      const body: Record<string, unknown> = { ...createBody };
      delete body[field];
      const response = await (createTaskRest as unknown as Handler)(
        ctx,
        request(body),
      );
      expect(response.status).toBe(400);
      expect(called(calls, GET_PROJECT)).toBe(false);
      expect(called(calls, UPSERT)).toBe(false);
    },
  );

  it('answers the SAME opaque 404 for a cross-org project and an invisible one', async () => {
    const { ctx: foreign, calls: foreignCalls } = restCtx(
      creatable({
        [GET_PROJECT]: () => null,
        [UPSERT]: () => ({ taskId: 'x', created: true }),
      }),
    );
    const foreignResponse = await (createTaskRest as unknown as Handler)(
      foreign,
      request(),
    );

    const { ctx: hidden, calls: hiddenCalls } = restCtx(
      creatable({
        [PROJECT_ACCESS]: () => invisible,
        [UPSERT]: () => ({ taskId: 'x', created: true }),
      }),
    );
    const hiddenResponse = await (createTaskRest as unknown as Handler)(
      hidden,
      request(),
    );

    for (const response of [foreignResponse, hiddenResponse]) {
      expect(response.status).toBe(404);
      expect(await jsonBody(response)).toEqual({ error: 'Project not found' });
    }
    expect(called(foreignCalls, UPSERT)).toBe(false);
    expect(called(hiddenCalls, UPSERT)).toBe(false);
  });

  it('maps label validation from the shared upsert to 400', async () => {
    const { ctx } = restCtx(
      creatable({
        [UPSERT]: () => {
          throw new ConvexError({
            code: 'TASK_LABELS_INVALID',
            message: 'A label name is blank or too long',
          });
        },
      }),
    );
    const response = await (createTaskRest as unknown as Handler)(
      ctx,
      request({ ...createBody, labels: [''] }),
    );
    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toEqual({
      error: 'A label name is blank or too long',
    });
  });

  it('strict-org: a multi-org key without X-Organization-Slug is refused (400)', async () => {
    const { ctx } = restCtx({
      [RESOLVE_ORG]: () => {
        // The coded refusal the real resolver throws (uncoded failures are
        // 500 server faults since the org-catch hardening).
        throw new ConvexError({
          code: 'ORG_SLUG_REQUIRED',
          message:
            'User belongs to multiple organizations. Provide X-Organization-Slug header.',
        });
      },
    });
    const response = await (createTaskRest as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toEqual({
      error:
        'User belongs to multiple organizations. Provide X-Organization-Slug header.',
    });
  });
});

describe('GET /api/v1/tasks/:id', () => {
  it('answers the task projection for a worker poll', async () => {
    const { ctx, calls } = restCtx({ [GET_TASK]: () => taskRow() });
    const response = await (getTaskResource as unknown as Handler)(
      ctx,
      restRequest('/api/v1/tasks/task_1'),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      task: {
        id: 'task_1',
        title: 'Prepare VAT return',
        status: 'todo',
        projectId: 'proj_1',
        externalSystem: 'github',
        externalId: 'acme/books#7',
        externalUrl: 'https://github.com/acme/books/issues/7',
        description: 'Q1 filing',
        labels: ['vat'],
        createdAt: 1,
        updatedAt: 2,
      },
    });
    expect(argsOf(calls, GET_TASK)).toEqual({
      organizationId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      taskId: 'task_1',
    });
  });

  it('answers the opaque 404 when the id does not resolve for this user', async () => {
    const { ctx } = restCtx({ [GET_TASK]: () => null });
    const response = await (getTaskResource as unknown as Handler)(
      ctx,
      restRequest('/api/v1/tasks/task_of_org_b'),
    );
    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: 'Task not found' });
  });

  it('rejects an unknown sub-resource with 404', async () => {
    const { ctx, calls } = restCtx({ [GET_TASK]: () => taskRow() });
    const response = await (getTaskResource as unknown as Handler)(
      ctx,
      restRequest('/api/v1/tasks/task_1/activity'),
    );
    expect(response.status).toBe(404);
    expect(called(calls, GET_TASK)).toBe(false);
  });
});

describe('POST /api/v1/tasks/:id/start', () => {
  const request = (json: unknown = { workflowSlug: 'vat/desk' }) =>
    restRequest('/api/v1/tasks/task_1/start', { method: 'POST', json });

  it('starts through the session seam with api-key attribution and the task subject', async () => {
    const { ctx, calls } = restCtx({
      [GET_TASK]: () => taskRow(),
      [START_RUN]: () => ({ runId: 'run_1' }),
    });
    const response = await (taskPostActions as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      started: true,
      executionId: 'run_1',
    });
    expect(argsOf(calls, START_RUN)).toEqual({
      organizationId: TEST_ORG_ID,
      name: 'vat/desk',
      taskId: 'task_1',
      projectId: 'proj_1',
      // Machine starts must never be indistinguishable from human UI starts.
      startedBy: `api-key:${TEST_USER_ID}`,
      input: {
        task: {
          id: 'task_1',
          title: 'Prepare VAT return',
          status: 'todo',
          projectId: 'proj_1',
          externalSystem: 'github',
          externalId: 'acme/books#7',
          externalUrl: 'https://github.com/acme/books/issues/7',
          issueNumber: 7,
          repo: 'acme/books',
        },
      },
    });
  });

  it('answers already_running with the in-flight executionId (started: false)', async () => {
    const { ctx } = restCtx({
      [GET_TASK]: () => taskRow(),
      [START_RUN]: () => ({ runId: 'run_live', alreadyRunning: true }),
    });
    const response = await (taskPostActions as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      started: false,
      reason: 'already_running',
      executionId: 'run_live',
    });
  });

  it('answers not_started when no deployed automation carries the slug', async () => {
    const { ctx } = restCtx({
      [GET_TASK]: () => taskRow(),
      [START_RUN]: () => null,
    });
    const response = await (taskPostActions as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      started: false,
      reason: 'not_started',
      executionId: null,
    });
  });

  it('answers the opaque 404 for an invisible task BEFORE touching the run seam', async () => {
    const { ctx, calls } = restCtx({
      [GET_TASK]: () => null,
      [START_RUN]: () => ({ runId: 'run_1' }),
    });
    const response = await (taskPostActions as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: 'Task not found' });
    expect(called(calls, START_RUN)).toBe(false);
  });

  it('refuses a body without workflowSlug (400)', async () => {
    const { ctx, calls } = restCtx({ [GET_TASK]: () => taskRow() });
    const response = await (taskPostActions as unknown as Handler)(
      ctx,
      request({}),
    );
    expect(response.status).toBe(400);
    expect(called(calls, GET_TASK)).toBe(false);
  });

  it('charges the start sub-path against BOTH the CRUD bucket and the execute lane', async () => {
    const { ctx } = restCtx({
      [GET_TASK]: () => taskRow(),
      [START_RUN]: () => ({ runId: 'run_1' }),
    });
    await (taskPostActions as unknown as Handler)(ctx, request());
    const buckets = vi
      .mocked(checkIpRateLimit)
      .mock.calls.map((call) => call[1]);
    expect(buckets).toContain('rest:api');
    expect(buckets).toContain('rest:execute');
  });
});

describe('POST /api/v1/tasks/:id/comments', () => {
  const request = (json: unknown = { body: 'Ledgers uploaded, ready.' }) =>
    restRequest('/api/v1/tasks/task_1/comments', { method: 'POST', json });

  it('posts as the key’s USER through the shared session core (201)', async () => {
    const { ctx, calls } = restCtx({
      [ADD_COMMENT]: () => ({ messageId: 'msg_1', threadId: 'thread_1' }),
    });
    const response = await (taskPostActions as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(201);
    expect(await jsonBody(response)).toEqual({ comment: { id: 'msg_1' } });
    expect(argsOf(calls, ADD_COMMENT)).toEqual({
      organizationId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      userEmail: 'key@tale.test',
      taskId: 'task_1',
      body: 'Ledgers uploaded, ready.',
    });
  });

  it('answers the opaque 404 the backing mutation raises for invisible tasks', async () => {
    const { ctx } = restCtx({
      [ADD_COMMENT]: () => {
        throw new ConvexError({
          code: 'TASK_NOT_FOUND',
          message: 'Task not found',
        });
      },
    });
    const response = await (taskPostActions as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: 'Task not found' });
  });

  it('maps the per-user comment budget to 429 with Retry-After', async () => {
    const { ctx } = restCtx({
      [ADD_COMMENT]: () => {
        throw new ConvexError({
          code: 'RATE_LIMITED',
          data: { retryAfterMs: 1500 },
        });
      },
    });
    const response = await (taskPostActions as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('2');
  });

  it('refuses a body without the comment text (400)', async () => {
    const { ctx, calls } = restCtx({
      [ADD_COMMENT]: () => ({ messageId: 'msg_1', threadId: 'thread_1' }),
    });
    const response = await (taskPostActions as unknown as Handler)(
      ctx,
      request({}),
    );
    expect(response.status).toBe(400);
    expect(called(calls, ADD_COMMENT)).toBe(false);
  });

  it('rejects an unknown POST sub-resource with 404', async () => {
    const { ctx } = restCtx({});
    const response = await (taskPostActions as unknown as Handler)(
      ctx,
      restRequest('/api/v1/tasks/task_1/archive', { method: 'POST' }),
    );
    expect(response.status).toBe(404);
  });
});

describe('GET /api/v1/tasks/:id/comments (result lane)', () => {
  const LIST_COMMENTS =
    'tasks/internal_queries:listTaskDiscussionMessagesInternal';
  const request = () => restRequest('/api/v1/tasks/task_1/comments');

  it('answers the discussion chronologically with author types', async () => {
    const { ctx, calls } = restCtx({
      [GET_TASK]: () => ({ _id: 'task_1', title: 'VAT Q1' }),
      [LIST_COMMENTS]: () => [
        {
          messageId: 'msg_1',
          authorType: 'agent',
          authorId: 'workflow',
          body: 'Return prepared — key figures…',
          createdAt: 100,
        },
        {
          messageId: 'msg_2',
          authorType: 'user',
          authorId: 'u_key_user',
          body: 'Looks right, thanks.',
          createdAt: 200,
          editedAt: 250,
        },
      ],
    });
    const response = await (getTaskResource as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      comments: [
        {
          id: 'msg_1',
          authorType: 'agent',
          authorId: 'workflow',
          body: 'Return prepared — key figures…',
          createdAt: 100,
        },
        {
          id: 'msg_2',
          authorType: 'user',
          authorId: 'u_key_user',
          body: 'Looks right, thanks.',
          createdAt: 200,
          editedAt: 250,
        },
      ],
    });
    expect(argsOf(calls, LIST_COMMENTS)).toEqual({
      organizationId: TEST_ORG_ID,
      taskId: 'task_1',
    });
  });

  it('collapses an invisible task into the opaque 404 and never reads the thread', async () => {
    const { ctx, calls } = restCtx({
      [GET_TASK]: () => null,
      [LIST_COMMENTS]: () => [],
    });
    const response = await (getTaskResource as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: 'Task not found' });
    expect(called(calls, LIST_COMMENTS)).toBe(false);
  });
});
