import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RestEnv } from './shared.ts';
import { createAutomationRestRoutes } from './v1-automations.ts';

const store = vi.hoisted(() => ({
  getRun: vi.fn(),
  getPendingAskForRun: vi.fn(),
  answerAsk: vi.fn(),
}));
const collaborators = vi.hoisted(() => ({
  createAuditLog: vi.fn(),
  addTaskComment: vi.fn(),
}));

vi.mock('../domains/automations/store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/automations/store.ts')>()),
  getRun: store.getRun,
  getPendingAskForRun: store.getPendingAskForRun,
  answerAsk: store.answerAsk,
}));
vi.mock('../domains/audit_logs/service.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/audit_logs/service.ts')
  >()),
  createAuditLog: collaborators.createAuditLog,
}));
vi.mock('../domains/tasks/comments.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/tasks/comments.ts')>()),
  addTaskComment: collaborators.addTaskComment,
}));

interface Captured {
  text: string;
  values: unknown[];
}

const project = {
  id: 'p-2',
  organizationId: 'org-1',
  name: 'Ledger',
  description: null,
  icon: null,
  color: null,
  key: null,
  externalItemId: null,
  taskCounter: 0,
  openTaskCount: 0,
  doneTaskCount: 0,
  projectAgentCount: 0,
  teamId: null,
  sharedWithTeamIds: [],
  instructions: null,
  createdBy: 'user-1',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  archivedAt: null,
};

const projectRun = {
  id: 'run-1',
  organizationId: 'org-1',
  name: 'vat-return-desk',
  version: 3,
  projectId: 'p-2',
  status: 'waiting',
  mode: 'live',
  startedBy: 'api-key:user-1',
  input: {},
  output: null,
  checkpoints: null,
  trace: null,
  effects: null,
  detail: 'agent:repair_setup',
  failureCode: null,
  claimEpoch: 1,
  chainSeq: 2,
  startedAt: 1_700_000_000_000,
  finishedAt: null,
  askPending: true,
};

const ask = {
  askId: 'ask-1',
  runId: 'run-1',
  nodeId: 'repair_setup',
  question: 'Which booking date applies to invoice 4711?',
  createdAt: 1_700_000_001_000,
  expiresAt: 1_700_000_900_000,
  taskId: 't-1',
};

const member = {
  id: 'user-9',
  email: 'reginald@example.com',
  emailVerified: true,
  role: 'member',
};

function fakeSql(
  opts: {
    members?: object[];
    granted?: boolean;
    spent?: boolean;
    /** The project's team; null keeps it open to every member. */
    projectTeamId?: string | null;
    /** The actor's teams (`getUserTeamIds` binds the user first). */
    actorTeamIds?: string[];
  } = {},
) {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (text.includes('FROM "teamMember"')) {
      const teamIds =
        values[0] === 'user-9' ? (opts.actorTeamIds ?? ['team-1']) : ['team-1'];
      return Promise.resolve(teamIds.map((teamId) => ({ teamId })));
    }
    if (text.includes('FROM app.projects WHERE id')) {
      return Promise.resolve([
        { ...project, teamId: opts.projectTeamId ?? null },
      ]);
    }
    if (text.includes('FROM "user" u JOIN "member" m')) {
      return Promise.resolve(opts.members ?? [member]);
    }
    if (text.includes('FROM app.competence_records')) {
      return Promise.resolve(
        opts.granted ? [{ expiresAt: null, revokedAt: null }] : [],
      );
    }
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve(opts.spent ? [] : [{ value: '1' }]);
    }
    if (text.includes('FROM app.rate_limits')) {
      return Promise.resolve([{ value: '0', ts: String(Date.now()) }]);
    }
    return Promise.resolve([]);
  };
  const unsafe = (text: string) => ({ unsafe: text });
  const begin = (
    options: string | ((tx: unknown) => Promise<unknown>),
    callback?: (tx: unknown) => Promise<unknown>,
  ) => (typeof options === 'function' ? options(sql) : callback?.(sql));
  const sql = Object.assign(tag, { unsafe, begin });
  return { sql: sql as unknown as Sql, queries };
}

