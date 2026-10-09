/**
 * The wrappers against a loopback server: each must hit the platform's
 * path with the organization as `?orgId=`, send the body the route parses,
 * record under its ROUTE TEMPLATE (never a concrete id) and read back the
 * fields the next step needs.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  createApiKey,
  getSession,
  listApiKeys,
  recordOrganizationSwitch,
  signInEmail,
} from '../../src/api/auth.ts';
import {
  cancelTurn,
  createThread,
  listMessages,
  listThreads,
  reportPerceivedWait,
  sendMessage,
  trashThread,
} from '../../src/api/chat.ts';
import { ApiClient } from '../../src/api/client.ts';
import {
  createDocumentFromUpload,
  presignUpload,
  putPresigned,
  searchKnowledge,
} from '../../src/api/knowledge.ts';
import {
  restHeaders,
  restPollGeneration,
  restSendMessage,
  restUpsertTask,
} from '../../src/api/rest.ts';
import { composerModels, memberContext } from '../../src/api/shell.ts';
import {
  OPEN_TASK_STATUSES,
  boardQuery,
  createTask,
  listTasksAcrossProjects,
  moveTask,
} from '../../src/api/tasks.ts';
import {
  createContact,
  listMyNotifications,
  listProjects,
} from '../../src/api/workspace.ts';
import {
  HttpClient,
  UserSession,
  createAgent,
} from '../../src/client/index.ts';
import { MetricsRegistry } from '../../src/metrics/index.ts';
import { startServer, type TestServer } from '../client/test-server.ts';

const agent = createAgent({ keepAliveTimeoutMs: 1_000 });
let server: TestServer;
/** Canned answers by `METHOD path` (query stripped). */
const answers = new Map<string, { status?: number; body: unknown }>();

beforeAll(async () => {
  server = await startServer((request, response) => {
    const path = request.url.split('?')[0] ?? '';
    const answer = answers.get(`${request.method} ${path}`) ?? {
      body: { ok: true },
    };
    response.statusCode = answer.status ?? 200;
    response.setHeader('content-type', 'application/json');
    if (path === '/api/auth/sign-in/email') {
      response.setHeader(
        'set-cookie',
        'better-auth.session_token=tok.sig; Path=/; HttpOnly',
      );
    }
    response.end(JSON.stringify(answer.body));
  });
});

afterAll(async () => {
  await server.close();
  await agent.close();
});

function client(): {
  api: ApiClient;
  metrics: MetricsRegistry;
  session: UserSession;
} {
  const metrics = new MetricsRegistry();
  const session = new UserSession({
    baseUrl: server.url,
    agent,
    metrics,
    email: 'u@example.test',
    password: 'not-a-real-password',
    forwardedFor: '198.18.0.7',
  });
  return { api: new ApiClient({ requester: session }), metrics, session };
}

function lastRequest(): {
  method: string;
  path: string;
  query: URLSearchParams;
  json: unknown;
  headers: Record<string, string | string[] | undefined>;
} {
  const seen = server.requests.at(-1);
  if (seen === undefined) throw new Error('no request seen');
  const url = new URL(seen.url, server.url);
  return {
    method: seen.method,
    path: url.pathname,
    query: url.searchParams,
    json:
      seen.headers['content-type'] === 'application/json'
        ? JSON.parse(seen.body)
        : undefined,
    headers: seen.headers,
  };
}

function metricNames(metrics: MetricsRegistry): string[] {
  return Object.keys(metrics.snapshot().timings);
}

