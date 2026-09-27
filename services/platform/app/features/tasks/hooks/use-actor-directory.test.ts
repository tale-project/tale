// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useActorDirectory } from './use-actor-directory';

// The directory serves members from the org roster and agents from the
// PROJECT's user-created instances (`projectAgents` rows): with a project the
// instances are assignable and resolve to their names; without one no agent
// is assignable, and an unknown/foreign agent actor reads as a deleted agent.

const PROJECT_AGENTS = [
  {
    _id: 'pa_1',
    name: 'PR Reviewer',
    harness: 'claude-code',
    skills: ['review'],
    connectors: [],
  },
  {
    _id: 'pa_2',
    name: 'Docs Writer',
    harness: 'codex',
    skills: [],
    connectors: [],
  },
];

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({
    members: [
      {
        userId: 'user-1',
        displayName: 'Alex Doe',
        email: 'alex@example.com',
        role: 'member',
      },
      {
        userId: 'user-2',
        displayName: '',
        email: 'kim@example.com',
        role: 'admin',
      },
    ],
  }),
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  // Arg-sensitive like the real hook: no project id → the query skips and the
  // list is empty.
  useProjectAgents: (projectId?: string) => ({
    agents: projectId ? PROJECT_AGENTS : [],
    isLoading: false,
  }),
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: undefined }),
}));

vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-1' } }),
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

// The directory names `app` actors from the automation listing, which needs the
// reader's locale; this hook renders outside a LocaleProvider here.
vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: 'en' }),
}));

describe('useActorDirectory — members + project-agent instances', () => {
  it('lists org members as assignable and resolves their names', () => {
    const { result } = renderHook(() => useActorDirectory('org-1'));
    expect(result.current.members.map((m) => m.id)).toEqual([
      'user-1',
      'user-2',
    ]);
    expect(result.current.resolveActor('user', 'user-1')).toMatchObject({
      name: 'Alex Doe',
      isAgent: false,
      email: 'alex@example.com',
    });
  });

  it('exposes no assignable agents without a project', () => {
    const { result } = renderHook(() => useActorDirectory('org-1'));
    expect(result.current.agents).toEqual([]);
  });

  it("lists the project's instances as assignable coding agents", () => {
    const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(result.current.agents).toEqual([
      {
        type: 'agent',
        id: 'pa_1',
        name: 'PR Reviewer',
        displayCategory: 'coding-agent',
      },
      {
        type: 'agent',
        id: 'pa_2',
        name: 'Docs Writer',
        displayCategory: 'coding-agent',
      },
    ]);
  });

  it('resolves an instance actor to its name', () => {
    const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(result.current.resolveActor('agent', 'pa_1')).toMatchObject({
      name: 'PR Reviewer',
      isAgent: true,
    });
  });

  it('labels an agent actor the project no longer has as a deleted agent, never its raw id', () => {
    // A deleted agent's history stays on the task (its runs, its comments,
    // the activity it wrote); the id it left behind is nothing a reader can
    // look up, so the timeline says what it was instead.
    const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(result.current.resolveActor('agent', 'research-bot')).toMatchObject({
      id: 'research-bot',
      name: 'timeline.deletedAgent',
      isAgent: true,
    });
  });

  it('still names the system actor through i18n', () => {
    const { result } = renderHook(() => useActorDirectory('org-1'));
    expect(result.current.resolveActor('agent', 'system').name).toBe(
      'timeline.systemActor',
    );
  });

  it('resolves assignee ids without a type for activity timeline rows', () => {
    const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(result.current.resolveAssigneeId('user-1')).toBe('Alex Doe');
    expect(result.current.resolveAssigneeId('pa_2')).toBe('Docs Writer');
    expect(result.current.resolveAssigneeId('unknown-id')).toBe('unknown-id');
  });
});
