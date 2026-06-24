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

  it('treats a success runResult on the internal running port as still running (durable sandbox handoff)', () => {
    // A durable sandbox step hands off across each <10-min action boundary by
    // returning on the internal `running` control port. The action resolves
    // `success`, but the STEP is still executing — it must read `running` so
    // the run view keeps the live transcript instead of flashing the
    // `{status:'running'}` handoff envelope as raw JSON.
    const result = deriveStepStatuses(
      [
        executeStepEntry('implement', {
          args: {
            stepSlug: 'implement',
            stepType: 'sandbox',
            stepName: 'implement',
          },
          runResult: {
            kind: 'success',
            returnValue: { port: 'running' },
          },
        }),
      ],
      execution({
        currentStepSlug: 'implement',
        variables: JSON.stringify({
          steps: {
            implement: {
              stepType: 'sandbox',
              output: {
                type: 'sandbox',
                data: { mode: 'agent', ok: false, status: 'running' },
              },
            },
          },
        }),
      }),
    );

    expect(result.nodes.implement).toMatchObject({ status: 'running' });
  });

  it('maps a success runResult on the internal awaiting_capacity port to queued (park-on-capacity)', () => {
    // A durable sandbox step parked behind the org's concurrency cap returns on
    // the internal `awaiting_capacity` control port. Like `running` it is NOT
    // terminal — it must read `queued` so the run view shows the queued
    // affordance, not a "Done" badge + the raw envelope as JSON.
    const result = deriveStepStatuses(
      [
        executeStepEntry('implement', {
          args: {
            stepSlug: 'implement',
            stepType: 'sandbox',
            stepName: 'implement',
          },
          runResult: {
            kind: 'success',
            returnValue: { port: 'awaiting_capacity' },
          },
        }),
      ],
      execution({ currentStepSlug: 'implement' }),
    );

    expect(result.nodes.implement).toMatchObject({ status: 'queued' });
  });

  it('holds the badge at queued across a poll seam: an in-progress segment under the capacity marker reads queued, not running', () => {
    // The flicker fix: while parked, each ~4s poll segment goes briefly
    // in-progress (→ would read `running`). The sticky `awaitingCapacityStepSlug`
    // marker on the execution row pins the badge at `queued` so it never flickers
    // Running↔Queued between segments.
    const result = deriveStepStatuses(
      [
        executeStepEntry('implement', {
          args: {
            stepSlug: 'implement',
            stepType: 'sandbox',
            stepName: 'implement',
          },
          inProgress: true,
        }),
      ],
      execution({
        currentStepSlug: 'implement',
        awaitingCapacityStepSlug: 'implement',
      }),
    );

    expect(result.nodes.implement).toMatchObject({ status: 'queued' });
  });

  it('drops the capacity marker override once real work resumes (no marker → running)', () => {
    // After admission the marker is cleared, so the same in-progress segment now
    // reads `running` (the agent is actually working).
    const result = deriveStepStatuses(
      [
        executeStepEntry('implement', {
          args: {
            stepSlug: 'implement',
            stepType: 'sandbox',
            stepName: 'implement',
          },
          inProgress: true,
        }),
      ],
      execution({ currentStepSlug: 'implement' }),
    );

    expect(result.nodes.implement).toMatchObject({ status: 'running' });
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

  it('marks the current step as paused while the execution is debug-paused', () => {
    const result = deriveStepStatuses(
      [
        executeStepEntry('fetch', {
          runResult: { kind: 'success', returnValue: { port: 'next' } },
        }),
      ],
      execution({
        status: 'running',
        waitingFor: 'debug:2:send-email',
        currentStepSlug: 'send-email',
        currentStepName: 'Send email',
      }),
    );

    // The paused node has not executed yet, so it has no journal entry —
    // the overlay synthesizes it from the execution row.
    expect(result.nodes['send-email']).toMatchObject({
      status: 'paused',
      stepName: 'Send email',
      attempts: 0,
    });
    expect(result.nodes.fetch.status).toBe('success');
    expect(result.execution.waitingFor).toBe('debug:2:send-email');
  });

  it('settles a still-running step to canceled once the run was stopped (stale inProgress entry)', () => {
    // User Stop → cancelExecution flips the row to 'failed'/'canceled' but never
    // writes a terminal runResult to the abandoned step's journal entry, which
    // stays inProgress. Without reconciliation the node would read `running`
    // forever and the run view would keep flashing the "Running"/"Live" badge.
    const result = deriveStepStatuses(
      [
        executeStepEntry('implement', {
          args: {
            stepSlug: 'implement',
            stepType: 'sandbox',
            stepName: 'Implement the fix',
          },
          inProgress: true,
          completedAt: undefined,
        }),
      ],
      execution({
        status: 'failed',
        errorCode: 'canceled',
        error: 'Cancelled by user',
        currentStepSlug: 'implement',
      }),
    );

    expect(result.nodes.implement).toMatchObject({
      status: 'canceled',
      error: 'Cancelled by user',
    });
  });

  it('settles a durable-sandbox handoff (port:running) step to canceled when the run was stopped', () => {
    // The durable sandbox step crosses each action boundary on the internal
    // `running` port; a Stop in that window leaves a success/port:running entry
    // that would otherwise still read `running`.
    const result = deriveStepStatuses(
      [
        executeStepEntry('implement', {
          args: {
            stepSlug: 'implement',
            stepType: 'sandbox',
            stepName: 'Implement the fix',
          },
          runResult: { kind: 'success', returnValue: { port: 'running' } },
        }),
      ],
      execution({
        status: 'failed',
        errorCode: 'canceled',
        error: 'Cancelled by user',
        currentStepSlug: 'implement',
      }),
    );

    expect(result.nodes.implement.status).toBe('canceled');
  });

  it("synthesizes a settled current-step node when its journal entry was GC'd after a stop", () => {
    // ~10s after the stop the component workflow journal is cleaned up, so the
    // journal is empty. The current step must still settle to canceled rather
    // than fall back to a loading skeleton.
    const result = deriveStepStatuses(
      [],
      execution({
        status: 'failed',
        errorCode: 'canceled',
        error: 'Cancelled by user',
        currentStepSlug: 'implement',
        currentStepName: 'Implement the fix',
      }),
    );

    expect(result.nodes.implement).toMatchObject({
      status: 'canceled',
      stepName: 'Implement the fix',
      error: 'Cancelled by user',
      attempts: 0,
    });
  });

  it('does not borrow a generic failure reason onto stranded sibling steps', () => {
    // A non-cancel hard failure: the failing step keeps its own error; a sibling
    // still in progress settles to canceled WITHOUT inheriting the run error.
    const result = deriveStepStatuses(
      [
        executeStepEntry('send', {
          runResult: { kind: 'failed', error: 'SMTP unreachable' },
        }),
        executeStepEntry('notify', {
          inProgress: true,
          completedAt: undefined,
        }),
      ],
      execution({ status: 'failed', error: 'SMTP unreachable' }),
    );

    expect(result.nodes.send).toMatchObject({
      status: 'failed',
      error: 'SMTP unreachable',
    });
    expect(result.nodes.notify.status).toBe('canceled');
    expect(result.nodes.notify.error).toBeUndefined();
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
      organizationId: 'org_1',
      workflowSlug: 'nightly-sync',
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
