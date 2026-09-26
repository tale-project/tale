import { describe, expect, it } from 'vitest';

import { isHomePath, isPanelCollapsible, readHomeLocation } from './home-paths';

const ORG = 'org-1';

describe('isHomePath', () => {
  it('claims every route the Home panel stands beside', () => {
    for (const path of [
      '/dashboard/org-1/home',
      '/dashboard/org-1/chat',
      '/dashboard/org-1/chat/thread-1',
      '/dashboard/org-1/projects',
      '/dashboard/org-1/projects/p-1/tasks/board',
      '/dashboard/org-1/tasks/t-1',
      '/dashboard/org-1/conversations/open',
    ]) {
      expect(isHomePath(path, ORG), path).toBe(true);
    }
  });

  it('leaves the other sections, other orgs and shared snapshots alone', () => {
    for (const path of [
      '/dashboard/org-1',
      '/dashboard/org-1/documents',
      '/dashboard/org-1/automations',
      '/dashboard/org-1/settings/account',
      '/dashboard/org-1/chat/shared/token-1',
      '/dashboard/org-2/chat',
      '/dashboard/org-1/chatter',
    ]) {
      expect(isHomePath(path, ORG), path).toBe(false);
    }
  });
});

describe('readHomeLocation', () => {
  it('names the open item of each kind', () => {
    expect(readHomeLocation('/dashboard/org-1/chat/t-1', {}, ORG)).toEqual({
      kind: 'chat',
      threadId: 't-1',
    });
    expect(readHomeLocation('/dashboard/org-1/chat', {}, ORG)).toEqual({
      kind: 'chat',
    });
    expect(readHomeLocation('/dashboard/org-1/tasks/k-1', {}, ORG)).toEqual({
      kind: 'task',
      taskId: 'k-1',
    });
    expect(
      readHomeLocation(
        '/dashboard/org-1/conversations/closed',
        { conversation: 'c-1' },
        ORG,
      ),
    ).toEqual({
      kind: 'conversation',
      status: 'closed',
      conversationId: 'c-1',
    });
    expect(
      readHomeLocation('/dashboard/org-1/projects/p-1/files', {}, ORG),
    ).toEqual({ kind: 'project', projectId: 'p-1' });
  });

  it('reads anything else as outside Home', () => {
    expect(readHomeLocation('/dashboard/org-1/documents', {}, ORG)).toEqual({
      kind: 'other',
    });
    expect(readHomeLocation('/somewhere', {}, ORG)).toEqual({ kind: 'other' });
  });
});

describe('isPanelCollapsible', () => {
  it('lets the panel fold only where the header can unfold it', () => {
    expect(isPanelCollapsible({ kind: 'chat' })).toBe(true);
    expect(isPanelCollapsible({ kind: 'task', taskId: 't' })).toBe(true);
    expect(
      isPanelCollapsible({
        kind: 'conversation',
        status: 'open',
        conversationId: 'c',
      }),
    ).toBe(true);
    expect(isPanelCollapsible({ kind: 'conversation', status: 'open' })).toBe(
      false,
    );
    expect(isPanelCollapsible({ kind: 'project', projectId: 'p' })).toBe(false);
  });
});
