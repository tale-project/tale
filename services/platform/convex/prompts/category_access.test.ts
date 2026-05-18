import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import {
  type CategoryAccessShape,
  type PromptScope,
  assertCategoryScopeMatchesPromptScope,
  canCreateCategoryInScope,
  canManageCategory,
} from './category_access';

function makeCategory(
  overrides: Partial<CategoryAccessShape> = {},
): CategoryAccessShape {
  return { scope: 'personal', createdBy: 'user_a', ...overrides };
}

describe('canCreateCategoryInScope', () => {
  it.each<[PromptScope, boolean]>([
    ['personal', true],
    ['team', false],
    ['global', false],
  ])('non-admin can create personal only (%s → %s)', (scope, expected) => {
    expect(canCreateCategoryInScope({ scope, isOrgAdmin: false })).toBe(
      expected,
    );
  });

  it.each<PromptScope>(['personal', 'team', 'global'])(
    'admin can create at every scope (%s)',
    (scope) => {
      expect(canCreateCategoryInScope({ scope, isOrgAdmin: true })).toBe(true);
    },
  );
});

describe('canManageCategory', () => {
  describe('personal scope', () => {
    it('creator can manage their own personal category', () => {
      expect(
        canManageCategory({
          category: makeCategory({ scope: 'personal', createdBy: 'user_a' }),
          userId: 'user_a',
          isOrgAdmin: false,
        }),
      ).toBe(true);
    });

    it('non-creator non-admin cannot manage', () => {
      expect(
        canManageCategory({
          category: makeCategory({ scope: 'personal', createdBy: 'user_a' }),
          userId: 'user_b',
          isOrgAdmin: false,
        }),
      ).toBe(false);
    });

    it('non-creator admin cannot manage — personal stays personal', () => {
      // This is the load-bearing case: admin status does NOT override the
      // personal-scope creator gate. A personal category created by user_a
      // remains exclusively user_a's to rename/delete, even if user_b is
      // an org admin.
      expect(
        canManageCategory({
          category: makeCategory({ scope: 'personal', createdBy: 'user_a' }),
          userId: 'user_b',
          isOrgAdmin: true,
        }),
      ).toBe(false);
    });

    it('creator admin can manage (because they are creator, not because admin)', () => {
      expect(
        canManageCategory({
          category: makeCategory({ scope: 'personal', createdBy: 'user_a' }),
          userId: 'user_a',
          isOrgAdmin: true,
        }),
      ).toBe(true);
    });
  });

  describe('team scope', () => {
    it('admin can manage even when not the creator', () => {
      expect(
        canManageCategory({
          category: makeCategory({ scope: 'team', createdBy: 'user_a' }),
          userId: 'user_b',
          isOrgAdmin: true,
        }),
      ).toBe(true);
    });

    it('non-admin cannot manage even if they created it', () => {
      // Non-admins can't create team categories in the first place, but if
      // legacy data exists or roles were revoked, the rule still holds.
      expect(
        canManageCategory({
          category: makeCategory({ scope: 'team', createdBy: 'user_a' }),
          userId: 'user_a',
          isOrgAdmin: false,
        }),
      ).toBe(false);
    });
  });

  describe('global scope', () => {
    it('admin can manage', () => {
      expect(
        canManageCategory({
          category: makeCategory({ scope: 'global', createdBy: 'user_a' }),
          userId: 'user_b',
          isOrgAdmin: true,
        }),
      ).toBe(true);
    });

    it('non-admin cannot manage', () => {
      expect(
        canManageCategory({
          category: makeCategory({ scope: 'global', createdBy: 'user_a' }),
          userId: 'user_a',
          isOrgAdmin: false,
        }),
      ).toBe(false);
    });
  });
});

