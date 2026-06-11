import { describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import {
  deriveStepStatuses,
  getExecutionStepStatuses,
  OUTPUT_PREVIEW_MAX_CHARS,
} from './get_execution_step_statuses';

vi.mock('./get_workflow_component', () => ({
  getWorkflowComponentForExecution: vi.fn(() => ({
    journal: { load: 'journal-load' },
  })),
}));

function execution(
  overrides: Partial<Doc<'wfExecutions'>> = {},
): Doc<'wfExecutions'> {
  return {
    _id: 'exec_1' as Id<'wfExecutions'>,
    _creationTime: 0,
    organizationId: 'org_1',
    wfDefinitionId: null,
    status: 'running',
    startedAt: 1000,
    updatedAt: 1000,
    workflowSlug: 'nightly-sync',
    ...overrides,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test fixture; only fields read by the helper are populated
  } as Doc<'wfExecutions'>;
}

function executeStepEntry(
  stepSlug: string,
  step: Record<string, unknown>,
  stepNumber = 1,
) {
  return {
    stepNumber,
    step: {
      name: `${stepSlug} (action)`,
      args: { stepSlug, stepType: 'action', stepName: stepSlug },
      startedAt: 1000,
      completedAt: 2000,
      inProgress: false,
      ...step,
    },
  };
}

describe('deriveStepStatuses', () => {
  it('maps an in-progress executeStep entry to running', () => {
    const result = deriveStepStatuses(
      [
        executeStepEntry('fetch', {
          inProgress: true,
          completedAt: undefined,
        }),
      ],
      execution(),
    );

    expect(result.nodes.fetch).toMatchObject({
      status: 'running',
      attempts: 1,
      startedAt: 1000,
    });
  });

  it('maps a successful executeStep entry to success with its output preview', () => {
    const result = deriveStepStatuses(
      [
        executeStepEntry('fetch', {
          runResult: { kind: 'success', returnValue: { port: 'next' } },
        }),
      ],
      execution({
        variables: JSON.stringify({
          steps: { fetch: { stepType: 'action', output: { rows: 3 } } },
        }),
      }),
    );

    expect(result.nodes.fetch).toMatchObject({
      status: 'success',
      attempts: 1,
      completedAt: 2000,
      outputPreview: JSON.stringify({ rows: 3 }),
    });
    expect(result.nodes.fetch.outputTruncated).toBeUndefined();
  });

  it('maps a failed runResult to failed with the error', () => {
    const result = deriveStepStatuses(
      [
        executeStepEntry('send', {
          runResult: { kind: 'failed', error: 'SMTP unreachable' },
        }),
      ],
      execution({ status: 'failed' }),
    );

    expect(result.nodes.send).toMatchObject({
      status: 'failed',
      error: 'SMTP unreachable',
    });
  });

  it('treats a success runResult routed through the error port as failed', () => {
    const result = deriveStepStatuses(
      [
        executeStepEntry('lookup', {
          runResult: {
            kind: 'success',
            returnValue: { port: 'error', error: 'missing variable' },
          },
        }),
      ],
      execution(),
    );

    expect(result.nodes.lookup).toMatchObject({
      status: 'failed',
      error: 'missing variable',
    });
  });

  it('maps a canceled runResult to canceled', () => {
    const result = deriveStepStatuses(
      [executeStepEntry('fetch', { runResult: { kind: 'canceled' } })],
      execution(),
    );

    expect(result.nodes.fetch.status).toBe('canceled');
  });

  it('maps recordBodyStepFailure entries (stepSlug + error, no stepType) to failed', () => {
    const result = deriveStepStatuses(
      [
        {
          stepNumber: 4,
          step: {
            name: 'recordBodyStepFailure',
            args: {
              executionId: 'exec_1',
              stepSlug: 'body-step',
              stepName: 'Body step',
              error: 'iteration 3 blew up',
            },
            startedAt: 1500,
            completedAt: 1600,
            inProgress: false,
            runResult: { kind: 'success', returnValue: null },
          },
        },
      ],
      execution(),
    );

    expect(result.nodes['body-step']).toMatchObject({
      status: 'failed',
      error: 'iteration 3 blew up',
      stepName: 'Body step',
    });
  });

  it('collapses repeated entries per slug to the latest, counting attempts', () => {
    const result = deriveStepStatuses(
      [
        executeStepEntry(
          'loop-body',
          { runResult: { kind: 'failed', error: 'first try' } },
          1,
        ),
        executeStepEntry(
          'loop-body',
          { runResult: { kind: 'success', returnValue: { port: 'next' } } },
          2,
        ),
      ],
      execution(),
    );

    expect(result.nodes['loop-body']).toMatchObject({
      status: 'success',
      attempts: 2,
    });
    expect(result.nodes['loop-body'].error).toBeUndefined();
  });

  it('ignores framework entries without a stepSlug in args', () => {
    const result = deriveStepStatuses(
      [
        {
          stepNumber: 1,
          step: {
            name: 'updateExecutionStatus',
            args: { executionId: 'exec_1', status: 'running' },
            inProgress: false,
            runResult: { kind: 'success', returnValue: null },
          },
        },
        'not-an-object',
      ],
      execution(),
    );

    expect(result.nodes).toEqual({});
  });

  it('marks the current step as waiting while the execution waits for input', () => {
    const result = deriveStepStatuses(
      [
        executeStepEntry('approval', {
          runResult: { kind: 'success', returnValue: { port: 'next' } },
        }),
      ],
      execution({
        status: 'running',
        waitingFor: 'human_input:approval',
        currentStepSlug: 'approval',
        currentStepName: 'Approval',
      }),
    );

    expect(result.nodes.approval.status).toBe('waiting');
    expect(result.execution.waitingFor).toBe('human_input:approval');
  });

  it('flags outputs as unavailable when variables were offloaded to storage', () => {
    const result = deriveStepStatuses(
      [
        executeStepEntry('fetch', {
          runResult: { kind: 'success', returnValue: { port: 'next' } },
        }),
      ],
      execution({
        variables: JSON.stringify({ _storageRef: 'storage_id_1' }),
      }),
    );

    expect(result.nodes.fetch.outputUnavailable).toBe(true);
    expect(result.nodes.fetch.outputPreview).toBeUndefined();
  });

  it('caps oversized output previews and flags truncation', () => {
    const big = 'x'.repeat(OUTPUT_PREVIEW_MAX_CHARS + 100);
    const result = deriveStepStatuses(
      [
        executeStepEntry('fetch', {
          runResult: { kind: 'success', returnValue: { port: 'next' } },
        }),
      ],
      execution({
        variables: JSON.stringify({
          steps: { fetch: { stepType: 'action', output: big } },
        }),
      }),
    );

    expect(result.nodes.fetch.outputTruncated).toBe(true);
    expect(result.nodes.fetch.outputPreview).toHaveLength(
      OUTPUT_PREVIEW_MAX_CHARS,
    );
  });

  it('returns the execution summary fields', () => {
    const result = deriveStepStatuses(
      [],
      execution({
        status: 'failed',
        error: 'boom',
        currentStepSlug: 'send',
        currentStepName: 'Send',
        completedAt: 5000,
        loopProgress: { current: 2, total: 5 },
      }),
    );

    expect(result.execution).toEqual({
      status: 'failed',
      currentStepSlug: 'send',
      currentStepName: 'Send',
      waitingFor: undefined,
      loopProgress: { current: 2, total: 5 },
      error: 'boom',
      startedAt: 1000,
      completedAt: 5000,
    });
  });
});

describe('getExecutionStepStatuses', () => {
  it('returns null when the execution does not exist', async () => {
    const ctx = {
      db: { get: vi.fn().mockResolvedValue(null) },
      runQuery: vi.fn(),
    };

    const result = await getExecutionStepStatuses(ctx as unknown as QueryCtx, {
      executionId: 'missing' as Id<'wfExecutions'>,
    });

    expect(result).toBeNull();
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('derives node statuses from the loaded journal', async () => {
    const exec = execution({
      componentWorkflowId: 'wf_1',
      variables: JSON.stringify({
        steps: { fetch: { stepType: 'action', output: 'ok' } },
      }),
    });
    const ctx = {
      db: { get: vi.fn().mockResolvedValue(exec) },
      runQuery: vi.fn().mockResolvedValue({
        journalEntries: [
          executeStepEntry('fetch', {
            runResult: { kind: 'success', returnValue: { port: 'next' } },
          }),
        ],
      }),
    };

    const result = await getExecutionStepStatuses(ctx as unknown as QueryCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
    });

    expect(result?.nodes.fetch).toMatchObject({
      status: 'success',
      outputPreview: JSON.stringify('ok'),
    });
  });
});
