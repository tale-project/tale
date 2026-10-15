// @vitest-environment node

/**
 * Standing tasks and project labels as a managed declaration creates and
 * changes them, through the board's own writers (stand-ins here, which
 * their own suites hold): the column a task starts in and never again its
 * status, a person's assignment left alone, and labels created or
 * respelled but never deleted.
 */

import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';

vi.mock('../projects/service.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../projects/service.ts')>();
  return {
    ...actual,
    loadProjectOrThrow: vi.fn(() =>
      Promise.resolve({ id: 'p', name: 'Fleet', archivedAt: null }),
    ),
  };
});
vi.mock('./service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service.ts')>();
  return {
    ...actual,
    assertTaskReadable: vi.fn(),
    assertTaskLabelsEditable: vi.fn(),
    loadTaskOrThrow: vi.fn(),
    createTask: vi.fn(() => Promise.resolve('created')),
    updateTask: vi.fn(),
    assignTask: vi.fn(),
    createTaskLabel: vi.fn(() => Promise.resolve('label')),
    renameTaskLabel: vi.fn(),
  };
});

const service = await import('./service.ts');
const {
  readManagedProjectLabel,
  readManagedTask,
  writeManagedProjectLabel,
  writeManagedTask,
} = await import('./managed-entities.ts');

const PROJECT = '6f1c2a14-4d55-4d61-9b2a-7a5c2e0f3b11';
const TASK = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const AGENT = '0c3d5e8a-1b2c-4d3e-8f9a-0b1c2d3e4f50';
const ada = {
  organizationId: 'org-1',
  userId: 'ada',
  role: 'admin',
  teamIds: [],
};

/** A transaction holding some task ids and a project's labels. */
function database(world: {
  tasks?: string[];
  labels?: Array<{ id: string; name: string }>;
}): TransactionSql {
  const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('SELECT id FROM app.tasks'))
      return Promise.resolve(
        (world.tasks ?? []).includes(String(values[0]))
          ? [{ id: values[0] }]
          : [],
      );
    if (text.includes('FROM app.task_labels') && text.includes('lower(name)'))
      return Promise.resolve(
        (world.labels ?? []).filter(
          (label) =>
            label.name.toLowerCase() === String(values[1]).toLowerCase(),
        ),
      );
    if (text.includes('FROM app.task_labels'))
      return Promise.resolve(world.labels ?? []);
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the managed writers use only the tagged template here
  return query as unknown as TransactionSql;
}

const stored = {
  id: TASK,
  organizationId: 'org-1',
  projectId: PROJECT,
  title: 'Manage the fleet',
  status: 'in_progress',
  priority: 'p1',
  labelIds: ['l-1'],
  assigneeType: 'user',
  assigneeId: 'grace',
} as unknown as Awaited<ReturnType<typeof service.loadTaskOrThrow>>;

