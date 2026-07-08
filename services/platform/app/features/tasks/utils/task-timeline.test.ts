import { describe, expect, it } from 'vitest';

import { buildTaskActorPreview, WORKFLOW_ACTOR_ID } from './task-actor-preview';
import {
  inferWorkflowContextFromRuns,
  mergeTaskTimeline,
} from './task-timeline';

const labels = {
  unresolvedWorkflow: 'Workflow',
};

describe('mergeTaskTimeline', () => {
  it('sorts entries by timestamp descending', () => {
    const merged = mergeTaskTimeline(
      [
        {
          _id: 'act_1' as never,
          actorType: 'user',
          actorId: 'u1',
          action: 'created',
          createdAt: 100,
        },
      ],
      [
        {
          runId: 'run_1' as never,
          agentSlug: 'writer',
          trigger: 'assignment',
          status: 'completed',
          startedAt: 300,
          costCents: 0,
        },
        {
          runId: 'run_2' as never,
          agentSlug: 'writer',
          trigger: 'mention',
          status: 'completed',
          startedAt: 200,
          costCents: 0,
        },
      ],
    );

    expect(merged.map((e) => e.at)).toEqual([300, 200, 100]);
    expect(merged.map((e) => e.kind)).toEqual([
      'agentRun',
      'agentRun',
      'activity',
    ]);
  });

  it('prefers agent runs before activity at the same timestamp', () => {
    const merged = mergeTaskTimeline(
      [
        {
          _id: 'act_1' as never,
          actorType: 'agent',
          actorId: WORKFLOW_ACTOR_ID,
          action: 'status.changed',
          createdAt: 500,
        },
      ],
      [
        {
          runId: 'run_1' as never,
          agentSlug: 'cmo',
          trigger: 'assignment',
          status: 'completed',
          startedAt: 500,
          costCents: 4,
        },
      ],
    );

    expect(merged.map((e) => e.kind)).toEqual(['agentRun', 'activity']);
  });
});

describe('inferWorkflowContextFromRuns', () => {
  it('borrows workflow context from the nearest agent run', () => {
    const context = inferWorkflowContextFromRuns(1_000, [
      {
        runId: 'run_1' as never,
        agentSlug: 'cmo',
        trigger: 'assignment',
        status: 'completed',
        startedAt: 950,
        costCents: 0,
        workflowSlug: 'task-ops/assignment',
        wfExecutionId: 'exec_1' as never,
      },
    ]);

    expect(context).toEqual({
      workflowSlug: 'task-ops/assignment',
      wfExecutionId: 'exec_1',
    });
  });
});

describe('buildTaskActorPreview', () => {
  const agents = new Map([
    ['writer', { name: 'Writer', description: 'Drafts copy.' }],
  ]);
  const workflows = new Map([
    [
      'task-ops/status-gate',
      { name: 'Status gate', description: 'Moves tasks through review.' },
    ],
  ]);

  it('builds an agent preview with a detail link', () => {
    const preview = buildTaskActorPreview({
      organizationId: 'org_1',
      actorType: 'agent',
      actorId: 'writer',
      agents,
      workflows,
      labels,
    });

    expect(preview).toMatchObject({
      kind: 'agent',
      name: 'Writer',
      description: 'Drafts copy.',
      viewTo: '/dashboard/$id/agents/$agentId',
      viewParams: { id: 'org_1', agentId: 'writer' },
    });
  });

  it('builds a workflow preview from activity context', () => {
    const preview = buildTaskActorPreview({
      organizationId: 'org_1',
      actorType: 'agent',
      actorId: WORKFLOW_ACTOR_ID,
      context: {
        workflowSlug: 'task-ops/status-gate',
        wfExecutionId: 'exec_1',
      },
      agents,
      workflows,
      labels,
    });

    expect(preview).toMatchObject({
      kind: 'workflow',
      name: 'Status gate',
      description: 'Moves tasks through review.',
      viewTo: '/dashboard/$id/automations/$amId',
      viewParams: { id: 'org_1', amId: 'task-ops__status-gate' },
      viewSearch: { execution: 'exec_1' },
    });
  });

  it('omits description when the workflow has none in config', () => {
    const preview = buildTaskActorPreview({
      organizationId: 'org_1',
      actorType: 'agent',
      actorId: WORKFLOW_ACTOR_ID,
      context: { workflowSlug: 'task-ops/bare' },
      agents,
      workflows: new Map([['task-ops/bare', { name: 'Bare workflow' }]]),
      labels,
    });

    expect(preview?.description).toBeUndefined();
    expect(preview?.name).toBe('Bare workflow');
  });

  it('uses the slug base name when the workflow is not in the catalog', () => {
    const preview = buildTaskActorPreview({
      organizationId: 'org_1',
      actorType: 'agent',
      actorId: WORKFLOW_ACTOR_ID,
      context: { workflowSlug: 'task-ops/status-gate' },
      agents,
      workflows: new Map(),
      labels,
    });

    expect(preview?.name).toBe('Status Gate');
    expect(preview?.description).toBeUndefined();
  });

  it('returns null when the workflow cannot be resolved', () => {
    expect(
      buildTaskActorPreview({
        organizationId: 'org_1',
        actorType: 'agent',
        actorId: WORKFLOW_ACTOR_ID,
        agents,
        workflows: new Map(),
        labels,
      }),
    ).toBeNull();
  });

  it('returns null for human actors', () => {
    expect(
      buildTaskActorPreview({
        organizationId: 'org_1',
        actorType: 'user',
        actorId: 'user_1',
        agents,
        workflows,
        labels,
      }),
    ).toBeNull();
  });
});
