// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' } }),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({ members: [] }),
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
const { useActorDirectory } = await import('./use-actor-directory');

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