const view = {
  projectId: PROJECT,
  taskId: TASK,
  title: 'Manage the fleet',
  labels: ['Release'],
  assigneeAgentId: null,
  priority: 'p1',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('a declared task starts in the column its declaration names, which it never reads again [TASK-R67]', () => {
  it('creates the task under its UUID in its first column, with its description and assignee', async () => {
    await writeManagedTask(database({}), ada, {
      config: {
        projectId: PROJECT,
        taskId: TASK,
        title: 'Manage the fleet',
        labels: ['Release'],
        assigneeAgentId: AGENT,
      },
      expectedHash: null,
      createIfMissing: true,
      initialStatus: 'todo',
      description: 'Keep the fleet moving.',
    });
    expect(service.createTask).toHaveBeenCalledWith(
      expect.anything(),
      ada,
      {
        projectId: PROJECT,
        title: 'Manage the fleet',
        status: 'todo',
        labels: ['Release'],
        assigneeType: 'agent',
        assigneeId: AGENT,
        description: 'Keep the fleet moving.',
      },
      { taskId: TASK },
    );
  });

  it('reads an existing task without its status, a person’s assignment as no agent', async () => {
    vi.mocked(service.loadTaskOrThrow).mockResolvedValueOnce(stored);
    const read = await readManagedTask(
      database({ tasks: [TASK], labels: [{ id: 'l-1', name: 'Release' }] }),
      ada,
      PROJECT,
      TASK,
    );
    expect(read).toEqual({
      config: view,
      hash: managedConfigurationHash(view),
    });
    expect(JSON.stringify(read)).not.toContain('in_progress');
  });

  it('changes a title and priority without the status, and leaves a person’s assignment for a declared `null`', async () => {
    vi.mocked(service.loadTaskOrThrow).mockResolvedValueOnce(stored);
    await writeManagedTask(
      database({ tasks: [TASK], labels: [{ id: 'l-1', name: 'Release' }] }),
      ada,
      {
        config: {
          projectId: PROJECT,
          taskId: TASK,
          title: 'Run the fleet',
          priority: 'p0',
          assigneeAgentId: null,
        },
        expectedHash: managedConfigurationHash(view),
      },
    );
    expect(service.updateTask).toHaveBeenCalledWith(expect.anything(), ada, {
      taskId: TASK,
      title: 'Run the fleet',
      priority: 'p0',
    });
    expect(service.assignTask).not.toHaveBeenCalled();
    expect(service.createTask).not.toHaveBeenCalled();
  });

  it('reads an id nothing holds as absent only when it may create, and creates nothing over a stale hash', async () => {
    await expect(
      readManagedTask(database({}), ada, PROJECT, TASK, true),
    ).resolves.toEqual({ config: null, hash: null });
    vi.mocked(service.loadTaskOrThrow).mockRejectedValueOnce(
      new service.TaskError('TASK_NOT_FOUND', 'Task not found', 404),
    );
    // Held in another organization: not found, never absent.
    await expect(
      readManagedTask(database({ tasks: [TASK] }), ada, PROJECT, TASK, true),
    ).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
    await expect(
      writeManagedTask(database({}), ada, {
        config: { projectId: PROJECT, taskId: TASK, title: 'x' },
        expectedHash: 'c'.repeat(64),
        createIfMissing: true,
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    expect(service.createTask).not.toHaveBeenCalled();
  });
});

describe('a declared label is created or respelled, never deleted [TASK-R68]', () => {
  it('creates a label the project lacks only when the declaration may', async () => {
    await expect(
      readManagedProjectLabel(database({}), ada, PROJECT, 'Release', true),
    ).resolves.toEqual({ config: null, hash: null });
    await expect(
      readManagedProjectLabel(database({}), ada, PROJECT, 'Release'),
    ).rejects.toMatchObject({ code: 'TASK_LABEL_UNKNOWN' });
    await writeManagedProjectLabel(database({}), ada, {
      config: { projectId: PROJECT, name: 'Release' },
      expectedHash: null,
      createIfMissing: true,
    });
    expect(service.createTaskLabel).toHaveBeenCalledWith(
      expect.anything(),
      ada,
      { projectId: PROJECT, name: 'Release' },
    );
  });

  it('respells a label whose case differs, the one the catalog already holds', async () => {
    const labels = [{ id: 'l-1', name: 'release' }];
    const read = await readManagedProjectLabel(
      database({ labels }),
      ada,
      PROJECT,
      'Release',
    );
    expect(read.config).toEqual({ projectId: PROJECT, name: 'release' });
    await writeManagedProjectLabel(database({ labels }), ada, {
      config: { projectId: PROJECT, name: 'Release' },
      expectedHash: read.hash,
    });
    expect(service.renameTaskLabel).toHaveBeenCalledWith(
      expect.anything(),
      ada,
      { labelId: 'l-1', name: 'Release' },
    );
    expect(service.createTaskLabel).not.toHaveBeenCalled();
  });
});
