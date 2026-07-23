// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useActorDirectory } from './use-actor-directory';

// While the agents/automations backend is rebuilt the directory serves
// members only: no agent is assignable, and historical agent actors resolve
// to their raw slug. These tests pin that degraded contract so the member
// paths can't regress while the agent paths are offline.

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
  useProject: () => ({ project: undefined }),
}));

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: undefined }),
}));

vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-1' } }),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

describe('useActorDirectory — members-only while the agents backend is rebuilt', () => {
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

  it('exposes no assignable agents', () => {
    const { result } = renderHook(() => useActorDirectory('org-1'));
    expect(result.current.agents).toEqual([]);
  });

  it('falls back to the raw slug for a historical agent actor', () => {
    const { result } = renderHook(() => useActorDirectory('org-1'));
    expect(result.current.resolveActor('agent', 'research-bot')).toMatchObject({
      name: 'research-bot',
      isAgent: true,
    });
  });

  it('still names the system actor through i18n', () => {
    const { result } = renderHook(() => useActorDirectory('org-1'));
    expect(result.current.resolveActor('agent', 'system').name).toBe(
      'timeline.systemActor',
    );
  });
});
