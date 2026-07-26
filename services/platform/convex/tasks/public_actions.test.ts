import { describe, expect, it, vi } from 'vitest';

import {
  cancelTaskWorkflow,
  createTaskFromExternalIssue,
  mergeTaskPullRequest,
  startTaskWorkflow,
} from './public_actions';

// Mock-ctx idiom (see external_runs/state_machine.test.ts): the generated server
// wrapper returns its config so `.handler` is callable; api/internal refs become
// string sentinels the fake ctx dispatches on; auth is a no-op.
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, action: (config: Record<string, unknown>) => config };
});

vi.mock('../_generated/api', () => ({
  api: {
    projects: {
      queries: {
        getProject: 'getProject',
        listProjects: 'listProjects',
        getProjectSetupFolder: 'getProjectSetupFolder',
      },
    },
    tasks: {
      queries: { getTask: 'getTask' },
      mutations: { updateTaskStatus: 'updateTaskStatus' },
    },
    workflow_executions: {
      actions: { startWorkflowFromFile: 'startWorkflowFromFile' },
      mutations: { cancelExecution: 'cancelExecution' },
    },
  },
  internal: {
    folders: {
      internal_mutations: {
        getOrCreateProjectRootFolder: 'getOrCreateRootFolder',
      },
    },
    tasks: {
      internal_mutations: {
        agentUpsertTaskByExternalRef: 'agentUpsert',
        scheduleTaskWorkflowStart: 'scheduleTaskWorkflowStart',
      },
    },
    automations: {
      mutations: { cancelTaskWorkflowRun: 'cancelTaskWorkflowRun' },
    },
    workflow_executions: {
      internal_queries: { getActiveExecutionForSubject: 'getActive' },
    },
    agent_tools: {
      integrations: {
        internal_actions: { executeIntegration: 'executeIntegration' },
      },
    },
  },
}));

vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: vi.fn(async () => ({ userId: 'user_1' })),
}));

// oxlint-disable-next-line typescript/no-explicit-any -- vi.mock narrows to { handler }
type Handler = { handler: (ctx: unknown, args: unknown) => Promise<any> };

const TASK = {
  _id: 'task_1',
  projectId: 'project_1',
  externalId: 'tale-project/tale#1851',
  title: 'a task',
};

function createCtx(opts: {
  task?: unknown;
  active?: unknown;
  startResult?: string | null;
}) {
  const runActionCalls: Array<{ ref: unknown; args: Record<string, unknown> }> =
    [];
  const runMutationCalls: Array<{
    ref: unknown;
    args: Record<string, unknown>;
  }> = [];
  const ctx = {
    runQuery: vi.fn(async (ref: unknown) => {
      if (ref === 'getTask') return opts.task ?? null;
      if (ref === 'getActive') return opts.active ?? null;
      return null;
    }),
    runAction: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      runActionCalls.push({ ref, args });
      return opts.startResult ?? null;
    }),
    runMutation: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      runMutationCalls.push({ ref, args });
      return null;
    }),
  };
  return { ctx, runActionCalls, runMutationCalls };
}

const ARGS = {
  organizationId: 'org_1',
  taskId: 'task_1',
  workflowSlug: 'issue-desk/desk-process',
};

