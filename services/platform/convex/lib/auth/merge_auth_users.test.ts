import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BetterAuthUser } from '../../members/types';
import {
  createBetterAuthMemoryStore,
  createBetterAuthTestCtx,
  listTeamMembers,
  seedTeamMember,
  seedUser,
} from './test/better_auth_memory_adapter';

vi.mock('../../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth.adapter.findMany',
        create: 'betterAuth.adapter.create',
        updateMany: 'betterAuth.adapter.updateMany',
        deleteOne: 'betterAuth.adapter.deleteOne',
      },
    },
  },
}));

function signupUser(
  partial: Partial<BetterAuthUser> & Pick<BetterAuthUser, '_id' | 'email'>,
): BetterAuthUser {
  return {
    name: partial.name ?? partial.email,
    emailVerified: partial.emailVerified ?? false,
    createdAt: partial.createdAt ?? 1_700_000_000_000,
    updatedAt: partial.updatedAt ?? 1_700_000_000_000,
    ...partial,
  };
}

describe('mergeDuplicateAuthUserIntoCanonical mirror sync', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('repoints teamMember rows and teamMemberMirror on merge', async () => {
    const store = createBetterAuthMemoryStore();
    seedUser(
      store,
      signupUser({ _id: 'canonical', email: 'user@example.com' }),
    );
    seedUser(
      store,
      signupUser({ _id: 'duplicate', email: 'User@Example.com' }),
    );
    seedTeamMember(store, {
      _id: 'tm-dup',
      teamId: 'team_1',
      userId: 'duplicate',
      createdAt: 42,
    });

    const ctx = createBetterAuthTestCtx(store);
    await ctx.db.insert('teamMemberMirror', {
      teamMemberId: 'tm-dup',
      userId: 'duplicate',
      teamId: 'team_1',
      createdAt: 42,
      updatedAt: 1,
    });

    const { mergeDuplicateAuthUserIntoCanonical } =
      await import('./merge_auth_users');
    await mergeDuplicateAuthUserIntoCanonical(
      ctx as never,
      'canonical',
      'duplicate',
    );

    expect(listTeamMembers(store)).toEqual([
      expect.objectContaining({
        _id: 'tm-dup',
        teamId: 'team_1',
        userId: 'canonical',
      }),
    ]);

    const mirrors = await ctx.db
      .query('teamMemberMirror')
      .filter(() => true)
      .collect();
    expect(mirrors).toEqual([
      expect.objectContaining({
        teamMemberId: 'tm-dup',
        userId: 'canonical',
        teamId: 'team_1',
      }),
    ]);
  });
});
