// @vitest-environment node

/**
 * Provisioning runs when an organization is created and again at every
 * deploy, so it must add what is missing and nothing else: a shipped
 * automation the organization already has is left alone, one it deleted
 * stays deleted, and starter content appears only in an organization that
 * has no project yet.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  loadSeedablePacks: vi.fn(),
  saveVersion: vi.fn(),
  setTrigger: vi.fn(),
  createProject: vi.fn(),
  createTask: vi.fn(),
}));

vi.mock('../../core/provisioning/provision_default_automations.ts', () => ({
  loadSeedablePacks: h.loadSeedablePacks,
}));
vi.mock('../automations/store.ts', () => ({
  saveVersion: h.saveVersion,
  setTrigger: h.setTrigger,
}));
vi.mock('../projects/service.ts', () => ({
  getProjectAuthContext: vi.fn(() => Promise.resolve({ role: 'owner' })),
  createProject: h.createProject,
  updateProjectInstructions: vi.fn(),
}));
vi.mock('../tasks/service.ts', () => ({ createTask: h.createTask }));

import { seedDefaultAutomationPacks, seedStarterContent } from './service.ts';

interface Organization {
  /** Names of the automations the organization has a version of. */
  automations?: string[];
  /** Names of the automations the organization deleted. */
  deleted?: string[];
  projects?: number;
}

/** A `sql` that answers provisioning's reads from one organization. */
function organizationSql(organization: Organization): {
  sql: Sql;
  writes: string[];
} {
  const writes: string[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    const name = String(values[1]);
    if (text.startsWith('SELECT id, presentation FROM app.automations')) {
      return Promise.resolve(
        (organization.automations ?? []).includes(name)
          ? [{ id: 'a-1', presentation: null }]
          : [],
      );
    }
    if (text.startsWith('SELECT name FROM app.automation_tombstones')) {
      return Promise.resolve(
        (organization.deleted ?? []).includes(name) ? [{ name }] : [],
      );
    }
    if (text.startsWith('SELECT id FROM app.automation_triggers')) {
      return Promise.resolve([]);
    }
    if (text.startsWith('SELECT count(*)::text AS count FROM app.projects')) {
      return Promise.resolve([{ count: String(organization.projects ?? 0) }]);
    }
    writes.push(text);
    return Promise.resolve([]);
  };
  Object.assign(tag, {
    json: (value: unknown) => value,
    begin: (work: (tx: unknown) => Promise<unknown>) => work(tag),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: tag as unknown as Sql, writes };
}

const pack = (name: string) => ({ document: { name } });

describe('seedDefaultAutomationPacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.loadSeedablePacks.mockReturnValue([
      pack('ops/daily'),
      pack('ops/weekly'),
    ]);
  });

  it('gives an organization every shipped automation it does not have [PROVN-R1]', async () => {
    const { sql } = organizationSql({});
    expect(await seedDefaultAutomationPacks(sql, 'org-1')).toEqual({
      provisioned: ['ops/daily', 'ops/weekly'],
      skipped: [],
    });
    expect(h.saveVersion.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        name: 'ops/daily',
        actor: 'system:provisioning',
      }),
      expect.objectContaining({ name: 'ops/weekly' }),
    ]);
  });

  it('adds no second version of an automation the organization already has [PROVN-R2]', async () => {
    const { sql, writes } = organizationSql({ automations: ['ops/daily'] });
    expect(await seedDefaultAutomationPacks(sql, 'org-1')).toEqual({
      provisioned: ['ops/weekly'],
      skipped: ['ops/daily'],
    });
    expect(h.saveVersion).toHaveBeenCalledTimes(1);
    expect(h.saveVersion.mock.calls[0]?.[1]).toMatchObject({
      name: 'ops/weekly',
    });
    expect(writes).toEqual([]);
  });

  it('never brings back an automation the organization deleted [PROVN-R3]', async () => {
    const { sql } = organizationSql({ deleted: ['ops/daily'] });
    expect(await seedDefaultAutomationPacks(sql, 'org-1')).toEqual({
      provisioned: ['ops/weekly'],
      skipped: ['ops/daily'],
    });
    expect(
      h.saveVersion.mock.calls.map(
        (call) => (call[1] as { name: string }).name,
      ),
    ).toEqual(['ops/weekly']);
  });
});

describe('seedStarterContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.createProject.mockResolvedValue('project-1');
  });

  it('creates the starter project and its tasks in an organization without projects [PROVN-R5] [PROVN-R6]', async () => {
    const { sql } = organizationSql({ projects: 0 });
    await seedStarterContent(sql, 'org-1');
    expect(h.createProject).toHaveBeenCalledTimes(1);
    expect(h.createTask).toHaveBeenCalled();
    for (const call of h.createTask.mock.calls) {
      expect(call[2]).toMatchObject({ projectId: 'project-1' });
      // Left unassigned: nobody is named as the assignee of an example task.
      expect(call[2]).not.toHaveProperty('assigneeId');
    }
  });

  it('adds nothing to an organization that has a project [PROVN-R5]', async () => {
    const { sql } = organizationSql({ projects: 1 });
    await seedStarterContent(sql, 'org-1');
    expect(h.createProject).not.toHaveBeenCalled();
    expect(h.createTask).not.toHaveBeenCalled();
  });
});
