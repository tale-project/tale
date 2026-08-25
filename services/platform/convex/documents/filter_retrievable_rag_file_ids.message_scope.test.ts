// The gate that decides an email MESSAGE.
//
// A sibling of the emailed-attachment suite, and mocked the same way: only the
// Better Auth I/O is faked, so `resolveAgentReadAccess`, `authorizeRls` and
// `conversationAssignmentAllows` all run for real and the rule under test is
// the shipped rule.
//
// A message is the only corpus class that is not a blob, so these cases also
// pin that it never reaches the `fileMetadata` lookup: the ctx below has no
// `fileMetadata` at all, and every pass here proves the decision happened
// before it.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUserTeamIds = vi.fn();
const getUserOrganizations = vi.fn();

vi.mock('../lib/get_user_teams', () => ({
  getUserTeamIds: (...args: unknown[]) => getUserTeamIds(...args),
}));
vi.mock('../lib/rls/organization/get_user_organizations', () => ({
  getUserOrganizations: (...args: unknown[]) => getUserOrganizations(...args),
}));

const { filterRetrievableRagFileIds } =
  await import('./filter_retrievable_rag_file_ids');
const { encodeMessageRef } = await import('../../lib/knowledge/message-ref');

const ORG = 'org_mail';
const USER = 'user_asking';
const TEAM_MINE = 'team_mine';
const TEAM_THEIRS = 'team_theirs';
const MESSAGE = 'msg_inbound';
const CONVERSATION = 'conv_inbound';
const REF = encodeMessageRef(MESSAGE);

const ACCESS = {
  teamIds: [],
  projectIds: [],
  includeHub: true,
  includeConversationScoped: true,
  userId: USER,
} as const;

/**
 * A ctx holding one message on one conversation, and NO `fileMetadata`.
 *
 * `normalizeId` answers for the message id only, so a case can hand in a ref
 * that is not a message id and see it refused before `get`.
 */
function createCtx(
  overrides: {
    message?: Record<string, unknown> | null;
    conversation?: Record<string, unknown> | null;
  } = {},
) {
  const message =
    overrides.message === null
      ? null
      : {
          _id: MESSAGE,
          organizationId: ORG,
          conversationId: CONVERSATION,
          ...overrides.message,
        };
  const conversation =
    overrides.conversation === null
      ? null
      : { _id: CONVERSATION, organizationId: ORG, ...overrides.conversation };
  return {
    db: {
      normalizeId: (table: string, id: string) =>
        table === 'conversationMessages' && id === MESSAGE ? id : null,
      query: () => {
        throw new Error(
          'a message must be decided before the fileMetadata lookup',
        );
      },
      get: async (id: string) => {
        if (id === MESSAGE) return message;
        if (id === CONVERSATION) return conversation;
        return null;
      },
    },
  } as never;
}

async function retrievableFor(
  ctx: unknown,
  args: Record<string, unknown> = {},
): Promise<string[]> {
  return filterRetrievableRagFileIds(ctx as never, {
    organizationId: ORG,
    fileIds: [REF],
    access: ACCESS,
    userId: USER,
    ...args,
  });
}

describe('filterRetrievableRagFileIds — email messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserOrganizations.mockResolvedValue([
      { organizationId: ORG, role: 'member' },
    ]);
    getUserTeamIds.mockResolvedValue([TEAM_MINE]);
  });

  it('serves the individual assignee', async () => {
    expect(
      await retrievableFor(
        createCtx({ conversation: { assigneeUserId: USER } }),
      ),
    ).toEqual([REF]);
  });

  it('serves a member of the assigned team', async () => {
    expect(
      await retrievableFor(
        createCtx({ conversation: { assigneeTeamId: TEAM_MINE } }),
      ),
    ).toEqual([REF]);
  });

  it('denies another team’s mail, and unassigned mail, to a plain member', async () => {
    expect(
      await retrievableFor(
        createCtx({ conversation: { assigneeTeamId: TEAM_THEIRS } }),
      ),
    ).toEqual([]);
    expect(await retrievableFor(createCtx({ conversation: {} }))).toEqual([]);
  });

  it('serves an admin anything, including unassigned mail', async () => {
    getUserOrganizations.mockResolvedValue([
      { organizationId: ORG, role: 'admin' },
    ]);
    expect(await retrievableFor(createCtx({ conversation: {} }))).toEqual([
      REF,
    ]);
  });

  it('denies a message whose conversation is in another organization', async () => {
    expect(
      await retrievableFor(
        createCtx({
          conversation: { organizationId: 'org_other', assigneeUserId: USER },
        }),
      ),
    ).toEqual([]);
  });

  it('denies a message row belonging to another organization', async () => {
    expect(
      await retrievableFor(
        createCtx({
          message: { organizationId: 'org_other' },
          conversation: { assigneeUserId: USER },
        }),
      ),
    ).toEqual([]);
  });

  it('denies a ref whose message row is gone', async () => {
    expect(
      await retrievableFor(
        createCtx({ message: null, conversation: { assigneeUserId: USER } }),
      ),
    ).toEqual([]);
  });

  it('denies a ref whose conversation is gone', async () => {
    expect(await retrievableFor(createCtx({ conversation: null }))).toEqual([]);
  });

  it('denies a ref that is not a conversationMessages id', async () => {
    // `normalizeId` refuses it, so the decision never reaches `get`.
    expect(
      await retrievableFor(
        createCtx({ conversation: { assigneeUserId: USER } }),
        { fileIds: ['msg:not-an-id'] },
      ),
    ).toEqual([]);
  });

  it('denies a bare prefix carrying no id', async () => {
    expect(
      await retrievableFor(
        createCtx({ conversation: { assigneeUserId: USER } }),
        { fileIds: ['msg:'] },
      ),
      // Denied by the message branch. It must NOT fall through to the blob
      // path: this ctx's `query` throws, so a fall-through fails the test.
    ).toEqual([]);
  });

  it('honours a scope that excludes conversations', async () => {
    expect(
      await retrievableFor(
        createCtx({ conversation: { assigneeUserId: USER } }),
        { access: { ...ACCESS, includeConversationScoped: false } },
      ),
    ).toEqual([]);
  });

  it('never answers a folder-scoped search', async () => {
    expect(
      await retrievableFor(
        createCtx({ conversation: { assigneeUserId: USER } }),
        { folder: 'Contracts' },
      ),
    ).toEqual([]);
  });

  it('denies when there is no caller to decide with', async () => {
    expect(
      await retrievableFor(
        createCtx({ conversation: { assigneeUserId: USER } }),
        { userId: undefined },
      ),
    ).toEqual([]);
  });
});
