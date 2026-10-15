// @vitest-environment node

/**
 * Projects and project agents as a managed declaration creates and changes
 * them, through the project's own writers (stand-ins here, which their own
 * suites hold): what a declaration may create and under which id, what it
 * reads back, and that it compares the hash its plan read before it writes.
 */

import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';

vi.mock('./service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service.ts')>();
  return {
    ...actual,
    loadProjectOrThrow: vi.fn(),
    assertReadable: vi.fn(),
    assertCanCreateProjects: vi.fn(),
    createProject: vi.fn(() => Promise.resolve('created')),
    updateProjectIdentity: vi.fn(),
    updateProjectSharing: vi.fn(),
    getProjectAgent: vi.fn(() => Promise.resolve(null)),
    createProjectAgent: vi.fn(() => Promise.resolve('created')),
    updateProjectAgent: vi.fn(),
  };
});
vi.mock('../tasks/service.ts', () => ({
  ensureDefaultProjectLabels: vi.fn(),
}));

const service = await import('./service.ts');
const tasks = await import('../tasks/service.ts');
const {
  managedProjectAgentView,
  managedProjectView,
  readManagedProject,
  readManagedProjectAgent,
  writeManagedProject,
  writeManagedProjectAgent,
} = await import('./managed-entities.ts');

const PROJECT = '6f1c2a14-4d55-4d61-9b2a-7a5c2e0f3b11';
const AGENT = '0c3d5e8a-1b2c-4d3e-8f9a-0b1c2d3e4f50';
const ada = {
  organizationId: 'org-1',
  userId: 'ada',
  role: 'admin',
  teamIds: [],
};

/** A transaction whose `SELECT id …` reads answer the ids it holds. */
function database(held: string[] = []): TransactionSql {
  const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('SELECT id FROM app.'))
      return Promise.resolve(
        held.includes(String(values[0])) ? [{ id: values[0] }] : [],
      );
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the managed writers use only the tagged template here
  return query as unknown as TransactionSql;
}

const fleet = {
  id: PROJECT,
  organizationId: 'org-1',
  name: 'Fleet',
  description: null,
  teamIds: [],
} as unknown as Awaited<ReturnType<typeof service.loadProjectOrThrow>>;

