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

  it('falls back to the org home when there is no project context (legacy/digest)', () => {
    expect(
      personalNotificationTarget({
        organizationId: ORG,
        taskId: 'task_abc',
        params: { title: 'No project here' },
      }),
    ).toEqual({ to: '/dashboard/$id', params: { id: ORG } });
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

  it('maps an agent link to the org home (agents page removed)', () => {
    expect(
      orgNotificationTarget(
        ORG,
        { kind: 'agent', agentSlug: 'researcher' },
        'system',
      ),
    ).toEqual({
      to: '/dashboard/$id',
      params: { id: ORG },
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
