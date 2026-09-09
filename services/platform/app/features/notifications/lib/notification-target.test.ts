import { describe, expect, it } from 'vitest';

import type { OrgNotificationLink } from '@/backend/core/notifications/org_notification_link';

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

  it('builds a chat deep-link when chat + threadId are present', () => {
    const target = personalNotificationTarget({
      organizationId: ORG,
      taskId: undefined,
      params: {
        threadId: 'thread_chat',
        chat: true,
        title: 'Planning',
      },
    });
    expect(target).toEqual({
      to: '/dashboard/$id/chat/$threadId',
      params: { id: ORG, threadId: 'thread_chat' },
    });
  });

  it('falls back to the project for a legacy discussion-mention row (threadId + projectId)', () => {
    const target = personalNotificationTarget({
      organizationId: ORG,
      taskId: undefined,
      params: {
        projectId: 'proj_xyz',
        threadId: 'thread_abc',
        title: 'API shape',
      },
    });
    expect(target).toEqual({
      to: '/dashboard/$id/projects/$projectId/tasks',
      params: { id: ORG, projectId: 'proj_xyz' },
    });
  });

  it('builds a conversation deep-link when conversationId is present', () => {
    expect(
      personalNotificationTarget({
        organizationId: ORG,
        taskId: undefined,
        params: {
          conversationId: 'conv_abc',
          conversationStatus: 'open',
          subject: 'Re: invoice',
        },
      }),
    ).toEqual({
      to: '/dashboard/$id/conversations/$status',
      params: { id: ORG, status: 'open' },
      search: { conversation: 'conv_abc' },
    });
  });

  it('defaults the conversation status segment to open when unspecified', () => {
    expect(
      personalNotificationTarget({
        organizationId: ORG,
        taskId: undefined,
        params: { conversationId: 'conv_def' },
      }),
    ).toEqual({
      to: '/dashboard/$id/conversations/$status',
      params: { id: ORG, status: 'open' },
      search: { conversation: 'conv_def' },
    });
  });

  it('carries a non-open conversation status into the URL segment', () => {
    expect(
      personalNotificationTarget({
        organizationId: ORG,
        taskId: undefined,
        params: { conversationId: 'conv_ghi', conversationStatus: 'closed' },
      }),
    ).toEqual({
      to: '/dashboard/$id/conversations/$status',
      params: { id: ORG, status: 'closed' },
      search: { conversation: 'conv_ghi' },
    });
  });

  it('routes a project-file review row into its Files tab with the preview open', () => {
    expect(
      personalNotificationTarget({
        organizationId: ORG,
        taskId: undefined,
        params: {
          documentId: 'doc_1',
          projectId: 'proj_xyz',
          folderId: 'folder_9',
        },
      }),
    ).toEqual({
      to: '/dashboard/$id/projects/$projectId/files',
      params: { id: ORG, projectId: 'proj_xyz' },
      search: { doc: 'doc_1', folderId: 'folder_9' },
    });
  });

  it('routes a library-document review row to the documents list with the preview open', () => {
    expect(
      personalNotificationTarget({
        organizationId: ORG,
        taskId: undefined,
        params: { documentId: 'doc_1' },
      }),
    ).toEqual({
      to: '/dashboard/$id/documents',
      params: { id: ORG },
      search: { doc: 'doc_1' },
    });
  });

  it('falls back to the project when taskId is missing but projectId is present', () => {
    expect(
      personalNotificationTarget({
        organizationId: ORG,
        taskId: undefined,
        params: { projectId: 'proj_xyz' },
      }),
    ).toEqual({
      to: '/dashboard/$id/projects/$projectId/tasks',
      params: { id: ORG, projectId: 'proj_xyz' },
    });
  });

  // The shape below is no longer writable — `CollabNotificationInput`
  // requires `params.projectId` beside `taskId` — but rows stored before the
  // project was stamped still reach this builder, and the client cannot
  // resolve a project from a task id.
  it('falls back to the org home for a legacy row written before the project was stamped', () => {
    expect(
      personalNotificationTarget({
        organizationId: ORG,
        taskId: 'task_abc',
        params: { title: 'No project here' },
      }),
    ).toEqual({ to: '/dashboard/$id', params: { id: ORG } });
  });

  // The defect: a deadline row named a task and opened the org home.
  it('opens the task for a deadline row, which now carries its project', () => {
    expect(
      personalNotificationTarget({
        organizationId: ORG,
        taskId: 'task_abc',
        params: { title: 'Redesign side-navigation', projectId: 'proj_xyz' },
      }),
    ).toEqual({
      to: '/dashboard/$id/projects/$projectId/tasks',
      params: { id: ORG, projectId: 'proj_xyz' },
      search: { task: 'task_abc' },
    });
  });

  it('opens the run for an escalation with no task and no project', () => {
    expect(
      personalNotificationTarget({
        organizationId: ORG,
        taskId: undefined,
        params: { name: 'billing/dunning-reminder', runId: 'run_1' },
      }),
    ).toEqual({
      to: '/dashboard/$id/automations/$automationSlug/runs/$runId',
      params: {
        id: ORG,
        automationSlug: 'billing__dunning-reminder',
        runId: 'run_1',
      },
    });
  });

  it('falls back to the org home for non-record params (never a dead row)', () => {
    expect(
      personalNotificationTarget({
        organizationId: ORG,
        taskId: 'task_abc',
        params: undefined,
      }),
    ).toEqual({ to: '/dashboard/$id', params: { id: ORG } });
  });
});

