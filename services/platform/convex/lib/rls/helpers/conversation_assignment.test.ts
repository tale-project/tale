import { describe, expect, it, vi } from 'vitest';

import {
  type ConversationAssignment,
  conversationAssignmentAllows,
} from './conversation_assignment';

const NO_TEAMS = { hasTeam: () => false };

function caller(
  over: Partial<Parameters<typeof conversationAssignmentAllows>[1]> = {},
) {
  return { isAdmin: false, userId: 'user_1', ...NO_TEAMS, ...over };
}

describe('conversationAssignmentAllows', () => {
  it('grants an admin every conversation', async () => {
    const unassigned: ConversationAssignment = {};
    expect(
      await conversationAssignmentAllows(unassigned, caller({ isAdmin: true })),
    ).toBe(true);
  });

  // The most sensitive row, not the least: an inbox row nobody owns yet must
  // not be org-readable just because it has no assignee to exclude anyone.
  it('hides an unassigned conversation from a plain member', async () => {
    expect(await conversationAssignmentAllows({}, caller())).toBe(false);
  });

  it('grants the individual assignee', async () => {
    expect(
      await conversationAssignmentAllows(
        { assigneeUserId: 'user_1' },
        caller(),
      ),
    ).toBe(true);
  });

  it('denies a member who is not the individual assignee', async () => {
    expect(
      await conversationAssignmentAllows(
        { assigneeUserId: 'someone_else' },
        caller(),
      ),
    ).toBe(false);
  });

  it('grants a member of the assigned team', async () => {
    expect(
      await conversationAssignmentAllows(
        { assigneeTeamId: 'team_a' },
        caller({ hasTeam: (id) => id === 'team_a' }),
      ),
    ).toBe(true);
  });

  it('denies a member of a different team', async () => {
    expect(
      await conversationAssignmentAllows(
        { assigneeTeamId: 'team_a' },
        caller({ hasTeam: (id) => id === 'team_b' }),
      ),
    ).toBe(false);
  });

  it('grants either side when both stamps are set (the union)', async () => {
    const both = { assigneeUserId: 'owner_1', assigneeTeamId: 'team_a' };
    expect(
      await conversationAssignmentAllows(
        both,
        caller({ userId: 'owner_1', hasTeam: () => false }),
      ),
    ).toBe(true);
    expect(
      await conversationAssignmentAllows(
        both,
        caller({ userId: 'nobody', hasTeam: (id) => id === 'team_a' }),
      ),
    ).toBe(true);
  });

  // The laziness `rls_rules.ts` depends on: resolving team ids is a
  // cross-component Better Auth round-trip, so the cheap branches must decide
  // without it (see rls_rules.lazy_teams.test.ts).
  it('never asks about teams when the individual assignee already matches', async () => {
    const hasTeam = vi.fn(() => true);
    await conversationAssignmentAllows(
      { assigneeUserId: 'user_1', assigneeTeamId: 'team_a' },
      caller({ hasTeam }),
    );
    expect(hasTeam).not.toHaveBeenCalled();
  });

  it('never asks about teams for an admin, or for an unassigned row', async () => {
    const hasTeam = vi.fn(() => true);
    await conversationAssignmentAllows(
      { assigneeTeamId: 'team_a' },
      caller({ isAdmin: true, hasTeam }),
    );
    await conversationAssignmentAllows({}, caller({ hasTeam }));
    expect(hasTeam).not.toHaveBeenCalled();
  });

  it('awaits an async team lookup', async () => {
    expect(
      await conversationAssignmentAllows(
        { assigneeTeamId: 'team_a' },
        caller({ hasTeam: async (id) => id === 'team_a' }),
      ),
    ).toBe(true);
  });

  // Fail-closed: a caller with no identity is not the assignee of anything,
  // even when the stamp is also absent on that side.
  it('denies an anonymous caller', async () => {
    expect(
      await conversationAssignmentAllows(
        { assigneeUserId: 'user_1' },
        caller({ userId: undefined }),
      ),
    ).toBe(false);
  });
});