const manager = {
  id: AGENT,
  organizationId: 'org-1',
  projectId: PROJECT,
  name: 'Manager',
  harness: 'codex',
  model: 'stored-model',
  modelProvider: 'example',
  skills: ['pdf'],
  connectors: [],
  tools: ['task_get'],
  secrets: ['B', 'A'],
  instructions: 'Stored policy',
  managed: false,
  createdBy: 'ada',
  createdAt: 1,
  updatedAt: 2,
  handle: 'manager',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('a declaration creates a project under the id it chooses, or changes the one there [PROJ-R21]', () => {
  it('reads an id nothing holds as absent only when the declaration may create it', async () => {
    await expect(
      readManagedProject(database(), ada, PROJECT, true),
    ).resolves.toEqual({ config: null, hash: null });
    // An id some project holds — in another organization too — is read
    // through the project's own gate, which answers not found there.
    vi.mocked(service.loadProjectOrThrow).mockResolvedValueOnce(fleet);
    vi.mocked(service.assertReadable).mockImplementationOnce(() => {
      throw new service.ProjectError('PROJECT_NOT_FOUND', 'Not found', 404);
    });
    await expect(
      readManagedProject(database([PROJECT]), ada, PROJECT, true),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('creates the project under its UUID with the labels a new project gets, and its key', async () => {
    await writeManagedProject(database(), ada, {
      config: { projectId: PROJECT, name: 'Fleet', teamIds: ['team-a'] },
      expectedHash: null,
      createIfMissing: true,
      key: 'FLT',
    });
    expect(service.assertCanCreateProjects).toHaveBeenCalledWith(ada);
    expect(service.createProject).toHaveBeenCalledWith(
      expect.anything(),
      ada,
      { name: 'Fleet', teamIds: ['team-a'], key: 'FLT' },
      { projectId: PROJECT },
    );
    expect(tasks.ensureDefaultProjectLabels).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'org-1', projectId: PROJECT, createdBy: 'ada' },
    );
  });

  it('creates nothing it was not asked to, and nothing over a hash it did not read', async () => {
    await expect(
      writeManagedProject(database(), ada, {
        config: { projectId: PROJECT, name: 'Fleet' },
        expectedHash: null,
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    await expect(
      writeManagedProject(database(), ada, {
        config: { projectId: PROJECT, name: 'Fleet' },
        expectedHash: 'a'.repeat(64),
        createIfMissing: true,
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    expect(service.createProject).not.toHaveBeenCalled();
  });

  it('changes an existing project through its writers, its teams only when stated', async () => {
    vi.mocked(service.loadProjectOrThrow).mockResolvedValue(fleet);
    const hash = managedConfigurationHash(managedProjectView(fleet));
    await writeManagedProject(database([PROJECT]), ada, {
      config: { projectId: PROJECT, name: 'Fleet ops' },
      expectedHash: hash,
    });
    expect(service.updateProjectIdentity).toHaveBeenCalledWith(
      expect.anything(),
      ada,
      { projectId: PROJECT, name: 'Fleet ops' },
    );
    expect(service.updateProjectSharing).not.toHaveBeenCalled();
    expect(service.createProject).not.toHaveBeenCalled();
    await expect(
      writeManagedProject(database([PROJECT]), ada, {
        config: { projectId: PROJECT, name: 'Fleet ops', teamIds: [] },
        expectedHash: 'b'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
  });
});

describe('a declared agent is created with the runtime and model its declaration names [PROJ-R22]', () => {
  const declared = {
    projectId: PROJECT,
    agentId: AGENT,
    name: 'Manager',
    secrets: ['GITHUB_TOKEN'],
  };

  it('creates it whole under its UUID from the seed, refusing a secret the organization lacks', async () => {
    await writeManagedProjectAgent(database(), ada, {
      config: declared,
      expectedHash: null,
      createIfMissing: true,
      seed: {
        harness: 'codex',
        model: 'example-model',
        modelProvider: 'example',
        instructions: 'Manage.',
        tools: ['task_get'],
      },
    });
    expect(service.createProjectAgent).toHaveBeenCalledWith(
      expect.anything(),
      ada,
      {
        projectId: PROJECT,
        name: 'Manager',
        harness: 'codex',
        model: 'example-model',
        modelProvider: 'example',
        skills: [],
        connectors: [],
        secrets: ['GITHUB_TOKEN'],
        instructions: 'Manage.',
        tools: ['task_get'],
        unknownSecrets: 'refuse',
      },
      { agentId: AGENT },
    );
  });

  it('never creates an agent without the runtime and model it runs on', async () => {
    await expect(
      writeManagedProjectAgent(database(), ada, {
        config: declared,
        expectedHash: null,
        createIfMissing: true,
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_AGENT_SEED_REQUIRED' });
    expect(service.createProjectAgent).not.toHaveBeenCalled();
  });

  it('changes an existing agent’s name and stated equipment alone, keeping its runtime, model, instructions and tools', async () => {
    vi.mocked(service.getProjectAgent).mockResolvedValueOnce(manager);
    const view = managedProjectAgentView(manager);
    expect(view).toEqual({
      projectId: PROJECT,
      agentId: AGENT,
      name: 'Manager',
      connectors: [],
      secrets: ['A', 'B'],
      skills: ['pdf'],
    });
    await writeManagedProjectAgent(database([AGENT]), ada, {
      config: { ...declared, name: 'Fleet manager' },
      expectedHash: managedConfigurationHash(view),
    });
    expect(service.updateProjectAgent).toHaveBeenCalledWith(
      expect.anything(),
      ada,
      {
        agentId: AGENT,
        name: 'Fleet manager',
        harness: 'codex',
        model: 'stored-model',
        modelProvider: 'example',
        skills: ['pdf'],
        connectors: [],
        tools: ['task_get'],
        secrets: ['GITHUB_TOKEN'],
        instructions: 'Stored policy',
        unknownSecrets: 'refuse',
      },
    );
  });

  it('reads an agent id nothing holds as absent only for a declaration that may create it', async () => {
    await expect(
      readManagedProjectAgent(database(), ada, PROJECT, AGENT, true),
    ).resolves.toEqual({ config: null, hash: null });
    await expect(
      readManagedProjectAgent(database([AGENT]), ada, PROJECT, AGENT, true),
    ).rejects.toMatchObject({ code: 'PROJECT_AGENT_NOT_FOUND' });
    await expect(
      readManagedProjectAgent(database(), ada, PROJECT, AGENT),
    ).rejects.toMatchObject({ code: 'PROJECT_AGENT_NOT_FOUND' });
  });
});
