import { describe, it, expect, vi, beforeEach } from 'vitest';

// The cross-component team lookup is the call we want to prove is skipped for
// non-team-scoped tables. Spy on it and on the org lookup.
const getUserTeamIds = vi.fn();
const getUserOrganizations = vi.fn();
const getAuthUserIdentity = vi.fn();

vi.mock('../../get_user_teams', () => ({
  getUserTeamIds: (...args: unknown[]) => getUserTeamIds(...args),
}));
vi.mock('../organization/get_user_organizations', () => ({
  getUserOrganizations: (...args: unknown[]) => getUserOrganizations(...args),
}));
vi.mock('../auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => getAuthUserIdentity(...args),
}));

const { rlsRules } = await import('./rls_rules');

const USER = { userId: 'user_1', email: 'u@example.com', name: 'U' };
const ORG_ID = 'org_1';

function ruleCtx() {
  // The RLS rule context only carries `{ user }`; the wrappers pass the same
  // object the rules close over.
  return { user: USER } as never;
}

describe('rlsRules — lazy team-id resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUserIdentity.mockResolvedValue(USER);
    getUserOrganizations.mockResolvedValue([
      { organizationId: ORG_ID, role: 'admin', member: { _id: 'm1' } },
    ]);
    getUserTeamIds.mockResolvedValue(['team_a']);
  });

  it('does NOT resolve team IDs for a non-team-scoped table (projects)', async () => {
    const rules = await rlsRules({} as never);
    await rules.projects?.read?.(ruleCtx(), {
      organizationId: ORG_ID,
    } as never);

    expect(getUserTeamIds).not.toHaveBeenCalled();
  });

  it('resolves team IDs lazily — only when a team-scoped rule (documents) runs', async () => {
    const rules = await rlsRules({} as never);

    // Building the rules must not have eagerly fetched teams.
    expect(getUserTeamIds).not.toHaveBeenCalled();

    await rules.documents?.read?.(ruleCtx(), {
      organizationId: ORG_ID,
      teamId: null,
    } as never);

    expect(getUserTeamIds).toHaveBeenCalledTimes(1);
  });

  it('memoizes the team lookup across multiple team-scoped rule evaluations', async () => {
    const rules = await rlsRules({} as never);

    await rules.documents?.read?.(ruleCtx(), {
      organizationId: ORG_ID,
      teamId: null,
    } as never);
    await rules.documents?.read?.(ruleCtx(), {
      organizationId: ORG_ID,
      teamId: 'team_a',
    } as never);

    // Resolved once and reused — not re-fetched per row.
    expect(getUserTeamIds).toHaveBeenCalledTimes(1);
  });

  it('honours prefetched team IDs without calling the cross-component lookup', async () => {
    const rules = await rlsRules({} as never, {
      user: USER,
      userOrganizations: [
        {
          organizationId: ORG_ID,
          role: 'admin',
          member: { _id: 'm1' } as never,
        },
      ],
      userTeamIds: new Set(['team_a']),
    });

    await rules.documents?.read?.(ruleCtx(), {
      organizationId: ORG_ID,
      teamId: 'team_a',
    } as never);

    expect(getUserTeamIds).not.toHaveBeenCalled();
  });
});
