import { describe, expect, it } from 'vitest';

import {
  hasOwnPhoneHeader,
  isHomePath,
  isPanelCollapsible,
  isProjectAutomationPage,
  readHomeLocation,
} from './home-paths';

const ORG = 'org-1';

describe('isHomePath', () => {
  it('claims every route the Home panel stands beside', () => {
    for (const path of [
      '/dashboard/org-1/home',
      '/dashboard/org-1/chat',
      '/dashboard/org-1/chat/thread-1',
      '/dashboard/org-1/projects',
      '/dashboard/org-1/projects/p-1/tasks/board',
      // The project's Automations tab, the bound list, is the project's page.
      '/dashboard/org-1/projects/p-1/automations',
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

  // An automation opened inside a project wears the Automations chrome: the
  // rail lights Automations there, and its canvas keeps the full width.
  it("leaves a project's automation page to Automations", () => {
    for (const path of [
      '/dashboard/org-1/projects/p1/automations/intake',
      '/dashboard/org-1/projects/p1/automations/intake/editor',
      '/dashboard/org-1/projects/p1/automations/intake/runs/r1',
    ]) {
      expect(isHomePath(path, ORG), path).toBe(false);
    }
  });
});

describe('isProjectAutomationPage', () => {
  it("names an automation's own pages inside a project", () => {
    for (const path of [
      '/dashboard/org-1/projects/p1/automations/intake',
      '/dashboard/org-1/projects/p1/automations/intake/editor',
      '/dashboard/org-1/projects/p1/automations/intake/runs/r1',
    ]) {
      expect(isProjectAutomationPage(path, ORG), path).toBe(true);
    }
  });

  it("leaves the project's Automations tab, the org's automations and other orgs alone", () => {
    for (const path of [
      '/dashboard/org-1/projects/p1/automations',
      '/dashboard/org-1/projects/p1/automations/',
      '/dashboard/org-1/projects/p1/tasks/board',
      '/dashboard/org-1/automations/intake',
      '/dashboard/org-2/projects/p1/automations/intake',
    ]) {
      expect(isProjectAutomationPage(path, ORG), path).toBe(false);
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

describe('hasOwnPhoneHeader', () => {
  it('names the conversation-shaped pages, which carry their own header on a phone', () => {
    expect(hasOwnPhoneHeader({ kind: 'chat' })).toBe(true);
    expect(hasOwnPhoneHeader({ kind: 'chat', threadId: 't' })).toBe(true);
    expect(hasOwnPhoneHeader({ kind: 'task', taskId: 't' })).toBe(true);
    expect(
      hasOwnPhoneHeader({
        kind: 'conversation',
        status: 'open',
        conversationId: 'c',
      }),
    ).toBe(true);
  });

  it('leaves the pages that keep the shell bar — a project among them', () => {
    expect(hasOwnPhoneHeader({ kind: 'conversation', status: 'open' })).toBe(
      false,
    );
    expect(hasOwnPhoneHeader({ kind: 'project', projectId: 'p' })).toBe(false);
    expect(hasOwnPhoneHeader({ kind: 'project' })).toBe(false);
    expect(hasOwnPhoneHeader({ kind: 'other' })).toBe(false);
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
    // A project's own page carries the toggle in its header too.
    expect(isPanelCollapsible({ kind: 'project', projectId: 'p' })).toBe(true);
  });

  it('keeps the panel on the lists, whose headers have no toggle', () => {
    expect(isPanelCollapsible({ kind: 'conversation', status: 'open' })).toBe(
      false,
    );
    expect(isPanelCollapsible({ kind: 'project' })).toBe(false);
    expect(isPanelCollapsible({ kind: 'other' })).toBe(false);
  });
});
