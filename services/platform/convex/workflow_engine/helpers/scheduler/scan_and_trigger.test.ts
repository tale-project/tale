import { getFunctionName } from 'convex/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { ActionCtx } from '../../../_generated/server';
import { scanAndTrigger } from './scan_and_trigger';

/**
 * #2607 — the project chosen at install/bind time lives on the schedule ROW
 * (`wfSchedules.projectId`), not necessarily in its `variables`. A cron tick
 * must still merge it into the fire-time `input` (`effectiveScheduleInput`,
 * already exhaustively unit-tested in `automations/schedule_variables.test.ts`);
 * this test proves `scanAndTrigger` actually WIRES that merge in, end to end.
 *
 * `shouldTriggerWorkflow` and `resolveOrgSlug` are mocked out — their own
 * behaviour is covered by their own unit tests — so this test isolates the
 * merge wiring, not cron-window arithmetic or org-slug lookup. Convex's
 * generated `internal` api is a proxy that returns a fresh reference on every
 * access, so dispatch/assert by `getFunctionName()`, not `===` (see the
 * sibling `document_action_link_file.test.ts` for the same pattern).
 */

vi.mock('../../../organizations/resolve_org_slug', () => ({
  resolveOrgSlug: vi.fn().mockResolvedValue('acme-org'),
}));

vi.mock('./should_trigger_workflow', () => ({
  shouldTriggerWorkflow: vi.fn().mockResolvedValue(true),
}));

interface MockScheduleRow {
  _id: string;
  projectId?: string;
}

function createMockCtx(options: {
  scheduled: {
    workflowSlug: string;
    organizationId: string;
    name: string;
    schedule: string;
    timezone: string;
    scheduleId: string;
    variables?: Record<string, unknown>;
  }[];
  rows: MockScheduleRow[];
}) {
  const runQuery = vi.fn((fn: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(fn);
    if (name.includes('getScheduledWorkflows')) {
      return Promise.resolve(options.scheduled);
    }
    if (name.includes('getLastExecutionTimes')) {
      return Promise.resolve({});
    }
    if (name.includes('getRunningExecutions')) {
      return Promise.resolve({});
    }
    if (name.includes('getSchedulesBySlugInternal')) {
      return Promise.resolve(options.rows);
    }
    throw new Error(`scanAndTrigger.test: unexpected runQuery ref ${name}`);
  });
  const runAction = vi.fn().mockResolvedValue(undefined);
  const runMutation = vi.fn().mockResolvedValue(undefined);
  return {
    ctx: { runQuery, runAction, runMutation } as never as ActionCtx,
    runAction,
  };
}

/** The `input` argument of the one `startWorkflowFromFile` call, or throws. */
function startedInput(runAction: ReturnType<typeof vi.fn>): unknown {
  const call = runAction.mock.calls.find(([fn]) =>
    getFunctionName(fn as Parameters<typeof getFunctionName>[0]).includes(
      'startWorkflowFromFile',
    ),
  );
  if (!call) throw new Error('startWorkflowFromFile was never called');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only narrowing of the mock's captured args
  return (call[1] as { input: unknown }).input;
}

describe('scanAndTrigger — schedule row projectId merge (#2607)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fills input.projectId from the schedule row when the variables carry none', async () => {
    const { ctx, runAction } = createMockCtx({
      scheduled: [
        {
          workflowSlug: 'triage',
          organizationId: 'org_1',
          name: 'Triage issues',
          schedule: '*/5 * * * *',
          timezone: 'UTC',
          scheduleId: 'sched_1',
          variables: { owner: 'acme', projectId: '' },
        },
      ],
      rows: [{ _id: 'sched_1', projectId: 'proj_1' }],
    });

    await scanAndTrigger(ctx);

    expect(startedInput(runAction)).toEqual({
      owner: 'acme',
      projectId: 'proj_1',
    });
  });

  it('never overrides an operator-set projectId already in the variables', async () => {
    const { ctx, runAction } = createMockCtx({
      scheduled: [
        {
          workflowSlug: 'triage',
          organizationId: 'org_1',
          name: 'Triage issues',
          schedule: '*/5 * * * *',
          timezone: 'UTC',
          scheduleId: 'sched_1',
          variables: { owner: 'acme', projectId: 'chosen-by-operator' },
        },
      ],
      rows: [{ _id: 'sched_1', projectId: 'proj_1' }],
    });

    await scanAndTrigger(ctx);

    expect(startedInput(runAction)).toEqual({
      owner: 'acme',
      projectId: 'chosen-by-operator',
    });
  });

  it('leaves input.projectId unset when neither the variables nor the row carry one', async () => {
    const { ctx, runAction } = createMockCtx({
      scheduled: [
        {
          workflowSlug: 'triage',
          organizationId: 'org_1',
          name: 'Triage issues',
          schedule: '*/5 * * * *',
          timezone: 'UTC',
          scheduleId: 'sched_1',
          variables: { owner: 'acme' },
        },
      ],
      rows: [{ _id: 'sched_1' }],
    });

    await scanAndTrigger(ctx);

    expect(startedInput(runAction)).toEqual({ owner: 'acme' });
  });
});