describe('startTaskWorkflow', () => {
  const handler = (startTaskWorkflow as unknown as Handler).handler;

  it('degrades to not_started while the automation engine is offline', async () => {
    const { ctx, runActionCalls } = createCtx({
      task: { task: TASK },
      active: null,
      startResult: 'exec_new',
    });
    const result = await handler(ctx, ARGS);
    expect(result).toEqual({
      started: false,
      reason: 'not_started',
      executionId: null,
    });
    // Nothing is dispatched to the retired engine.
    expect(runActionCalls).toHaveLength(0);
  });

  it('throws when the task does not exist', async () => {
    const { ctx } = createCtx({ task: null });
    await expect(handler(ctx, ARGS)).rejects.toThrow('Task not found');
  });

  it('never consults the retired execution index for the duplicate-run check', async () => {
    // With the engine offline no run can be active; the pre-check
    // short-circuits instead of querying the retired module.
    const { ctx, runActionCalls } = createCtx({
      task: { task: TASK },
      active: { executionId: 'exec_old', status: 'running' },
    });
    const result = await handler(ctx, ARGS);
    expect(result).toEqual({
      started: false,
      reason: 'not_started',
      executionId: null,
    });
    expect(runActionCalls).toHaveLength(0);
  });

  it('reports not_started when the engine returns null (e.g. uninstalled slug)', async () => {
    const { ctx } = createCtx({
      task: { task: TASK },
      active: null,
      startResult: null,
    });
    const result = await handler(ctx, ARGS);
    expect(result).toEqual({
      started: false,
      reason: 'not_started',
      executionId: null,
    });
  });
});

describe('cancelTaskWorkflow', () => {
  const handler = (cancelTaskWorkflow as unknown as Handler).handler;
  const cancelArgs = { organizationId: 'org_1', taskId: 'task_1' };

  it('consults the run kernel and parks the task when no run is live', async () => {
    const { ctx, runMutationCalls } = createCtx({
      task: { task: { ...TASK, status: 'in_progress' } },
      active: { executionId: 'exec_run', status: 'running' },
    });
    const result = await handler(ctx, cancelArgs);
    expect(result).toEqual({
      taskCancelled: true,
      executionCancelled: false,
      executionId: null,
    });
    expect(runMutationCalls).toEqual([
      {
        ref: 'cancelTaskWorkflowRun',
        args: {
          organizationId: 'org_1',
          projectId: 'project_1',
          taskId: 'task_1',
        },
      },
      {
        ref: 'updateTaskStatus',
        args: { taskId: 'task_1', status: 'cancelled' },
      },
    ]);
  });

  it('parks the task when the kernel reports nothing to cancel', async () => {
    const { ctx, runMutationCalls } = createCtx({
      task: { task: { ...TASK, status: 'in_progress' } },
      active: null,
    });
    const result = await handler(ctx, cancelArgs);
    expect(result).toEqual({
      taskCancelled: true,
      executionCancelled: false,
      executionId: null,
    });
    expect(runMutationCalls).toEqual([
      {
        ref: 'cancelTaskWorkflowRun',
        args: {
          organizationId: 'org_1',
          projectId: 'project_1',
          taskId: 'task_1',
        },
      },
      {
        ref: 'updateTaskStatus',
        args: { taskId: 'task_1', status: 'cancelled' },
      },
    ]);
  });

  it('skips updateTaskStatus when the task is already cancelled', async () => {
    const { ctx, runMutationCalls } = createCtx({
      task: { task: { ...TASK, status: 'cancelled' } },
      active: null,
    });
    const result = await handler(ctx, cancelArgs);
    expect(result.taskCancelled).toBe(true);
    // The kernel is still consulted — a live run must die even when the task
    // row already reads cancelled — but no redundant status write follows.
    expect(runMutationCalls).toEqual([
      {
        ref: 'cancelTaskWorkflowRun',
        args: {
          organizationId: 'org_1',
          projectId: 'project_1',
          taskId: 'task_1',
        },
      },
    ]);
  });

  it('throws when the task does not exist', async () => {
    const { ctx } = createCtx({ task: null });
    await expect(handler(ctx, cancelArgs)).rejects.toThrow('Task not found');
  });
});

function createMergeCtx(opts: {
  task?: unknown;
  pulls?: Array<{ number: number; state?: string; merged_at?: string | null }>;
}) {
  const runActionCalls: Array<{ ref: unknown; args: Record<string, unknown> }> =
    [];
  const runMutationCalls: Array<{
    ref: unknown;
    args: Record<string, unknown>;
  }> = [];
  const ctx = {
    runQuery: vi.fn(async (ref: unknown) =>
      ref === 'getTask' ? (opts.task ?? null) : null,
    ),
    runAction: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      runActionCalls.push({ ref, args });
      // Mirror the executeIntegration return shape: { result: <connectorReturn> }.
      if (args.operation === 'list_pull_requests') {
        return { result: { data: opts.pulls ?? [] } };
      }
      return { result: { data: { merged: true } } };
    }),
    runMutation: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      runMutationCalls.push({ ref, args });
      return null;
    }),
  };
  return { ctx, runActionCalls, runMutationCalls };
}

