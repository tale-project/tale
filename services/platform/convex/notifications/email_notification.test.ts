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

  it('builds a conversation deep link when conversationId is present', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: 'org_1',
        params: {
          conversationId: 'conv_abc',
          conversationStatus: 'open',
        },
        siteUrl: 'https://app.example.com',
      }),
    ).toBe(
      'https://app.example.com/dashboard/org_1/conversations/open?conversation=conv_abc',
    );
  });

  it('falls back to the project overview for a legacy discussion row (threadId + projectId)', () => {
    // The discussions feature (and its route) is gone; legacy mention rows
    // still carry threadId + projectId and must land somewhere real.
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
    ).toBe('https://app.example.com/dashboard/org_1/projects/proj_xyz/tasks');
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
