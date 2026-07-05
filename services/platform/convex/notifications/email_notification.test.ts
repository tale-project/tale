import { describe, expect, it } from 'vitest';

import { buildPersonalNotificationUrl } from './email_notification';

describe('buildPersonalNotificationUrl', () => {
  it('builds a task deep link when taskId and projectId are present', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: 'org_1',
        taskId: 'task_abc',
        params: { projectId: 'proj_xyz', title: 'Ship it' },
        siteUrl: 'https://app.example.com',
      }),
    ).toBe(
      'https://app.example.com/dashboard/org_1/projects/proj_xyz/tasks?task=task_abc',
    );
  });

  it('builds a chat deep link when chat flag and threadId are present', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: 'org_1',
        params: {
          threadId: 'thread_chat',
          chat: true,
          title: 'Planning',
        },
        siteUrl: 'https://app.example.com',
      }),
    ).toBe('https://app.example.com/dashboard/org_1/chat/thread_chat');
  });

  it('builds a discussion deep link when threadId and projectId are present', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: 'org_1',
        params: {
          projectId: 'proj_xyz',
          threadId: 'thread_abc',
          title: 'API shape',
        },
        siteUrl: 'https://app.example.com',
      }),
    ).toBe(
      'https://app.example.com/dashboard/org_1/projects/proj_xyz/discussions?thread=thread_abc',
    );
  });

  it('returns null when projectId is missing', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: 'org_1',
        taskId: 'task_abc',
        params: { title: 'Ship it' },
        siteUrl: 'https://app.example.com',
      }),
    ).toBeNull();
  });

  it('returns null when taskId is missing', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: 'org_1',
        params: { projectId: 'proj_xyz' },
        siteUrl: 'https://app.example.com',
      }),
    ).toBeNull();
  });
});
