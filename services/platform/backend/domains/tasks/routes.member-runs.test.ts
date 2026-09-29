// @vitest-environment node

/**
 * The app's run doors for a member: starting an automation on a task
 * (`/workflow/start`) and stopping it (`/workflow/cancel`) are changes to
 * the task — its work gate, judged in the transaction that starts the run,
 * and never on an archived task — and a member starts only an automation
 * built for tasks or the one that owns the task. Stopping an agent's live
 * run (`/agent-runs/cancel-live`) is open to whoever may work the task and
 * to the person who started the run, even once the task is no longer
 * theirs.
 */

import type { Context } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';
import { cancelAgentRun } from './agent-runs.ts';
import { startWorkflowForTaskInTx } from './external-ref.ts';

vi.mock('../../lib/rate-limit.ts', () => ({
  checkUserRateLimit: vi.fn(),
  RateLimitExceededError: class extends Error {},
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u-member', email: 'member@example.test' },
      } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'o1');
        c.set('orgMember', { role: 'member' } as never);
        await next();
      },
  };
});
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('./external-ref.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./external-ref.ts')>()),
  startWorkflowForTaskInTx: vi.fn(),
}));
vi.mock('./agent-runs.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agent-runs.ts')>()),
  cancelAgentRun: vi.fn(),
}));

import { createTaskRoutes } from './routes.ts';

const PROJECT = {
  id: 'p1',
  organizationId: 'o1',
  teamId: null,
  sharedWithTeamIds: [] as string[],
  archivedAt: null,
};

interface Case {
  task: Record<string, unknown>;
  /** The deployed automation's task contract; absent = it declares none. */
  contract?: unknown;
  /** The task's live agent run. */
  liveRun?: { id: string; agentId: string; status: string; startedBy: string };
}

function stubSql(script: Case): Sql {
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT ? FROM app.tasks WHERE id = ?')) {
      return Promise.resolve([script.task]);
    }
    if (text.startsWith('SELECT ? FROM app.projects WHERE id = ?')) {
      return Promise.resolve([PROJECT]);
    }
    if (text.startsWith('SELECT version FROM app.automation_deployments')) {
      return Promise.resolve([{ version: 1 }]);
    }
    if (text.startsWith('SELECT name, version, document')) {
      return Promise.resolve([
        { name: 'contracts/review', version: 1, taskContract: script.contract },
      ]);
    }
    if (text.includes('FROM app.project_agent_runs')) {
      return Promise.resolve(script.liveRun ? [script.liveRun] : []);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    json: (value: unknown) => value,
    unsafe: (text: string) => text,
    begin: (first: unknown, second?: unknown) => {
      const run = typeof first === 'function' ? first : second;
      if (typeof run !== 'function') throw new Error('begin without a body');
      return Promise.resolve(run(sql));
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the members the doors' reads and transactions reach
  return sql as unknown as Sql;
}

async function post(
  path: string,
  script: Case,
  body: unknown = {},
): Promise<{ status: number; json: unknown }> {
  const response = await createTaskRoutes({
    sql: stubSql(script),
    auth: {} as never,
  }).request(`${path}?orgId=o1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 't1',
  organizationId: 'o1',
  projectId: 'p1',
  title: 'Review the supplier contract',
  status: 'todo',
  labelIds: [],
  createdBy: 'u-member',
  createdByType: 'user',
  assigneeType: null,
  assigneeId: null,
  parentTaskId: null,
  archivedAt: null,
  ...overrides,
});

const start = { workflowSlug: 'contracts/review' };

beforeEach(() => {
  vi.mocked(startWorkflowForTaskInTx)
    .mockReset()
    .mockResolvedValue({ runId: 'run-1', alreadyRunning: false });
  vi.mocked(cancelAgentRun).mockReset().mockResolvedValue(true);
});

describe('a member starting an automation on a task', () => {
  it('starts one built for tasks on their own task', async () => {
    const sent = await post(
      '/t1/workflow/start',
      { task: task(), contract: { workflow: 'contracts/review' } },
      start,
    );
    expect(sent).toEqual({
      status: 200,
      json: { started: true, executionId: 'run-1' },
    });
    expect(startWorkflowForTaskInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ startedByUserId: 'u-member' }),
    );
  });

  it('starts nothing that is not built for tasks, unless it owns the task', async () => {
    const refused = await post('/t1/workflow/start', { task: task() }, start);
    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({ error: 'RBAC_FORBIDDEN' });

    const owned = await post(
      '/t1/workflow/start',
      {
        task: task({ assigneeType: 'app', assigneeId: 'contracts/review' }),
      },
      start,
    );
    expect(owned.status).toBe(200);
    expect(startWorkflowForTaskInTx).toHaveBeenCalledTimes(1);
  });

  it("starts nothing on someone else's task, or on an archived one", async () => {
    const theirs = await post(
      '/t1/workflow/start',
      {
        task: task({ createdBy: 'u-editor' }),
        contract: { workflow: 'contracts/review' },
      },
      start,
    );
    expect(theirs.status).toBe(403);
    expect(theirs.json).toMatchObject({ error: 'RBAC_FORBIDDEN' });

    const archived = await post(
      '/t1/workflow/start',
      {
        task: task({ archivedAt: 5 }),
        contract: { workflow: 'contracts/review' },
      },
      start,
    );
    expect(archived.status).toBe(400);
    expect(archived.json).toMatchObject({ error: 'TASK_ARCHIVED' });
    expect(startWorkflowForTaskInTx).not.toHaveBeenCalled();
  });

  it("does not stop an automation on someone else's task", async () => {
    const sent = await post('/t1/workflow/cancel', {
      task: task({ createdBy: 'u-editor' }),
    });
    expect(sent.status).toBe(403);
    expect(sent.json).toMatchObject({ error: 'RBAC_FORBIDDEN' });
  });
});

describe("stopping an agent's live run", () => {
  // The member handed their assigned task to the agent with an @mention:
  // the agent is its assignee now, and the run is the member's.
  const handedOver = task({
    createdBy: 'u-editor',
    assigneeType: 'agent',
    assigneeId: 'agent-1',
    status: 'in_progress',
  });

  it('is open to the member who started it, on a task no longer theirs', async () => {
    const sent = await post('/t1/agent-runs/cancel-live', {
      task: handedOver,
      liveRun: {
        id: 'r1',
        agentId: 'agent-1',
        status: 'running',
        startedBy: 'u-member',
      },
    });
    expect(sent).toEqual({ status: 200, json: { cancelled: true } });
    expect(cancelAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ runId: 'r1', taskId: 't1' }),
    );
  });

  it("is refused on someone else's run on someone else's task", async () => {
    const sent = await post('/t1/agent-runs/cancel-live', {
      task: handedOver,
      liveRun: {
        id: 'r1',
        agentId: 'agent-1',
        status: 'running',
        startedBy: 'u-editor',
      },
    });
    expect(sent.status).toBe(403);
    expect(sent.json).toMatchObject({ error: 'RBAC_FORBIDDEN' });
    expect(cancelAgentRun).not.toHaveBeenCalled();
  });
});