describe('auth', () => {
  test('sign-in sends Origin and the session cookie lands in the jar', async () => {
    const { api, session } = client();
    answers.set('POST /api/auth/sign-in/email', {
      body: { user: { id: 'u1' } },
    });
    const result = await signInEmail(api, session.email, session.password);
    expect(result.body?.userId).toBe('u1');
    expect(session.signedIn).toBe(true);
    const seen = lastRequest();
    expect(seen.headers.origin).toBe(server.url);
    expect(seen.headers['x-forwarded-for']).toBe('198.18.0.7');
    expect(seen.json).toMatchObject({ email: 'u@example.test' });
  });

  test('get-session reads the active organization; null is no session', async () => {
    const { api } = client();
    answers.set('GET /api/auth/get-session', {
      body: { user: { id: 'u1' }, session: { activeOrganizationId: 'o1' } },
    });
    const view = await getSession(api);
    expect(view.body).toEqual({ userId: 'u1', activeOrganizationId: 'o1' });
    answers.set('GET /api/auth/get-session', { body: null });
    const none = await getSession(api);
    expect(none.ok).toBe(true);
    expect(none.body).toBeUndefined();
  });

  test('record-switch names the route template, not the id', async () => {
    const { api, metrics } = client();
    await recordOrganizationSwitch(api, 'org/1');
    expect(lastRequest().path).toBe(
      '/api/app/organizations/org%2F1/record-switch',
    );
    expect(metricNames(metrics)).toEqual([
      'POST /api/app/organizations/:id/record-switch',
    ]);
  });

  test('API keys: create reads id and key; a 403 gate is a refusal', async () => {
    const { api, metrics } = client();
    answers.set('POST /api/auth/api-key/create', {
      body: { id: 'k1', key: 'secret-key' },
    });
    const created = await createApiKey(api, 'load key');
    expect(created.body).toEqual({ id: 'k1', key: 'secret-key' });
    answers.set('POST /api/auth/api-key/create', {
      status: 403,
      body: { code: 'API_KEY_CREATE_FORBIDDEN' },
    });
    const refused = await createApiKey(api, 'load key');
    expect(refused.code).toBe('API_KEY_CREATE_FORBIDDEN');
    expect(metrics.snapshot().errors).toEqual({});
    answers.set('GET /api/auth/api-key/list', {
      body: { apiKeys: [{ id: 'k1', name: 'load key' }, { nope: 1 }] },
    });
    const listed = await listApiKeys(api);
    expect(listed.body).toEqual([{ id: 'k1', name: 'load key' }]);
  });
});

describe('dashboard shell', () => {
  test('members/me is org-scoped and reports the membership status', async () => {
    const { api } = client();
    answers.set('GET /api/app/members/me', {
      body: { status: 'ok', role: 'editor' },
    });
    const context = await memberContext(api, 'o1');
    expect(context.body).toEqual({ status: 'ok', role: 'editor' });
    expect(lastRequest().query.get('orgId')).toBe('o1');
  });

  test('composer models keep the provider slug and the reasoning knob', async () => {
    const { api } = client();
    answers.set('GET /api/app/chat/composer/models', {
      body: {
        models: [
          { id: 'm1', providerSlug: 'loadmock', reasoning: { levels: [] } },
          { id: 'm2', providerSlug: 'loadmock' },
          { id: 'orphan' },
        ],
      },
    });
    const models = await composerModels(api, 'o1');
    expect(models.body).toEqual([
      { id: 'm1', providerSlug: 'loadmock', reasoning: true },
      { id: 'm2', providerSlug: 'loadmock', reasoning: false },
    ]);
  });

  test('the projects list asks for the summary the SPA asks for', async () => {
    const { api } = client();
    await listProjects(api, 'o1');
    const seen = lastRequest();
    expect(seen.query.get('includeArchived')).toBe('false');
    expect(seen.query.get('summary')).toBe('true');
    expect(seen.query.get('orgId')).toBe('o1');
  });
});

