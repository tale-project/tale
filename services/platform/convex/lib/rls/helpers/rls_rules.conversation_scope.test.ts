// The WRITE half of built-in conversation assignment privacy. Reads are proven
// end-to-end through real queries in `conversations/conversation_access_rls.test.ts`;
// the write rules are driven here, directly, because no app path can reach the
// message-insert rule without first failing the read rule — it is the closed
// door behind the closed door, and only a direct call proves it is shut.

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const USER = { userId: 'user_editor', email: 'e@example.com', name: 'E' };
const ORG_ID = 'org_scope';
const TEAM_MINE = 'team_mine';
const TEAM_THEIRS = 'team_theirs';

function ruleCtx() {
  return { user: USER } as never;
}

/** A ctx whose only job is to hand back the parent conversation on `db.get`. */
function ctxWithParent(parent: unknown) {
  return { db: { get: () => Promise.resolve(parent) } } as never;
}

function conversation(fields: Record<string, unknown>) {
  return { organizationId: ORG_ID, status: 'open', ...fields } as never;
}

function message() {
  return {
    organizationId: ORG_ID,
    conversationId: 'conv_1',
    channel: 'email',
  } as never;
}

describe('conversations RLS — write rules follow assignment scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUserIdentity.mockResolvedValue(USER);
    getUserOrganizations.mockResolvedValue([
      { organizationId: ORG_ID, role: 'editor', member: { _id: 'm1' } },
    ]);
    getUserTeamIds.mockResolvedValue([TEAM_MINE]);
  });

  it('lets an editor modify their own team’s conversation', async () => {
    const rules = await rlsRules({} as never);
    expect(
      await rules.conversations?.modify?.(
        ruleCtx(),
        conversation({ assigneeTeamId: TEAM_MINE }),
      ),
    ).toBe(true);
  });

  it('denies modify on another team’s queue and on admin-triage mail', async () => {
    const rules = await rlsRules({} as never);
    expect(
      await rules.conversations?.modify?.(
        ruleCtx(),
        conversation({ assigneeTeamId: TEAM_THEIRS }),
      ),
    ).toBe(false);
    // Neither person nor team ⇒ admin triage, so not writable either.
    expect(
      await rules.conversations?.modify?.(ruleCtx(), conversation({})),
    ).toBe(false);
  });

  it('lets an admin modify anything, including admin-triage mail', async () => {
    getUserOrganizations.mockResolvedValue([
      { organizationId: ORG_ID, role: 'admin', member: { _id: 'm1' } },
    ]);
    const rules = await rlsRules({} as never);
    expect(
      await rules.conversations?.modify?.(
        ruleCtx(),
        conversation({ assigneeTeamId: TEAM_THEIRS }),
      ),
    ).toBe(true);
  });

  it('scopes a message INSERT by its parent, not by org membership alone', async () => {
    const mine = await rlsRules(
      ctxWithParent(conversation({ assigneeTeamId: TEAM_MINE })),
    );
    expect(
      await mine.conversationMessages?.insert?.(ruleCtx(), message()),
    ).toBe(true);

    const theirs = await rlsRules(
      ctxWithParent(conversation({ assigneeTeamId: TEAM_THEIRS })),
    );
    expect(
      await theirs.conversationMessages?.insert?.(ruleCtx(), message()),
    ).toBe(false);
  });

  it('fails closed when the parent conversation is gone', async () => {
    const rules = await rlsRules(ctxWithParent(null));
    expect(
      await rules.conversationMessages?.insert?.(ruleCtx(), message()),
    ).toBe(false);
  });
});
