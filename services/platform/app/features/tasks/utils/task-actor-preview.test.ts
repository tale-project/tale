import { describe, expect, it } from 'vitest';

import {
  SYSTEM_ACTOR_ID,
  WORKFLOW_ACTOR_ID,
  buildTaskActorPreview,
  isDispatchSentinel,
  isPreviewableTaskActor,
  isSystemSentinel,
} from './task-actor-preview';

describe('task-actor-preview dispatch sentinel', () => {
  it('recognises the project’s dispatch, which is no agent to preview', () => {
    expect(isDispatchSentinel('agent', 'dispatch')).toBe(true);
    expect(isDispatchSentinel('user', 'dispatch')).toBe(false);
    expect(isDispatchSentinel('agent', SYSTEM_ACTOR_ID)).toBe(false);
    expect(isPreviewableTaskActor('agent', 'dispatch')).toBe(false);
    expect(
      buildTaskActorPreview({
        organizationId: 'org_1',
        actorType: 'agent',
        actorId: 'dispatch',
        agents: new Map(),
        workflows: new Map(),
        labels: {
          unresolvedWorkflow: 'Workflow',
          deletedAgent: 'Deleted agent',
        },
      }),
    ).toBeNull();
  });
});

describe('task-actor-preview system sentinel', () => {
  it('recognises the provisioning system actor', () => {
    expect(isSystemSentinel('agent', SYSTEM_ACTOR_ID)).toBe(true);
    expect(isSystemSentinel('agent', WORKFLOW_ACTOR_ID)).toBe(false);
    expect(isSystemSentinel('user', SYSTEM_ACTOR_ID)).toBe(false);
  });

  it('does not offer a preview link for the system actor', () => {
    expect(isPreviewableTaskActor('agent', SYSTEM_ACTOR_ID)).toBe(false);
    expect(
      buildTaskActorPreview({
        organizationId: 'org_1',
        actorType: 'agent',
        actorId: SYSTEM_ACTOR_ID,
        agents: new Map(),
        workflows: new Map(),
        labels: {
          unresolvedWorkflow: 'Workflow',
          deletedAgent: 'Deleted agent',
        },
      }),
    ).toBeNull();
  });
});
