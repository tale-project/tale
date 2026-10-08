// @vitest-environment node

/**
 * An archived project is read-only. The MCP and REST doors refuse a run
 * scoped to one (`writableActorProject`, `loadRestProject({ write })`), but
 * the app's `/projects` binding and `/start` with a `projectId` reached the
 * store with no such check — so an archived project could still be bound to
 * an automation and runs still started in it.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

import { beginRun, setAutomationProjects } from './store.ts';

function fakeStore(options: { archivedAt: number | null; bound?: boolean }) {
  const writes: string[] = [];
  const tag = async (strings: TemplateStringsArray) => {
    const text = strings.join('?');
    if (text.includes('FROM app.automation_deployments')) {
      return [{ version: 1 }];
    }
    if (text.includes('FROM app.automations')) {
      return [{ document: {}, createdAt: 1 }];
    }
    if (text.includes('FROM app.automation_project_bindings'))
      return options.bound ? [{ projectId: 'p-1' }] : [];
    if (text.includes('FROM app.projects')) {
      return [{ id: 'p-1', archivedAt: options.archivedAt }];
    }
    if (/^\s*(INSERT|DELETE|UPDATE)/.test(text)) {
      writes.push(text.trim().split(/\s+/).slice(0, 3).join(' '));
      return Object.assign([{ id: 'run-1' }], { count: 1 });
    }
    return [];
  };
  const sql = Object.assign(tag, {
    json: (value: unknown) => value,
    begin: (callback: (tx: typeof tag) => Promise<unknown>) => callback(tag),
  }) as unknown as Sql;
  return { sql, writes };
}

beforeEach(() => vi.clearAllMocks());

describe('setAutomationProjects', () => {
  it('refuses an archived project with 403 PROJECT_ARCHIVED, writing nothing [AUTO-R8]', async () => {
    const fake = fakeStore({ archivedAt: 1 });
    await expect(
      setAutomationProjects(fake.sql, {
        organizationId: 'org-1',
        name: 'ops/greet',
        projectIds: ['p-1'],
        actor: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED', status: 403 });
    expect(fake.writes).toEqual([]);
  });

  it('binds an active project', async () => {
    const fake = fakeStore({ archivedAt: null });
    await setAutomationProjects(fake.sql, {
      organizationId: 'org-1',
      name: 'ops/greet',
      projectIds: ['p-1'],
      actor: 'user-1',
    });
    expect(fake.writes).toContain(
      'INSERT INTO app.automation_project_bindings',
    );
  });
});

describe('beginRun with a projectId', () => {
  const args = {
    organizationId: 'org-1',
    name: 'ops/greet',
    startedBy: 'user:user-1',
    mode: 'live' as const,
    input: {},
    projectId: 'p-1',
  };

  it('refuses an archived project with 403 PROJECT_ARCHIVED, inserting no run [AUTO-R8]', async () => {
    const fake = fakeStore({ archivedAt: 1 });
    await expect(beginRun(fake.sql, args)).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVED',
      status: 403,
    });
    expect(fake.writes).toEqual([]);
  });

  it('starts in an active project', async () => {
    const fake = fakeStore({ archivedAt: null });
    await expect(beginRun(fake.sql, args)).resolves.toEqual({
      runId: 'run-1',
      version: 1,
    });
    expect(fake.writes).toContain('INSERT INTO app.automation_runs');
  });

  it('refuses an app start whose sole binding is an archived project [AUTO-R8]', async () => {
    const fake = fakeStore({ archivedAt: 1, bound: true });
    const { projectId: _projectId, ...unscoped } = args;
    await expect(
      beginRun(fake.sql, { ...unscoped, visibleProjectIds: ['p-1'] }),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED', status: 403 });
    expect(fake.writes).toEqual([]);
  });

  // An event dispatch starts every listening automation inside one
  // savepoint without a per-trigger catch: a refusal here would roll back
  // the runs of every other automation listening for the same event.
  it('keeps a trigger start in its inferred sole binding without refusing it', async () => {
    const fake = fakeStore({ archivedAt: 1, bound: true });
    const { projectId: _projectId, ...unscoped } = args;
    await expect(
      beginRun(fake.sql, { ...unscoped, startedBy: 'trigger:t-1' }),
    ).resolves.toEqual({ runId: 'run-1', version: 1 });
    expect(fake.writes).toContain('INSERT INTO app.automation_runs');
  });
});
