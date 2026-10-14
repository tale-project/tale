// @vitest-environment node

/**
 * Provisioning runs when an organization is created and again for every
 * organization when an operator runs `tale migrate`, so it must add what is
 * missing and nothing else: starter content appears only in an organization
 * that has no project yet, and no automation is ever added, changed or
 * removed — a new organization starts with none, and the ones an
 * organization already has are left as they are.
 *
 * The job runs here as the worker runs it: the real `org.scaffold` handler,
 * queued by the real `tale migrate` door, over a `sql` that keeps every
 * statement it is sent. Only the config scaffold (files, not rows), the
 * queue and the project and task writers are stood in for.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  addJobInTx: vi.fn(),
  createProject: vi.fn(),
  createTask: vi.fn(),
  scaffoldNewOrganization: vi.fn(),
}));

vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  getProjectAuthContext: vi.fn(() => Promise.resolve({ role: 'owner' })),
  createProject: h.createProject,
  updateProjectInstructions: vi.fn(),
}));
vi.mock('../tasks/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tasks/service.ts')>()),
  createTask: h.createTask,
}));
vi.mock('../organizations/scaffold.ts', () => ({
  scaffoldNewOrganization: h.scaffoldNewOrganization,
}));
vi.mock('../../jobs/enqueue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../jobs/enqueue.ts')>()),
  addJobInTx: h.addJobInTx,
}));

import { createTaskList } from '../../jobs/task-list.ts';
import { provisionAllOrganizations } from '../control/service.ts';
import { seedStarterContent } from './service.ts';
import { EXAMPLE_TASKS } from './starter-content.ts';

interface Organization {
  id: string;
  slug: string;
  projects: number;
}

/** Every table that holds an automation, its versions, its trigger, its
 * installations or its deletion. */
const AUTOMATION_TABLE = /\bapp\.automation/;

/** A `sql` that answers provisioning's reads from these organizations and
 * keeps the text of every statement it is sent. */
function recordingSql(organizations: Organization[]): {
  sql: Sql;
  statements: string[];
} {
  const statements: string[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.startsWith('SELECT "slug" FROM "organization"')) {
      return Promise.resolve(organizations.map(({ slug }) => ({ slug })));
    }
    if (text.startsWith('SELECT "id" FROM "organization"')) {
      const found = organizations.find(({ slug }) => slug === values[0]);
      return Promise.resolve(found === undefined ? [] : [{ id: found.id }]);
    }
    if (text.startsWith('SELECT count(*)::text AS count FROM app.projects')) {
      const found = organizations.find(({ id }) => id === values[0]);
      return Promise.resolve([{ count: String(found?.projects ?? 0) }]);
    }
    return Promise.resolve([]);
  };
  Object.assign(tag, {
    json: (value: unknown) => value,
    begin: (work: (tx: unknown) => Promise<unknown>) => work(tag),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: tag as unknown as Sql, statements };
}

const ADA: Organization = { id: 'org-ada', slug: 'ada', projects: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  // The integration harness switches the starter content off; these tests
  // run it whatever the shell they are started from says.
  vi.stubEnv('TALE_PROVISIONING_DISABLED', '0');
  h.addJobInTx.mockResolvedValue('job-1');
  h.createProject.mockResolvedValue('project-1');
  h.scaffoldNewOrganization.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('a new organization', () => {
  it('starts with the starter project and its tasks, and no automation [PROVN-R9]', async () => {
    const { sql, statements } = recordingSql([ADA]);
    const handler = createTaskList({ sql })['org.scaffold'];
    expect(handler).toBeDefined();

    // What the organization's creation queues.
    await handler?.({ orgSlug: 'ada', cleanFirst: true });

    expect(h.scaffoldNewOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ orgSlug: 'ada', cleanFirst: true }),
    );
    expect(h.createProject).toHaveBeenCalledTimes(1);
    expect(h.createTask).toHaveBeenCalledTimes(EXAMPLE_TASKS.length);
    // Not one statement reads or writes an automation table: nothing is
    // added, so the Automations list opens empty.
    expect(statements.filter((text) => AUTOMATION_TABLE.test(text))).toEqual(
      [],
    );
  });
});

describe('`tale migrate`', () => {
  it('re-runs provisioning for every organization without touching an automation it has [PROVN-R10]', async () => {
    // Ada's organization has her own project and the Gmail sync an earlier
    // release gave it; Noah's has no project yet.
    const organizations: Organization[] = [
      { ...ADA, projects: 1 },
      { id: 'org-noah', slug: 'noah', projects: 0 },
    ];
    const { sql, statements } = recordingSql(organizations);

    expect(await provisionAllOrganizations(sql)).toEqual({ organizations: 2 });
    const queued = h.addJobInTx.mock.calls.map((call) => ({
      job: call[1],
      payload: call[2],
    }));
    expect(queued).toEqual([
      { job: 'org.scaffold', payload: { orgSlug: 'ada' } },
      { job: 'org.scaffold', payload: { orgSlug: 'noah' } },
    ]);

    // The worker runs each job it queued.
    const handler = createTaskList({ sql })['org.scaffold'];
    for (const { payload } of queued) await handler?.(payload);

    expect(h.scaffoldNewOrganization).toHaveBeenCalledTimes(2);
    // Provisioning does not even read an automation table, so the Gmail
    // sync keeps its versions, its trigger and its name, and no template a
    // release ships is added beside it — in either organization.
    expect(statements.filter((text) => AUTOMATION_TABLE.test(text))).toEqual(
      [],
    );
    // Only Noah's organization, which had no project, is given the starter.
    expect(h.createProject).toHaveBeenCalledTimes(1);
  });
});

describe('seedStarterContent', () => {
  it('creates the starter project and its tasks in an organization without projects [PROVN-R5] [PROVN-R6]', async () => {
    const { sql } = recordingSql([ADA]);
    await seedStarterContent(sql, ADA.id);
    expect(h.createProject).toHaveBeenCalledTimes(1);
    expect(h.createTask).toHaveBeenCalled();
    for (const call of h.createTask.mock.calls) {
      expect(call[2]).toMatchObject({ projectId: 'project-1' });
      // Left unassigned: nobody is named as the assignee of an example task.
      expect(call[2]).not.toHaveProperty('assigneeId');
    }
  });

  it('adds nothing to an organization that has a project [PROVN-R5]', async () => {
    const { sql } = recordingSql([{ ...ADA, projects: 1 }]);
    await seedStarterContent(sql, ADA.id);
    expect(h.createProject).not.toHaveBeenCalled();
    expect(h.createTask).not.toHaveBeenCalled();
  });
});
