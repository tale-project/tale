// @vitest-environment node

/**
 * The managed configuration doors of a standing task, a project's label
 * and a dispatch check (`…/configuration/task`,
 * `/labels/by-project/{projectId}/configuration`,
 * `/dispatch/by-project/{projectId}/configuration/check`): a body names the
 * resource its path and query name, a task is created only under a UUID,
 * and a check for a project the declaration creates is judged against the
 * declaration alone while no project holds the id.
 */

import type { Context } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const managed = vi.hoisted(() => ({
  readManagedTask: vi.fn(),
  writeManagedTask: vi.fn(),
  readManagedProjectLabel: vi.fn(),
  writeManagedProjectLabel: vi.fn(),
}));
const dispatchConfig = vi.hoisted(() => ({
  checkProjectDispatchSave: vi.fn(),
}));
const getProjectAuthContext = vi.hoisted(() => vi.fn());

vi.mock('./managed-entities.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./managed-entities.ts')>()),
  ...managed,
}));
vi.mock('./dispatch-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dispatch-config.ts')>()),
  ...dispatchConfig,
}));
vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  getProjectAuthContext,
}));
vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: (_sql: unknown, fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock('../../lib/rate-limit.ts', () => ({
  checkUserRateLimit: vi.fn(),
  RateLimitExceededError: class extends Error {},
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'ada', email: 'ada@example.test' },
      } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'org-1');
      c.set('orgMember', { role: 'admin' } as never);
      await next();
    },
}));

import { createTaskRoutes } from './routes.ts';

const PROJECT = '6f1c2a14-4d55-4d61-9b2a-7a5c2e0f3b11';
const AGENT = '0c3d5e8a-1b2c-4d3e-8f9a-0b1c2d3e4f50';
const TASK = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ada = {
  organizationId: 'org-1',
  userId: 'ada',
  role: 'admin',
  teamIds: [],
};

/** A connection whose project probe answers the ids it holds. */
function stubSql(projects: string[] = []): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) =>
    Promise.resolve(
      strings.join('?').includes('FROM app.projects') &&
        projects.includes(String(values[0]))
        ? [{ id: values[0] }]
        : [],
    );
  return tag as unknown as Sql;
}

function send(
  method: 'GET' | 'POST',
  route: string,
  body?: unknown,
  projects: string[] = [],
) {
  return createTaskRoutes({
    sql: stubSql(projects),
    auth: {} as never,
  }).request(route, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getProjectAuthContext.mockResolvedValue(ada);
  managed.readManagedTask.mockResolvedValue({ config: null, hash: null });
  managed.readManagedProjectLabel.mockResolvedValue({
    config: null,
    hash: null,
  });
  dispatchConfig.checkProjectDispatchSave.mockResolvedValue({
    ok: true,
    changed: true,
    hash: 'a'.repeat(64),
  });
});

describe('the managed door of a standing task [TASK-R67]', () => {
  const task = (taskId: string, projectId = PROJECT) => ({
    config: { projectId, taskId, title: 'Manage the fleet' },
    expectedHash: null,
    createIfMissing: true,
    initialStatus: 'todo',
  });

  it('writes only the task its path and query name, and creates only under a UUID', async () => {
    const route = (taskId: string) =>
      `/${taskId}/configuration/task?projectId=${PROJECT}`;
    expect(
      (await send('POST', route(TASK), task(TASK, 'another-project'))).status,
    ).toBe(400);
    expect(
      (await send('POST', route('standing'), task('standing'))).status,
    ).toBe(400);
    expect(managed.writeManagedTask).not.toHaveBeenCalled();
    expect((await send('POST', route(TASK), task(TASK))).status).toBe(200);
    expect(managed.writeManagedTask).toHaveBeenCalledWith({}, ada, task(TASK));
  });

  it('reads the task its path names in the project its query names', async () => {
    expect(
      (
        await send(
          'GET',
          `/${TASK}/configuration/task?projectId=${PROJECT}&createIfMissing=true`,
        )
      ).status,
    ).toBe(200);
    expect(managed.readManagedTask).toHaveBeenCalledWith(
      expect.anything(),
      ada,
      PROJECT,
      TASK,
      true,
    );
    expect((await send('GET', `/${TASK}/configuration/task`)).status).toBe(400);
  });
});

describe('the managed door of a project label [TASK-R68]', () => {
  const label = {
    config: { projectId: PROJECT, name: 'Release' },
    expectedHash: null,
    createIfMissing: true,
  };

  it('writes the label its query names whatever its case, and no other', async () => {
    const route = (name: string) =>
      `/labels/by-project/${PROJECT}/configuration?name=${name}`;
    expect((await send('POST', route('Hotfix'), label)).status).toBe(400);
    expect(managed.writeManagedProjectLabel).not.toHaveBeenCalled();
    expect((await send('POST', route('release'), label)).status).toBe(200);
    expect(managed.writeManagedProjectLabel).toHaveBeenCalledWith(
      {},
      ada,
      label,
    );
  });
});

describe('a dispatch check counts what its declaration creates [TASK-R69]', () => {
  const dispatch = {
    projectId: PROJECT,
    enabled: true,
    agents: [AGENT],
    maxConcurrentRuns: 1,
    statuses: ['todo'],
    assignment: 'assigned',
  };
  const check = (planned?: object) => ({
    config: dispatch,
    expectedHash: null,
    ...(planned === undefined ? {} : { planned }),
  });
  const route = `/dispatch/by-project/${PROJECT}/configuration/check`;

  it('judges a project the declaration creates against the declaration alone', async () => {
    const answer = await send(
      'POST',
      route,
      check({ project: true, agents: [AGENT], tasks: [], labels: [] }),
    );
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ ok: true, changed: true });
    expect(dispatchConfig.checkProjectDispatchSave).not.toHaveBeenCalled();

    const refused = await send(
      'POST',
      route,
      check({ project: true, agents: [], tasks: [], labels: [] }),
    );
    expect(await refused.json()).toMatchObject({
      ok: false,
      issues: [{ path: 'agents.0' }],
    });
  });

  it('checks a project that exists as a save would, with what the declaration adds', async () => {
    const planned = { project: true, agents: [AGENT], tasks: [], labels: [] };
    expect((await send('POST', route, check(planned), [PROJECT])).status).toBe(
      200,
    );
    expect(dispatchConfig.checkProjectDispatchSave).toHaveBeenCalledWith(
      {},
      ada,
      expect.objectContaining({ projectId: PROJECT, planned }),
    );
  });

  it('takes `planned` on a check alone, never on a save', async () => {
    const answer = await send(
      'POST',
      `/dispatch/by-project/${PROJECT}/configuration`,
      check({ agents: [AGENT], tasks: [], labels: [] }),
    );
    expect(answer.status).toBe(400);
  });
});
