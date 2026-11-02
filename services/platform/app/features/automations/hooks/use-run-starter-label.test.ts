// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  members: undefined as
    | { userId: string; displayName: string; email: string }[]
    | undefined,
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));
vi.mock('@/app/features/settings/organization/hooks/member-lookup', async () =>
  (await import('@/tests/utils/member-lookup-stand-in')).memberLookupStandIn(
    () => state.members,
  ),
);
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));

import { useRunStarterLabel } from './use-run-starter-label';

function label(startedBy: string): string {
  const { result } = renderHook(() => useRunStarterLabel('org-1'));
  return result.current({ startedBy });
}

// A run page used to call its starter "a former member" while the member
// lookup was still running (or had failed) — a verdict on a person the page
// had not looked up yet (2026-09-26 evaluation, D-01).
describe('useRunStarterLabel', () => {
  it('reads as unknown, not as a former member, before the lookup answers', () => {
    state.members = undefined;
    expect(label('user:user-other')).toBe('runs.starter.unknown');
    expect(label('api-key:user-other')).toBe('runs.starter.unknown');
  });

  it('names the reader without waiting for the lookup', () => {
    state.members = undefined;
    expect(label('user:user-me')).toBe('runs.starter.you');
  });

  it('names a member found, and a former member only once the lookup answered', () => {
    state.members = [
      { userId: 'user-other', displayName: 'Ada', email: 'ada@example.com' },
    ];
    expect(label('user:user-other')).toBe('runs.starter.member:{"name":"Ada"}');
    expect(label('user:user-gone')).toBe('runs.starter.formerMember');
    expect(label('api-key:user-gone')).toBe('runs.starter.formerMemberApi');
  });
});
