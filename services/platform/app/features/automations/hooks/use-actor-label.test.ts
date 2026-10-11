// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  members: undefined as
    | { userId: string; displayName?: string; email?: string }[]
    | undefined,
}));

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({
    members: state.members,
    isLoading: state.members === undefined,
  }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));

import { useActorLabel } from './use-actor-label';

function label(actor: string) {
  const { result } = renderHook(() => useActorLabel('org-1'));
  return result.current(actor);
}

beforeEach(() => {
  state.members = [
    { userId: 'user-ada', displayName: 'Ada Lovelace', email: 'ada@x.test' },
    { userId: 'user-noname', displayName: '', email: 'noname@x.test' },
  ];
});

describe('useActorLabel', () => {
  it('names the reader, in every form an actor takes, without the directory', () => {
    state.members = undefined;
    expect(label('user-me')).toEqual({ kind: 'you', api: false });
    expect(label('user:user-me')).toEqual({ kind: 'you', api: false });
    expect(label('api-key:user-me')).toEqual({ kind: 'you', api: true });
  });

  it('names a listed member by name, else by e-mail', () => {
    expect(label('user-ada')).toEqual({
      kind: 'member',
      name: 'Ada Lovelace',
      api: false,
    });
    expect(label('api-key:user-noname')).toEqual({
      kind: 'member',
      name: 'noname@x.test',
      api: true,
    });
  });

  it('waits for the directory before calling anyone a former member', () => {
    state.members = undefined;
    expect(label('user-gone')).toEqual({ kind: 'pending', api: false });
    state.members = [];
    expect(label('user-gone')).toEqual({ kind: 'former', api: false });
    // The pseudonym erasure leaves behind reads as a former member too.
    expect(label('erased-user')).toEqual({ kind: 'former', api: false });
  });

  it('names the platform as Tale, and an actor that names nobody as unknown', () => {
    expect(label('system:provisioning')).toEqual({ kind: 'system' });
    expect(label('')).toEqual({ kind: 'unknown' });
    expect(label('trigger:t-1')).toEqual({ kind: 'unknown' });
    expect(label('odd:value')).toEqual({ kind: 'unknown' });
  });
});