describe('orgNotificationTarget', () => {
  it('falls back to governance for a linkless security alert', () => {
    expect(orgNotificationTarget(ORG, undefined, 'security')).toEqual({
      to: '/dashboard/$id/settings/governance',
      params: { id: ORG },
    });
  });

  it('falls back to Automations for a linkless system/automation alert', () => {
    expect(orgNotificationTarget(ORG, undefined, 'system')).toEqual({
      to: '/dashboard/$id/automations',
      params: { id: ORG },
    });
  });

  // A row stored by a retired producer (the `agent` kind, whose page was
  // removed) still reaches this switch. It used to return the link OBJECT,
  // which a `<Link>` spread with no `to` navigates nowhere from.
  it('lands an unknown stored kind on the category page, not a dead link', () => {
    const retired = { kind: 'agent', agentSlug: 'researcher' };
    expect(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stored row from a producer the union no longer carries
      orgNotificationTarget(ORG, retired as OrgNotificationLink, 'system'),
    ).toEqual({ to: '/dashboard/$id/automations', params: { id: ORG } });
    expect(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above, on the security lane
      orgNotificationTarget(ORG, retired as OrgNotificationLink, 'security'),
    ).toEqual({
      to: '/dashboard/$id/settings/governance',
      params: { id: ORG },
    });
  });

  it('opens the request itself for a DSAR alert that names one', () => {
    expect(
      orgNotificationTarget(
        ORG,
        { kind: 'dsar', requestId: 'req_1' },
        'security',
      ),
    ).toEqual({
      to: '/dashboard/$id/settings/governance/data-subject-requests/$requestId',
      params: { id: ORG, requestId: 'req_1' },
    });
  });

  it('maps a budgets link to the page that grants the credits', () => {
    expect(orgNotificationTarget(ORG, { kind: 'budgets' }, 'system')).toEqual({
      to: '/dashboard/$id/settings/governance/policies-limits',
      params: { id: ORG },
    });
  });

  it('maps a websites link to the list, filtered to the failing sites', () => {
    expect(
      orgNotificationTarget(ORG, { kind: 'websites' }, 'security'),
    ).toEqual({
      to: '/dashboard/$id/websites',
      params: { id: ORG },
      search: { status: 'error' },
    });
  });

  it('maps audit-logs to the governance logs route', () => {
    expect(
      orgNotificationTarget(ORG, { kind: 'audit-logs' }, 'security'),
    ).toEqual({
      to: '/dashboard/$id/settings/governance/logs',
      params: { id: ORG },
    });
  });

  it('carries the broken-row logId into the logs route search (#1845)', () => {
    expect(
      orgNotificationTarget(
        ORG,
        { kind: 'audit-logs', logId: 'log_bad' },
        'security',
      ),
    ).toEqual({
      to: '/dashboard/$id/settings/governance/logs',
      params: { id: ORG },
      search: { logId: 'log_bad' },
    });
  });

  it('maps dsar to the data-subject-requests route', () => {
    expect(orgNotificationTarget(ORG, { kind: 'dsar' }, 'security')).toEqual({
      to: '/dashboard/$id/settings/governance/data-subject-requests',
      params: { id: ORG },
    });
  });

  it('maps security-monitoring to the governance security route', () => {
    expect(
      orgNotificationTarget(ORG, { kind: 'security-monitoring' }, 'security'),
    ).toEqual({
      to: '/dashboard/$id/settings/governance/security-monitoring',
      params: { id: ORG },
    });
  });
});