const MERGE_ARGS = { organizationId: 'org_1', taskId: 'task_1' };

describe('mergeTaskPullRequest', () => {
  const handler = (mergeTaskPullRequest as unknown as Handler).handler;

  it('fails with a typed offline error and leaves the task untouched', async () => {
    // The GitHub connector rides the integrations backend, which is offline
    // while it is rebuilt: the guards above the gate still run, then the
    // action refuses with a typed error and performs no writes.
    const { ctx, runActionCalls, runMutationCalls } = createMergeCtx({
      task: { task: TASK },
      pulls: [{ number: 1913, state: 'open', merged_at: null }],
    });
    await expect(handler(ctx, MERGE_ARGS)).rejects.toThrow(
      /offline while it is rewritten/,
    );
    expect(runActionCalls).toHaveLength(0);
    expect(runMutationCalls).toHaveLength(0);
  });

  it('throws when the task does not exist', async () => {
    const { ctx } = createMergeCtx({ task: null });
    await expect(handler(ctx, MERGE_ARGS)).rejects.toThrow('Task not found');
  });

  it('throws when the task is not linked to a GitHub repository', async () => {
    const { ctx } = createMergeCtx({
      task: { task: { ...TASK, externalId: 'not-a-ref' } },
    });
    await expect(handler(ctx, MERGE_ARGS)).rejects.toThrow(
      /not linked to a GitHub repository/,
    );
  });
});

describe('createTaskFromExternalIssue', () => {
  const handler = (createTaskFromExternalIssue as unknown as Handler).handler;

  function createCreateCtx(opts: {
    upsert?: { taskId: string; created: boolean };
    project?: { _id: string } | null;
  }) {
    const runMutationCalls: Array<{
      ref: unknown;
      args: Record<string, unknown>;
    }> = [];
    const runActionCalls: Array<{
      ref: unknown;
      args: Record<string, unknown>;
    }> = [];
    const ctx = {
      runQuery: vi.fn(async (ref: unknown) => {
        if (ref === 'getProject') return opts.project ?? { _id: 'proj_1' };
        return null;
      }),
      runMutation: vi.fn(
        async (ref: unknown, args: Record<string, unknown>) => {
          runMutationCalls.push({ ref, args });
          if (ref === 'agentUpsert') {
            return opts.upsert ?? { taskId: 'task_new', created: true };
          }
          return null;
        },
      ),
      runAction: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
        runActionCalls.push({ ref, args });
        return null;
      }),
    };
    return { ctx, runMutationCalls, runActionCalls };
  }

  const CREATE_ARGS = {
    organizationId: 'org_1',
    projectId: 'proj_1',
    externalSystem: 'desk-e2e',
    externalId: 'folder_1',
    title: 'Period job — 2025Q4',
    runWorkflowSlug: 'project-files-desk-e2e',
  };

  it('schedules workflow start and does not await startWorkflowFromFile', async () => {
    const { ctx, runMutationCalls, runActionCalls } = createCreateCtx({
      upsert: { taskId: 'task_new', created: true },
    });
    const result = await handler(ctx, CREATE_ARGS);
    expect(result).toEqual({
      taskId: 'task_new',
      created: true,
      executionId: null,
    });
    expect(runActionCalls).toHaveLength(0);
    expect(runMutationCalls.map((c) => c.ref)).toEqual([
      'agentUpsert',
      'scheduleTaskWorkflowStart',
    ]);
    expect(runMutationCalls[1].args).toEqual({
      organizationId: 'org_1',
      taskId: 'task_new',
      workflowSlug: 'project-files-desk-e2e',
      userId: 'user_1',
    });
  });

  it('skips schedule on idempotent re-pick (created=false)', async () => {
    const { ctx, runMutationCalls } = createCreateCtx({
      upsert: { taskId: 'task_old', created: false },
    });
    const result = await handler(ctx, CREATE_ARGS);
    expect(result).toEqual({
      taskId: 'task_old',
      created: false,
      executionId: undefined,
    });
    expect(runMutationCalls.map((c) => c.ref)).toEqual(['agentUpsert']);
  });
});

