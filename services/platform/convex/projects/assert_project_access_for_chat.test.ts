import { describe, expect, it } from 'vitest';

import { hasProjectAccess } from './access';

/**
 * Decision-shape tests for the chat-path defense-in-depth used by
 * `internal_queries.assertProjectAccessForChat`. The query itself
 * wires `getOrganizationMember` + `getUserTeamIds` + `hasProjectAccess`;
 * the actual Convex query handler is exercised by connector via the
 * chat path. Here we lock in the EXPECTED VERDICTS for each access
 * shape, so a regression in `hasProjectAccess` would be loud.
 */

describe('chat-path access decision (project + role + teams)', () => {
  it('admin chats in any project regardless of team membership', () => {
    expect(hasProjectAccess({ teamId: 'team-X' }, [], 'admin')).toBe(true);
    expect(hasProjectAccess({ teamId: 'team-X' }, [], 'owner')).toBe(true);
  });

  it('member chats in an org-wide project', () => {
    expect(
      hasProjectAccess(
        { teamId: undefined, sharedWithTeamIds: [] },
        [],
        'member',
      ),
    ).toBe(true);
  });

  it('member without team is denied chat in a team-scoped project', () => {
    expect(hasProjectAccess({ teamId: 'team-X' }, [], 'member')).toBe(false);
  });

  it('member with the owning team can chat', () => {
    expect(hasProjectAccess({ teamId: 'team-X' }, ['team-X'], 'member')).toBe(
      true,
    );
  });

  it('member with a shared-with team can chat', () => {
    expect(
      hasProjectAccess(
        { teamId: 'team-X', sharedWithTeamIds: ['team-Y'] },
        ['team-Y'],
        'member',
      ),
    ).toBe(true);
  });

  it('disabled role is denied at the project-access helper layer', () => {
    expect(hasProjectAccess({ teamId: 'team-X' }, ['team-X'], 'disabled')).toBe(
      false,
    );
  });
});
