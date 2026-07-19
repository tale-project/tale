// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' } }),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

interface MockMember {
  userId: string;
  displayName?: string;
  email?: string;
  role: string;
}
let mockMembers: MockMember[] = [];
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({ members: mockMembers }),
}));

let mockProject: {
  agentMode?: string;
  allowedAgentSlugs?: string[];
  recommendedAgentSlugs?: string[];
} | null = null;
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProject: () => ({ project: mockProject }),
}));

let mockScope: { data: { orgWide: boolean; userIds: string[] } | undefined } = {
  data: undefined,
};
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => mockScope,
}));

vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: undefined }),
}));

vi.mock('@/app/features/workflows/hooks/file-queries', () => ({
  useListWorkflows: () => ({ workflows: [] }),
}));

interface MockRawAgent {
  name: string;
  displayName?: string;
  primaryBehavior?: string;
  hasRuntime?: boolean;
}

interface MockInstallRow {
  agentSlug: string;
  enabled: boolean;
}

let mockAgents: MockRawAgent[] = [];
let mockInstalls: { data: MockInstallRow[] | undefined; isLoading: boolean } = {
  data: [],
  isLoading: false,
};

vi.mock('@/app/features/agents/hooks/queries', () => ({
  useListAgents: () => ({ agents: mockAgents }),
  useAgentInstallations: () => mockInstalls,
}));

// Import after mocks are set up (mirrors use-effective-agent.test.ts).
const { useActorDirectory, useAssignableActors } =
  await import('./use-actor-directory');

const PROJECT_ID = 'proj-1' as Id<'projects'>;

describe('useActorDirectory — agent liveness filter (#2603)', () => {
  it('excludes an agent with no install row (never installed) from the assignable list', () => {
    mockAgents = [{ name: 'issue-triager', displayName: 'Issue Triager' }];
    mockInstalls = { data: [], isLoading: false };

    const { result } = renderHook(() => useActorDirectory('org-1'));

    expect(result.current.agents).toEqual([]);
  });

  it('excludes an agent that is installed but disabled', () => {
    mockAgents = [{ name: 'issue-triager', displayName: 'Issue Triager' }];
    mockInstalls = {
      data: [{ agentSlug: 'issue-triager', enabled: false }],
      isLoading: false,
    };

    const { result } = renderHook(() => useActorDirectory('org-1'));

    expect(result.current.agents).toEqual([]);
  });

  it('includes an agent with an enabled install row', () => {
    mockAgents = [{ name: 'issue-triager', displayName: 'Issue Triager' }];
    mockInstalls = {
      data: [{ agentSlug: 'issue-triager', enabled: true }],
      isLoading: false,
    };

    const { result } = renderHook(() => useActorDirectory('org-1'));

    expect(result.current.agents).toHaveLength(1);
    expect(result.current.agents[0]).toMatchObject({
      id: 'issue-triager',
      name: 'Issue Triager',
    });
  });

  it('returns no agents while install states are still loading (never flashes a non-live agent)', () => {
    mockAgents = [{ name: 'issue-triager', displayName: 'Issue Triager' }];
    mockInstalls = { data: undefined, isLoading: true };

    const { result } = renderHook(() => useActorDirectory('org-1'));

    expect(result.current.agents).toEqual([]);
  });
});

describe('useActorDirectory — resolveActor for a non-live agent (#2609)', () => {
  it('still resolves a friendly name for an agent that has no (or a disabled) install row', () => {
    // A run-admission refusal activity names the agent that was refused —
    // almost always a non-live one, so it is absent from the live-only
    // `agentMap`. The timeline must still show its catalog display name
    // instead of falling back to the raw slug.
    mockAgents = [{ name: 'issue-triager', displayName: 'Issue Triager' }];
    mockInstalls = { data: [], isLoading: false };

    const { result } = renderHook(() => useActorDirectory('org-1'));

    expect(result.current.agents).toEqual([]);
    expect(result.current.resolveActor('agent', 'issue-triager')).toMatchObject(
      { name: 'Issue Triager', isAgent: true },
    );
  });

  it('falls back to the raw slug when the agent is unknown to the catalog', () => {
    mockAgents = [];
    mockInstalls = { data: [], isLoading: false };

    const { result } = renderHook(() => useActorDirectory('org-1'));

    expect(result.current.resolveActor('agent', 'ghost-agent')).toMatchObject({
      name: 'ghost-agent',
      isAgent: true,
    });
  });
});

describe('useAssignableActors — project-scoped candidates', () => {
  it('drops disabled members even for an org-wide project', () => {
    mockMembers = [
      { userId: 'u1', displayName: 'One', role: 'member' },
      { userId: 'u2', displayName: 'Two', role: 'disabled' },
    ];
    mockAgents = [];
    mockInstalls = { data: [], isLoading: false };
    mockProject = null;
    mockScope = { data: { orgWide: true, userIds: [] } };

    const { result } = renderHook(() =>
      useAssignableActors('org-1', PROJECT_ID),
    );
    expect(result.current.assignableMembers.map((m) => m.id)).toEqual(['u1']);
  });

  it('filters members to the accessible set for a team-scoped project', () => {
    mockMembers = [
      { userId: 'u1', displayName: 'One', role: 'member' },
      { userId: 'u2', displayName: 'Two', role: 'member' },
      { userId: 'u3', displayName: 'Three', role: 'member' },
    ];
    mockAgents = [];
    mockInstalls = { data: [], isLoading: false };
    mockProject = null;
    mockScope = { data: { orgWide: false, userIds: ['u1', 'u3'] } };

    const { result } = renderHook(() =>
      useAssignableActors('org-1', PROJECT_ID),
    );
    expect(result.current.assignableMembers.map((m) => m.id).sort()).toEqual([
      'u1',
      'u3',
    ]);
  });

  it('falls back to org-wide (minus disabled) while the access query loads', () => {
    mockMembers = [
      { userId: 'u1', displayName: 'One', role: 'member' },
      { userId: 'u2', displayName: 'Two', role: 'disabled' },
    ];
    mockAgents = [];
    mockInstalls = { data: [], isLoading: false };
    mockProject = null;
    mockScope = { data: undefined }; // still loading

    const { result } = renderHook(() =>
      useAssignableActors('org-1', PROJECT_ID),
    );
    expect(result.current.assignableMembers.map((m) => m.id)).toEqual(['u1']);
  });

  it('restricts agents to the project allow-list, leaving the display list whole', () => {
    mockMembers = [];
    mockAgents = [
      { name: 'scout', displayName: 'Scout' },
      { name: 'intruder', displayName: 'Intruder' },
    ];
    mockInstalls = {
      data: [
        { agentSlug: 'scout', enabled: true },
        { agentSlug: 'intruder', enabled: true },
      ],
      isLoading: false,
    };
    mockProject = { agentMode: 'restricted', allowedAgentSlugs: ['scout'] };
    mockScope = { data: { orgWide: true, userIds: [] } };

    const { result } = renderHook(() =>
      useAssignableActors('org-1', PROJECT_ID),
    );
    expect(result.current.assignableAgents.map((a) => a.id)).toEqual(['scout']);
    // The unfiltered directory still exposes both agents for display.
    expect(result.current.agents.map((a) => a.id).sort()).toEqual([
      'intruder',
      'scout',
    ]);
  });
});