describe('chat', () => {
  test('create, list, send, cancel and trash use the chat routes', async () => {
    const { api, metrics } = client();
    answers.set('POST /api/app/chat/threads', {
      status: 201,
      body: { id: 't1' },
    });
    const created = await createThread(api, 'o1', { reasoningEffort: 'low' });
    expect(created.body).toBe('t1');
    expect(lastRequest().json).toEqual({ reasoningEffort: 'low' });

    answers.set('GET /api/app/chat/threads', {
      body: {
        threads: [{ id: 't1', title: 'A', pinnedAt: 5, generating: true }],
      },
    });
    const listed = await listThreads(api, 'o1');
    expect(listed.body?.[0]).toMatchObject({
      id: 't1',
      pinned: true,
      generating: true,
    });

    answers.set('POST /api/app/chat/threads/t1/messages', {
      status: 409,
      body: { status: 'refused', reason: 'busy', persisted: false },
    });
    const busy = await sendMessage(
      api,
      'o1',
      't1',
      { text: 'hi', modelId: 'm1', providerSlug: 'loadmock' },
      5_000,
    );
    expect(busy.status).toBe(409);
    expect(busy.body?.status).toBe('refused');
    expect(lastRequest().json).toEqual({
      text: 'hi',
      modelId: 'm1',
      providerSlug: 'loadmock',
    });

    answers.set('POST /api/app/chat/threads/t1/cancel', {
      body: { cancelled: true },
    });
    expect((await cancelTurn(api, 'o1', 't1')).body).toBe(true);
    answers.set('POST /api/app/chat/threads/t1/trash', { body: { ok: false } });
    expect((await trashThread(api, 'o1', 't1')).body).toBe(false);

    await reportPerceivedWait(api, 'o1', 'msg1', 0.2);
    expect(lastRequest().json).toEqual({ perceivedWaitMs: 1 });

    answers.set('GET /api/app/chat/threads/t1/messages', {
      body: {
        messages: [
          { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] },
        ],
      },
    });
    const transcript = await listMessages(api, 'o1', 't1');
    expect(transcript.body).toEqual([
      { id: 'a', role: 'assistant', text: 'Hi', status: undefined },
    ]);

    expect(metricNames(metrics).sort()).toEqual([
      'GET /api/app/chat/threads',
      'GET /api/app/chat/threads/:id/messages',
      'POST /api/app/chat/messages/:id/perceived-wait',
      'POST /api/app/chat/threads',
      'POST /api/app/chat/threads/:id/cancel',
      'POST /api/app/chat/threads/:id/messages',
      'POST /api/app/chat/threads/:id/trash',
    ]);
    // The busy 409 is the composer's refusal, not an error.
    expect(metrics.snapshot().errors).toEqual({});
  });
});

describe('tasks', () => {
  test('Home reads carry the SPA board filters', async () => {
    const { api } = client();
    expect(
      boardQuery('o1', { statuses: OPEN_TASK_STATUSES, assigneeId: 'u1' }),
    ).toEqual({
      includeArchived: 'false',
      summary: 'true',
      statuses: 'backlog,todo,in_progress,in_review',
      assigneeId: 'u1',
      orgId: 'o1',
    });
    answers.set('GET /api/app/tasks', {
      body: { tasks: [{ _id: 'x1', status: 'todo', projectId: 'p1' }] },
    });
    const listed = await listTasksAcrossProjects(api, 'o1', {
      status: 'in_review',
      reviewerId: 'u1',
    });
    expect(listed.body?.[0]).toMatchObject({ id: 'x1', status: 'todo' });
    const seen = lastRequest();
    expect(seen.query.get('status')).toBe('in_review');
    expect(seen.query.get('reviewerId')).toBe('u1');
  });

  test('create returns the task id; move posts the column', async () => {
    const { api, metrics } = client();
    answers.set('POST /api/app/tasks', { body: { taskId: 'x9' } });
    const created = await createTask(api, 'o1', {
      projectId: 'p1',
      title: 'Fix it',
      priority: 'p2',
    });
    expect(created.body).toBe('x9');
    await moveTask(api, 'o1', 'x9', 'in_progress');
    expect(lastRequest().json).toEqual({ status: 'in_progress' });
    expect(metricNames(metrics)).toContain('POST /api/app/tasks/:taskId/move');
  });
});

describe('workspace', () => {
  test('contacts and notifications', async () => {
    const { api } = client();
    answers.set('POST /api/app/contacts', { body: { contactId: 'c1' } });
    const contact = await createContact(api, 'o1', {
      name: 'Ada Lovelace',
      source: 'manual_import',
    });
    expect(contact.body).toBe('c1');
    answers.set('GET /api/app/collab/notifications', {
      body: { rows: [{ id: 'n1', read: false }], nextCursor: null },
    });
    const rows = await listMyNotifications(api, 'o1');
    expect(rows.body).toEqual([{ id: 'n1', read: false }]);
    expect(lastRequest().query.get('limit')).toBe('20');
  });
});

