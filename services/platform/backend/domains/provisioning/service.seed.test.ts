// @vitest-environment node

/**
 * Provisioning runs when an organization is created and again at every
 * deploy, so it must add what is missing and nothing else: a shipped
 * automation the organization already has is left alone, one it deleted
 * stays deleted, and starter content appears only in an organization that
 * has no project yet.
 */

import { fileURLToPath } from 'node:url';

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  loadSeedablePacks: vi.fn(),
  resolveModelReplacements: vi.fn(),
  saveVersion: vi.fn(),
  setTrigger: vi.fn(),
  createProject: vi.fn(),
  createTask: vi.fn(),
}));

vi.mock('../../core/provisioning/provision_default_automations.ts', () => ({
  loadSeedablePacks: h.loadSeedablePacks,
}));
vi.mock('../automations/model-defaults.ts', () => ({
  resolveModelReplacements: h.resolveModelReplacements,
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

import { PROVISIONING_ORIGIN } from '../../lib/write-origin.ts';
import { seedDefaultAutomationPacks, seedStarterContent } from './service.ts';

interface Organization {
  /** Names of the automations the organization has a version of. */
  automations?: string[];
  /** Names of the automations the organization deleted. */
  deleted?: string[];
  /** Names of the automations the organization has a trigger for. */
  triggers?: string[];
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
      return Promise.resolve(
        (organization.triggers ?? []).includes(name) ? [{ id: 't-1' }] : [],
      );
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

/** The catalog this repository ships, read by the real pack loader. */
const SHIPPED_CATALOG = fileURLToPath(
  new URL('../../../../../configs/platform/custom', import.meta.url),
);

describe('seedDefaultAutomationPacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.resolveModelReplacements.mockResolvedValue(new Map());
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
        origin: PROVISIONING_ORIGIN,
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

  it('adds a shipped trigger switched off unless the pack turns it on, and only where none is bound [PROVN-R7]', async () => {
    h.loadSeedablePacks.mockReturnValue([
      {
        ...pack('ops/sync'),
        trigger: {
          kind: 'schedule',
          repeat: { frequency: 'minutely', interval: 5 },
          timezone: 'UTC',
        },
      },
      { ...pack('ops/hook'), trigger: { kind: 'webhook', enabled: true } },
      {
        ...pack('ops/kept'),
        trigger: { kind: 'event', event: 'contact.created' },
      },
    ]);
    const { sql } = organizationSql({ triggers: ['ops/kept'] });
    await seedDefaultAutomationPacks(sql, 'org-1');
    expect(h.setTrigger.mock.calls.map((call) => call[1])).toEqual([
      {
        organizationId: 'org-1',
        name: 'ops/sync',
        trigger: {
          kind: 'schedule',
          repeat: { frequency: 'minutely', interval: 5 },
          timezone: 'UTC',
          enabled: false,
        },
        origin: PROVISIONING_ORIGIN,
      },
      {
        organizationId: 'org-1',
        name: 'ops/hook',
        trigger: { kind: 'webhook', enabled: true },
        origin: PROVISIONING_ORIGIN,
      },
    ]);
  });
});

describe('an organization created before the issue intake shipped', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.resolveModelReplacements.mockResolvedValue(new Map());
  });

  it('is given the intake packs and no version of the importers it has [PROVN-R1] [PROVN-R2]', async () => {
    const actual = await vi.importActual<
      typeof import('../../core/provisioning/provision_default_automations.ts')
    >('../../core/provisioning/provision_default_automations.ts');
    const shipped = actual.loadSeedablePacks({ root: SHIPPED_CATALOG }) ?? [];
    h.loadSeedablePacks.mockReturnValue(shipped);
    const before = shipped
      .map((candidate) => candidate.document.name ?? '')
      .filter((name) => !name.startsWith('issues-intake'));
    expect(before).toEqual(
      expect.arrayContaining([
        'github-import-issues',
        'glitchtip-import-issues',
      ]),
    );
    const { sql } = organizationSql({ automations: before });
    expect(await seedDefaultAutomationPacks(sql, 'org-1')).toEqual({
      provisioned: ['issues-intake', 'issues-intake-source'],
      skipped: before,
    });
    expect(h.saveVersion.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({
        name: 'issues-intake',
        origin: PROVISIONING_ORIGIN,
      }),
      expect.objectContaining({
        name: 'issues-intake-source',
        origin: PROVISIONING_ORIGIN,
      }),
    ]);
  });
});

describe("a shipped pack's model [PROVN-R8]", () => {
  const triage = (name: string) => ({
    document: {
      version: 1,
      name,
      nodes: [
        { id: 'fetch', type: 'transform', code: 'return {}' },
        { id: 'score', type: 'llm', model: 'anthropic/claude-haiku-4-5' },
      ],
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    h.resolveModelReplacements.mockResolvedValue(new Map());
    h.loadSeedablePacks.mockReturnValue([
      triage('gmail/triage-inbox'),
      triage('outlook/triage-inbox'),
    ]);
  });

  it('is replaced by one the organization serves, and the version says so', async () => {
    h.resolveModelReplacements.mockResolvedValue(
      new Map([['anthropic/claude-haiku-4-5', 'gpt-5-mini']]),
    );
    const { sql } = organizationSql({});
    await seedDefaultAutomationPacks(sql, 'org-1');
    // Asked once for the model, however many packs name it.
    expect(h.resolveModelReplacements).toHaveBeenCalledTimes(1);
    expect(h.resolveModelReplacements).toHaveBeenCalledWith(sql, 'org-1', [
      'anthropic/claude-haiku-4-5',
    ]);
    const saved = h.saveVersion.mock.calls.map((call) => call[1]);
    expect(saved).toHaveLength(2);
    for (const version of saved) {
      expect(version).toMatchObject({
        message:
          "Shipped default pack. Model anthropic/claude-haiku-4-5 isn't served here; using gpt-5-mini.",
        document: {
          nodes: [
            { id: 'fetch' },
            { id: 'score', type: 'llm', model: 'gpt-5-mini' },
          ],
        },
      });
    }
  });

  it('stays as shipped when it is served, or nothing could replace it', async () => {
    const { sql } = organizationSql({});
    await seedDefaultAutomationPacks(sql, 'org-1');
    expect(h.saveVersion.mock.calls[0]?.[1]).toMatchObject({
      message: 'Shipped default pack',
      document: {
        nodes: [{ id: 'fetch' }, { model: 'anthropic/claude-haiku-4-5' }],
      },
    });
  });

  it('is never looked at for a pack the organization already has', async () => {
    const { sql } = organizationSql({
      automations: ['gmail/triage-inbox', 'outlook/triage-inbox'],
    });
    await seedDefaultAutomationPacks(sql, 'org-1');
    expect(h.resolveModelReplacements).not.toHaveBeenCalled();
    expect(h.saveVersion).not.toHaveBeenCalled();
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