describe('assertCategoryScopeMatchesPromptScope', () => {
  const callArgs = (
    overrides: Partial<
      Parameters<typeof assertCategoryScopeMatchesPromptScope>[0]
    >,
  ): Parameters<typeof assertCategoryScopeMatchesPromptScope>[0] => ({
    promptScope: 'personal',
    category: makeCategory(),
    userId: 'user_a',
    userTeamIds: [],
    ...overrides,
  });

  // ---- global category: always allowed ----
  it.each<PromptScope>(['personal', 'team', 'global'])(
    'global category works on a %s prompt',
    (promptScope) => {
      expect(() =>
        assertCategoryScopeMatchesPromptScope(
          callArgs({
            promptScope,
            promptTeamId: promptScope === 'team' ? 'team_1' : undefined,
            category: makeCategory({ scope: 'global', createdBy: 'admin_x' }),
          }),
        ),
      ).not.toThrow();
    },
  );

  // ---- global prompt: only global category ----
  it('global prompt rejects a personal category', () => {
    expect(() =>
      assertCategoryScopeMatchesPromptScope(
        callArgs({
          promptScope: 'global',
          category: makeCategory({ scope: 'personal', createdBy: 'user_a' }),
        }),
      ),
    ).toThrow(ConvexError);
  });

  it('global prompt rejects a team category', () => {
    expect(() =>
      assertCategoryScopeMatchesPromptScope(
        callArgs({
          promptScope: 'global',
          category: makeCategory({
            scope: 'team',
            teamId: 'team_1',
            createdBy: 'admin_x',
          }),
        }),
      ),
    ).toThrow(ConvexError);
  });

  // ---- team prompt: global, or own-team team-category ----
  it('team prompt accepts a matching-team team category', () => {
    expect(() =>
      assertCategoryScopeMatchesPromptScope(
        callArgs({
          promptScope: 'team',
          promptTeamId: 'team_1',
          category: makeCategory({
            scope: 'team',
            teamId: 'team_1',
            createdBy: 'admin_x',
          }),
        }),
      ),
    ).not.toThrow();
  });

  it('team prompt rejects a different-team team category', () => {
    expect(() =>
      assertCategoryScopeMatchesPromptScope(
        callArgs({
          promptScope: 'team',
          promptTeamId: 'team_1',
          category: makeCategory({
            scope: 'team',
            teamId: 'team_2',
            createdBy: 'admin_x',
          }),
        }),
      ),
    ).toThrow(ConvexError);
  });

  it('team prompt rejects a personal category', () => {
    expect(() =>
      assertCategoryScopeMatchesPromptScope(
        callArgs({
          promptScope: 'team',
          promptTeamId: 'team_1',
          category: makeCategory({ scope: 'personal', createdBy: 'user_a' }),
        }),
      ),
    ).toThrow(ConvexError);
  });

  it('team prompt rejects a team category whose teamId is missing (defensive)', () => {
    expect(() =>
      assertCategoryScopeMatchesPromptScope(
        callArgs({
          promptScope: 'team',
          promptTeamId: 'team_1',
          category: makeCategory({
            scope: 'team',
            teamId: undefined,
            createdBy: 'admin_x',
          }),
        }),
      ),
    ).toThrow(ConvexError);
  });

  // ---- personal prompt: own-personal, own-team, or global ----
  it('personal prompt accepts the caller’s own personal category', () => {
    expect(() =>
      assertCategoryScopeMatchesPromptScope(
        callArgs({
          promptScope: 'personal',
          category: makeCategory({ scope: 'personal', createdBy: 'user_a' }),
        }),
      ),
    ).not.toThrow();
  });

  it('personal prompt rejects another user’s personal category', () => {
    expect(() =>
      assertCategoryScopeMatchesPromptScope(
        callArgs({
          promptScope: 'personal',
          category: makeCategory({ scope: 'personal', createdBy: 'user_b' }),
        }),
      ),
    ).toThrow(ConvexError);
  });

  it('personal prompt accepts a team category for a team the user is in', () => {
    expect(() =>
      assertCategoryScopeMatchesPromptScope(
        callArgs({
          promptScope: 'personal',
          userTeamIds: ['team_1', 'team_2'],
          category: makeCategory({
            scope: 'team',
            teamId: 'team_2',
            createdBy: 'admin_x',
          }),
        }),
      ),
    ).not.toThrow();
  });

  it('personal prompt rejects a team category for a team the user is not in', () => {
    expect(() =>
      assertCategoryScopeMatchesPromptScope(
        callArgs({
          promptScope: 'personal',
          userTeamIds: ['team_1'],
          category: makeCategory({
            scope: 'team',
            teamId: 'team_99',
            createdBy: 'admin_x',
          }),
        }),
      ),
    ).toThrow(ConvexError);
  });

  it('throws ConvexError with code "forbidden" on violation', () => {
    try {
      assertCategoryScopeMatchesPromptScope(
        callArgs({
          promptScope: 'global',
          category: makeCategory({ scope: 'personal', createdBy: 'user_a' }),
        }),
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const data = (err as ConvexError<{ code: string }>).data;
      expect(data.code).toBe('forbidden');
    }
  });
});