function mount(sql: Sql, role = 'member') {
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'worker@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', role);
    c.set('orgExplicit', true);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  app.route('/api/v1', createAutomationRestRoutes({ sql }));
  return (path: string, method = 'GET', body?: unknown) =>
    app.request(`http://localhost/api/v1${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: typeof body === 'string' ? body : JSON.stringify(body),
          }),
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.getRun.mockResolvedValue(projectRun);
  store.getPendingAskForRun.mockResolvedValue(ask);
  store.answerAsk.mockResolvedValue({ runId: 'run-1', taskId: 't-1' });
  collaborators.createAuditLog.mockResolvedValue('audit-1');
  collaborators.addTaskComment.mockResolvedValue({ messageId: 'comment-1' });
});

describe('GET …/runs/{runId}/ask', () => {
  it('answers the pending question of a project run to a member', async () => {
    const request = mount(fakeSql().sql);
    const res = await request('/projects/p-2/runs/run-1/ask');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ask });
    expect(store.getPendingAskForRun).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'run-1',
    );
  });

  it('answers null when nothing waits on a person', async () => {
    store.getPendingAskForRun.mockResolvedValue(null);
    const request = mount(fakeSql().sql);
    const res = await request('/projects/p-2/runs/run-1/ask');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ask: null });
  });

  it('keeps a project run out of the organization path and vice versa', async () => {
    const request = mount(fakeSql().sql);
    const viaOrg = await request('/runs/run-1/ask');
    expect(viaOrg.status).toBe(404);
    expect(await viaOrg.json()).toMatchObject({ code: 'RUN_NOT_FOUND' });
    store.getRun.mockResolvedValue({ ...projectRun, projectId: null });
    const viaProject = await request('/projects/p-2/runs/run-1/ask');
    expect(viaProject.status).toBe(404);
    const orgRun = await request('/runs/run-1/ask');
    expect(orgRun.status).toBe(200);
  });
});

describe('POST …/runs/{runId}/asks/{askId}', () => {
  it('records the answer as the key when no actor is named, then mirrors it onto the task', async () => {
    const { sql, queries } = fakeSql();
    const request = mount(sql, 'editor');
    const res = await request('/projects/p-2/runs/run-1/asks/ask-1', 'POST', {
      answer: 'Use the invoice date.',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      askId: 'ask-1',
      runId: 'run-1',
      answeredBy: 'api-key:user-1',
      taskId: 't-1',
    });
    expect(store.answerAsk).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      askId: 'ask-1',
      runId: 'run-1',
      answer: 'Use the invoice date.',
      answeredBy: 'api-key:user-1',
    });
    expect(collaborators.addTaskComment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-1', organizationId: 'org-1' }),
      { taskId: 't-1', body: 'Use the invoice date.' },
    );
    expect(collaborators.createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'automation.ask_answered',
        actorId: 'user-1',
        resourceId: 'run-1',
        metadata: expect.objectContaining({ via: 'api-key', askId: 'ask-1' }),
      }),
    );
    expect(
      queries.find((q) => q.text.includes('INSERT INTO app.rate_limits'))
        ?.values,
    ).toContain('rest:execute');
    // No actor named: the member register is never read.
    expect(queries.some((q) => q.text.includes('FROM "user" u'))).toBe(false);
  });

  it('records the answer FOR the actor an admin names, and comments as that person', async () => {
    const { sql } = fakeSql();
    const request = mount(sql, 'admin');
    const res = await request('/projects/p-2/runs/run-1/asks/ask-1', 'POST', {
      answer: 'The February rate.',
      actor: { email: 'Reginald@Example.com' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      answeredBy: 'user-9',
      actorUserId: 'user-9',
    });
    expect(store.answerAsk).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ answeredBy: 'user-9' }),
    );
    expect(collaborators.addTaskComment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'user-9',
        email: 'reginald@example.com',
        role: 'member',
      }),
      { taskId: 't-1', body: 'The February rate.' },
    );
    expect(collaborators.createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: 'user-9',
        actorEmail: 'reginald@example.com',
        metadata: expect.objectContaining({ keyHolderUserId: 'user-1' }),
      }),
    );
  });

  it('refuses an actor who may not see the project, by name, before anything is recorded', async () => {
    // The key holder (an admin) reaches the team's project; the member they
    // relay for is on another team — the refusal speaks of that member.
    const { sql } = fakeSql({
      projectTeamId: 'team-1',
      actorTeamIds: ['team-other'],
    });
    const res = await mount(sql, 'admin')(
      '/projects/p-2/runs/run-1/asks/ask-1',
      'POST',
      { answer: 'Yes.', actor: { email: 'reginald@example.com' } },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ACTOR_FORBIDDEN' });
    expect(store.answerAsk).not.toHaveBeenCalled();
    expect(collaborators.createAuditLog).not.toHaveBeenCalled();
  });

  it('lets a member with the act-as grant name an actor, and refuses one without it before any lookup', async () => {
    const granted = fakeSql({ granted: true });
    const ok = await mount(granted.sql, 'editor')(
      '/projects/p-2/runs/run-1/asks/ask-1',
      'POST',
      { answer: 'Yes.', actor: { email: 'reginald@example.com' } },
    );
    expect(ok.status).toBe(200);
    const denied = fakeSql({ granted: false });
    const res = await mount(denied.sql, 'editor')(
      '/projects/p-2/runs/run-1/asks/ask-1',
      'POST',
      { answer: 'Yes.', actor: { email: 'reginald@example.com' } },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ROLE_FORBIDDEN' });
    expect(denied.queries.some((q) => q.text.includes('FROM "user" u'))).toBe(
      false,
    );
    expect(store.answerAsk).toHaveBeenCalledTimes(1);
  });

  it('names the actor refusals: not found, ambiguous, unverified, disabled, rebound', async () => {
    const cases: [object[], number, string][] = [
      [[], 404, 'ACTOR_NOT_FOUND'],
      [[member, { ...member, id: 'user-10' }], 409, 'ACTOR_AMBIGUOUS'],
      [[{ ...member, emailVerified: false }], 403, 'ACTOR_UNVERIFIED'],
      [[{ ...member, role: 'disabled' }], 403, 'ACTOR_DISABLED'],
    ];
    for (const [members, status, code] of cases) {
      const res = await mount(fakeSql({ members }).sql, 'admin')(
        '/projects/p-2/runs/run-1/asks/ask-1',
        'POST',
        { answer: 'Yes.', actor: { email: 'reginald@example.com' } },
      );
      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ code });
    }
    const rebound = await mount(fakeSql().sql, 'admin')(
      '/projects/p-2/runs/run-1/asks/ask-1',
      'POST',
      {
        answer: 'Yes.',
        actor: { email: 'reginald@example.com', userId: 'user-old' },
      },
    );
    expect(rebound.status).toBe(409);
    expect(await rebound.json()).toMatchObject({ code: 'ACTOR_REBOUND' });
    expect(store.answerAsk).not.toHaveBeenCalled();
  });

  it('passes the store’s refusals through with their codes', async () => {
    const { AutomationError } = await vi.importActual<
      typeof import('../domains/automations/store.ts')
    >('../domains/automations/store.ts');
    store.answerAsk.mockRejectedValue(
      new AutomationError(
        'HUMAN_ASK_NOT_PENDING',
        'this question was already answered or closed',
        409,
      ),
    );
    const res = await mount(fakeSql().sql, 'editor')(
      '/projects/p-2/runs/run-1/asks/ask-1',
      'POST',
      { answer: 'Yes.' },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'HUMAN_ASK_NOT_PENDING' });
    expect(collaborators.addTaskComment).not.toHaveBeenCalled();
  });

  it('refuses a blank answer, an unknown key and a read-only project before anything is recorded', async () => {
    const request = mount(fakeSql().sql, 'editor');
    // The documented `EMPTY_ANSWER`: the schema's own `INVALID_BODY` used
    // to speak first, so the code was never observable (2026-09-19
    // evaluation, K3-1) — whitespace, a no-break space and a zero-width
    // space are all blank.
    for (const answer of ['   ', '\u00a0', '\u200b']) {
      const blank = await request(
        '/projects/p-2/runs/run-1/asks/ask-1',
        'POST',
        { answer },
      );
      expect(blank.status).toBe(400);
      expect(await blank.json()).toMatchObject({ code: 'EMPTY_ANSWER' });
    }
    expect(
      (
        await request('/projects/p-2/runs/run-1/asks/ask-1', 'POST', {
          answer: 'Yes.',
          reason: 'x',
        })
      ).status,
    ).toBe(400);
    const readOnly = await mount(fakeSql().sql, 'member')(
      '/projects/p-2/runs/run-1/asks/ask-1',
      'POST',
      { answer: 'Yes.' },
    );
    expect(readOnly.status).toBe(403);
    expect(store.answerAsk).not.toHaveBeenCalled();
  });

  it('keeps the answer when the comment mirror fails, and says so on the console', async () => {
    collaborators.addTaskComment.mockRejectedValue(new Error('no access'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await mount(fakeSql().sql, 'editor')(
      '/projects/p-2/runs/run-1/asks/ask-1',
      'POST',
      { answer: 'Yes.' },
    );
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(
      '[rest] ask answer comment mirror failed',
      expect.objectContaining({ askId: 'ask-1' }),
    );
    warn.mockRestore();
  });

  it('answers an organization run’s question under membership alone', async () => {
    store.getRun.mockResolvedValue({ ...projectRun, projectId: null });
    store.answerAsk.mockResolvedValue({ runId: 'run-1', taskId: null });
    const res = await mount(fakeSql().sql, 'member')(
      '/runs/run-1/asks/ask-1',
      'POST',
      { answer: 'Yes.' },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ taskId: null });
    expect(collaborators.addTaskComment).not.toHaveBeenCalled();
  });
});