describe('knowledge', () => {
  test('presign, PUT with the signed content type, bind', async () => {
    const { api, metrics } = client();
    answers.set('POST /api/app/files/blob-upload', {
      body: {
        url: `${server.url}/bucket/key?sig=1`,
        method: 'PUT',
        s3Ref: 's3:k',
      },
    });
    const ticket = await presignUpload(api, 'o1', 'text/markdown');
    expect(ticket.body).toEqual({
      url: `${server.url}/bucket/key?sig=1`,
      storageRef: 's3:k',
    });
    const status = await putPresigned(
      agent,
      metrics,
      `${server.url}/bucket/key?sig=1`,
      'text/markdown',
      '# hello',
      5_000,
    );
    expect(status).toBe(200);
    const put = lastRequest();
    expect(put.method).toBe('PUT');
    expect(put.path).toBe('/bucket/key');
    expect(put.headers['content-type']).toBe('text/markdown');
    answers.set('POST /api/app/documents/from-blob-upload', {
      body: { success: true, documentId: 'd1' },
    });
    const bound = await createDocumentFromUpload(api, 'o1', {
      storageRef: 's3:k',
      fileName: 'a.md',
      contentType: 'text/markdown',
    });
    expect(bound.body).toBe('d1');
  });

  test('an unconfigured object store is a refusal with its code', async () => {
    const { api, metrics } = client();
    answers.set('POST /api/app/files/blob-upload', {
      status: 503,
      body: { error: 'OBJECT_STORE_UNCONFIGURED' },
    });
    const ticket = await presignUpload(api, 'o1', 'text/plain');
    expect(ticket.status).toBe(503);
    expect(ticket.code).toBe('OBJECT_STORE_UNCONFIGURED');
    expect(metrics.snapshot().errors).toEqual({});
  });

  test('knowledge search counts hits', async () => {
    const { api } = client();
    answers.set('POST /api/app/knowledge/search', {
      body: { hits: [{ id: 1 }, { id: 2 }] },
    });
    const result = await searchKnowledge(api, 'o1', 'pricing');
    expect(result.body).toBe(2);
    expect(lastRequest().json).toEqual({
      query: 'pricing',
      corpus: 'documents',
      limit: 10,
    });
  });
});

describe('REST door', () => {
  test('bearer + organization slug, never a cookie', async () => {
    const metrics = new MetricsRegistry();
    const api = new ApiClient({
      requester: new HttpClient({
        baseUrl: server.url,
        agent,
        metrics,
        defaultHeaders: restHeaders('k-123', 'load-x-o0'),
      }),
    });
    answers.set('POST /api/v1/threads/t1/messages', {
      status: 202,
      body: { messageId: 'm1' },
    });
    const sent = await restSendMessage(api, 't1', {
      content: 'hello',
      model: 'load-chat-fast',
      providerSlug: 'loadmock',
    });
    expect(sent.body).toBe('m1');
    const seen = lastRequest();
    expect(seen.headers.authorization).toBe('Bearer k-123');
    expect(seen.headers['x-organization-slug']).toBe('load-x-o0');
    expect(seen.headers.cookie).toBeUndefined();

    answers.set('GET /api/v1/threads/t1/generation', {
      body: { status: 'streaming', textLength: 12 },
    });
    const poll = await restPollGeneration(api, 't1', 4);
    expect(poll.body).toEqual({
      status: 'streaming',
      textLength: 12,
      lastStatus: undefined,
    });
    expect(lastRequest().query.get('since')).toBe('4');

    answers.set('POST /api/v1/projects/p1/tasks', {
      status: 201,
      body: { task: { id: 'x1', created: true } },
    });
    const task = await restUpsertTask(api, 'p1', {
      externalSystem: 'tale-load',
      externalId: 'e1',
      title: 'From a script',
    });
    expect(task.body).toEqual({ id: 'x1', created: true });
    expect(metricNames(metrics).sort()).toEqual([
      'GET /api/v1/threads/:id/generation',
      'POST /api/v1/projects/:id/tasks',
      'POST /api/v1/threads/:id/messages',
    ]);
  });
});
