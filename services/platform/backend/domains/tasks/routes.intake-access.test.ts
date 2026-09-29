// @vitest-environment node

/**
 * The app's external-issue intake (`POST /api/app/tasks/from-external-issue`,
 * the board's template create) under the task rule: every reader of an
 * active project creates through it, reconciling the task a reference
 * already names is a change to that task — its creator's, its person
 * assignee's or an editor's — and the label catalog grows only for the
 * project's editors. The door used to check read access alone: it created
 * tasks in an archived project, reconciled anyone's task and minted labels
 * for every member. The domain runs for real here, on a stub connection.
 */

import type { Context } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const viewer = vi.hoisted(() => ({ role: 'member' }));

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
        c.set('orgMember', { role: viewer.role } as never);
        await next();
      },
  };
});
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));

import { createTaskRoutes } from './routes.ts';

const PROJECT = {
  id: 'p1',
  organizationId: 'o1',
  teamId: null,
  sharedWithTeamIds: [] as string[],
  archivedAt: null as number | null,
};

/** The task the reference `crm/c-1` already names, when a case has one. */
const EXISTING = {
  id: 't1',
  organizationId: 'o1',
  projectId: 'p1',
  title: 'Existing',
  status: 'backlog',
  labelIds: [] as string[],
  assigneeType: null,
  assigneeId: null,
  createdByType: 'user',
  archivedAt: null,
};

function stubSql(options: { archived?: boolean; existingCreatedBy?: string }): {
  sql: Sql;
  statements: string[];
} {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.startsWith('SELECT ? FROM app.projects WHERE id = ?')) {
      return Promise.resolve([
        { ...PROJECT, archivedAt: options.archived === true ? 1 : null },
      ]);
    }
    if (
      text.startsWith('SELECT ? FROM app.tasks WHERE org_id = ?') &&
      text.includes('external_id = ?')
    ) {
      return Promise.resolve(
        options.existingCreatedBy === undefined
          ? []
          : [{ ...EXISTING, createdBy: options.existingCreatedBy }],
      );
    }
    if (text.startsWith('SELECT id FROM app.projects WHERE id = ?')) {
      return Promise.resolve([{ id: PROJECT.id }]);
    }
    if (text.startsWith('UPDATE app.projects SET task_counter')) {
      return Promise.resolve([{ taskCounter: 1 }]);
    }
    if (text.startsWith('INSERT INTO app.tasks')) {
      return Promise.resolve([{ id: 't-new' }]);
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the members the door's reads and transaction reach
  return { sql: sql as unknown as Sql, statements };
}

async function intake(
  body: Record<string, unknown>,
  options: Parameters<typeof stubSql>[0] = {},
): Promise<{ status: number; json: unknown; writes: string[] }> {
  const { sql, statements } = stubSql(options);
  const response = await createTaskRoutes({
    sql,
    auth: {} as never,
  }).request('/from-external-issue?orgId=o1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: 'p1',
      externalSystem: 'crm',
      externalId: 'c-1',
      title: 'Review the supplier contract',
      ...body,
    }),
  });
  return {
    status: response.status,
    json: await response.json(),
    writes: statements.filter((text) => /^(INSERT|UPDATE|DELETE)\b/.test(text)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  viewer.role = 'member';
});

describe('the external-issue intake under the task rule', () => {
  it('creates a task for a member who can read the project', async () => {
    const sent = await intake({});
    expect(sent.status).toBe(200);
    expect(sent.json).toEqual({ taskId: 't-new', created: true });
    expect(
      sent.writes.some((text) => text.startsWith('INSERT INTO app.tasks')),
    ).toBe(true);
  });

  it('refuses an archived project, writing nothing', async () => {
    const sent = await intake({}, { archived: true });
    expect(sent.status).toBe(403);
    expect(sent.json).toMatchObject({ error: 'PROJECT_ARCHIVED' });
    expect(sent.writes).toEqual([]);
  });

  it("refuses a member's reconcile of someone else's task, writing nothing", async () => {
    const sent = await intake({}, { existingCreatedBy: 'u-editor' });
    expect(sent.status).toBe(403);
    expect(sent.json).toMatchObject({ error: 'RBAC_FORBIDDEN' });
    expect(sent.writes).toEqual([]);
  });

  it('reconciles the task the member created', async () => {
    const sent = await intake({}, { existingCreatedBy: 'u-member' });
    expect(sent.status).toBe(200);
    expect(sent.json).toEqual({ taskId: 't1', created: false });
  });

  it('names only labels the catalog has for a member, and mints them for an editor', async () => {
    const refused = await intake({ labels: ['Contracts'] });
    expect(refused.status).toBe(400);
    expect(refused.json).toMatchObject({ error: 'TASK_LABEL_UNKNOWN' });
    expect(
      refused.writes.some((text) => text.startsWith('INSERT INTO app.tasks')),
    ).toBe(false);

    viewer.role = 'editor';
    const minted = await intake({ labels: ['Contracts'] });
    expect(minted.status).toBe(200);
    expect(
      minted.writes.some((text) =>
        text.startsWith('INSERT INTO app.task_labels'),
      ),
    ).toBe(true);
  });
});
