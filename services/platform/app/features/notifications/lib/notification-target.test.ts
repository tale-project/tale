import { describe, expect, it } from 'vitest';

import {
  orgNotificationTarget,
  personalNotificationTarget,
} from './notification-target';

const ORG = 'org_123';

describe('personalNotificationTarget', () => {
  it('builds a task deep-link when taskId + projectId are present', () => {
    const target = personalNotificationTarget({
      organizationId: ORG,
      taskId: 'task_abc',
      params: { projectId: 'proj_xyz', title: 'Ship it' },
    });
    expect(target).toEqual({
      to: '/dashboard/$id/projects/$projectId/tasks',
      params: { id: ORG, projectId: 'proj_xyz' },
      search: { task: 'task_abc' },
    });
  });

  it('returns null when projectId is missing (legacy rows)', () => {
    expect(
      personalNotificationTarget({
        organizationId: ORG,
        taskId: 'task_abc',
        params: { title: 'No project here' },
      }),
    ).toBeNull();
  });

  it('returns null when taskId is missing', () => {
    expect(
      personalNotificationTarget({
        organizationId: ORG,
        taskId: undefined,
        params: { projectId: 'proj_xyz' },
      }),
    ).toBeNull();
  });

  it('tolerates non-record params', () => {
    expect(
      personalNotificationTarget({
        organizationId: ORG,
        taskId: 'task_abc',
        params: undefined,
      }),
    ).toBeNull();
  });
});

describe('orgNotificationTarget', () => {
  it('returns null when there is no link', () => {
    expect(orgNotificationTarget(ORG, undefined)).toBeNull();
  });

  it('maps an agent link to the agent detail route', () => {
    expect(
      orgNotificationTarget(ORG, { kind: 'agent', agentSlug: 'researcher' }),
    ).toEqual({
      to: '/dashboard/$id/agents/$agentId',
      params: { id: ORG, agentId: 'researcher' },
    });
  });

  it('maps audit-logs to the governance logs route', () => {
    expect(orgNotificationTarget(ORG, { kind: 'audit-logs' })).toEqual({
      to: '/dashboard/$id/settings/governance/logs',
      params: { id: ORG },
    });
  });

  it('maps dsar to the data-subject-requests route', () => {
    expect(orgNotificationTarget(ORG, { kind: 'dsar' })).toEqual({
      to: '/dashboard/$id/settings/governance/data-subject-requests',
      params: { id: ORG },
    });
  });

  it('maps security-monitoring to the governance security route', () => {
    expect(orgNotificationTarget(ORG, { kind: 'security-monitoring' })).toEqual(
      {
        to: '/dashboard/$id/settings/governance/security-monitoring',
        params: { id: ORG },
      },
    );
  });
});