describe('createTaskFromExternalIssue — ensureFolder', () => {
  const handler = (createTaskFromExternalIssue as unknown as Handler).handler;

  function folderCtx(opts: { setup?: unknown } = {}) {
    const runMutationCalls: Array<{
      ref: unknown;
      args: Record<string, unknown>;
    }> = [];
    const ctx = {
      runQuery: vi.fn(async (ref: unknown) => {
        if (ref === 'getProject') return { _id: 'proj_1' };
        if (ref === 'getProjectSetupFolder') return opts.setup ?? null;
        return null;
      }),
      runAction: vi.fn(async () => null),
      runMutation: vi.fn(
        async (ref: unknown, args: Record<string, unknown>) => {
          runMutationCalls.push({ ref, args });
          if (ref === 'getOrCreateRootFolder') {
            return { folderId: 'folder_q3', created: true };
          }
          if (ref === 'agentUpsert') return { taskId: 'task_9', created: true };
          return null;
        },
      ),
    };
    return { ctx, runMutationCalls };
  }

  const BASE = {
    organizationId: 'org_1',
    projectId: 'proj_1',
    externalSystem: 'vatplus',
    title: 'VAT return — 2026Q3',
  };

  it('creates the root folder, binds it as externalId, and rides setup on externalUrl', async () => {
    const { ctx, runMutationCalls } = folderCtx({
      setup: { _id: 'folder_setup', name: 'Setup' },
    });
    const result = await handler(ctx, {
      ...BASE,
      ensureFolder: { name: '2026Q3', setupFolderName: 'Setup' },
    });
    const ensure = runMutationCalls.find(
      (c) => c.ref === 'getOrCreateRootFolder',
    );
    expect(ensure?.args).toMatchObject({ name: '2026Q3', projectId: 'proj_1' });
    const upsert = runMutationCalls.find((c) => c.ref === 'agentUpsert');
    expect(upsert?.args).toMatchObject({
      externalId: 'folder_q3',
      externalUrl: 'folder_setup',
    });
    expect(result).toMatchObject({
      taskId: 'task_9',
      created: true,
      folderId: 'folder_q3',
    });
  });

  it('fails closed when the named setup folder does not exist yet', async () => {
    const { ctx } = folderCtx({ setup: null });
    await expect(
      handler(ctx, {
        ...BASE,
        ensureFolder: { name: '2026Q3', setupFolderName: 'Setup' },
      }),
    ).rejects.toMatchObject({ data: { code: 'SETUP_FOLDER_MISSING' } });
  });

  it('rejects externalId and ensureFolder together, and neither', async () => {
    const { ctx } = folderCtx();
    await expect(
      handler(ctx, {
        ...BASE,
        externalId: 'folder_x',
        ensureFolder: { name: '2026Q3' },
      }),
    ).rejects.toMatchObject({ data: { code: 'INVALID_ARGUMENTS' } });
    await expect(handler(ctx, { ...BASE })).rejects.toMatchObject({
      data: { code: 'INVALID_ARGUMENTS' },
    });
  });

  it('rejects ensureFolder without an explicit projectId', async () => {
    const { ctx } = folderCtx();
    await expect(
      handler(ctx, {
        ...BASE,
        projectId: undefined,
        ensureFolder: { name: '2026Q3' },
      }),
    ).rejects.toMatchObject({ data: { code: 'INVALID_ARGUMENTS' } });
  });
});
