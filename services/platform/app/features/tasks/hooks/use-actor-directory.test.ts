// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useActorDirectory, useAssignableActors } from './use-actor-directory';

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

let standardAgent: { enabled: boolean; available: boolean } | undefined;

vi.mock('@/app/features/projects/hooks/queries', () => ({
  // Arg-sensitive like the real hook: no project id → the query skips and the
  // list is empty.
  useProjectAgents: (projectId?: string) => ({
    agents: projectId ? PROJECT_AGENTS : [],
    isLoading: false,
  }),
  // Skipped (undefined) without an organization, like the real read.
  useStandardAgent: (organizationId?: string) =>
    organizationId === undefined ? undefined : standardAgent,
}));

/** What `listAccessibleUserIds` answers — undefined while it loads. */
let accessScope: { orgWide: boolean; userIds: string[] } | undefined;
/** What `getProject` answers — undefined while it loads, null when the
 * project is gone or out of reach. */
let projectRead: { canEdit: boolean } | null | undefined;

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string, args: unknown) => ({
    data:
      args === 'skip'
        ? undefined
        : name === 'projects/queries:listAccessibleUserIds'
          ? accessScope
          : name === 'projects/queries:getProject'
            ? projectRead
            : undefined,
  }),
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

  it("lists the project's instances as assignable agents", () => {
    const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(result.current.agents).toEqual([
      { type: 'agent', id: 'pa_1', name: 'PR Reviewer' },
      { type: 'agent', id: 'pa_2', name: 'Docs Writer' },
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

/**
 * The candidate lists are narrowed to the project's audience, and say when
 * that narrowing has happened: until it has, the members are org-wide, so a
 * picker that must offer only who the server takes (the reviewer's) waits.
 */
describe('useAssignableActors — the project audience', () => {
  beforeEach(() => {
    accessScope = undefined;
  });

  it('drops members outside a team-restricted project', () => {
    accessScope = { orgWide: false, userIds: ['user-1'] };
    const { result } = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(result.current.scopeReady).toBe(true);
    expect(result.current.assignableMembers.map((m) => m.id)).toEqual([
      'user-1',
    ]);
  });

  it('is not ready while the audience loads, and falls back to the whole org', () => {
    const { result } = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(result.current.scopeReady).toBe(false);
    expect(result.current.assignableMembers.map((m) => m.id)).toEqual([
      'user-1',
      'user-2',
    ]);
  });

  it('is ready at once without a project — the org is the audience', () => {
    const { result } = renderHook(() => useAssignableActors('org-1'));
    expect(result.current.scopeReady).toBe(true);
  });
});

describe('useAssignableActors — who may add an agent', () => {
  beforeEach(() => {
    projectRead = undefined;
    standardAgent = undefined;
  });

  it('knows whether the organization’s standard agent would take work here', () => {
    standardAgent = { enabled: true, available: true };
    const on = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(on.result.current.standardAgentAvailable).toBe(true);

    standardAgent = { enabled: false, available: false };
    const off = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(off.result.current.standardAgentAvailable).toBe(false);

    // Unknown while it loads, and without a project to hand work in.
    standardAgent = undefined;
    const loading = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(loading.result.current.standardAgentAvailable).toBe(false);
    standardAgent = { enabled: true, available: true };
    const none = renderHook(() => useAssignableActors('org-1'));
    expect(none.result.current.standardAgentAvailable).toBe(false);
  });

  it('lets the project’s editors add one', () => {
    projectRead = { canEdit: true };
    const { result } = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(result.current.projectResolved).toBe(true);
    expect(result.current.canAddAgents).toBe(true);
  });

  it('lets a reader add none', () => {
    projectRead = { canEdit: false };
    const { result } = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(result.current.projectResolved).toBe(true);
    expect(result.current.canAddAgents).toBe(false);
  });

  it('knows nothing while the project loads, when it is out of reach, or without one', () => {
    const loading = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(loading.result.current.projectResolved).toBe(false);
    expect(loading.result.current.canAddAgents).toBe(false);

    projectRead = null;
    const gone = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(gone.result.current.projectResolved).toBe(false);

    projectRead = { canEdit: true };
    const none = renderHook(() => useAssignableActors('org-1'));
    expect(none.result.current.projectResolved).toBe(false);
    expect(none.result.current.canAddAgents).toBe(false);
  });
});
