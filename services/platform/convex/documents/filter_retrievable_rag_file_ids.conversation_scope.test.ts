// The gate that decides an emailed attachment.
//
// Its own file because it needs the identity modules mocked, and the sibling
// suite deliberately runs against a bare fake ctx. What is mocked here is only
// the Better Auth I/O — `resolveAgentReadAccess`, `authorizeRls` and
// `conversationAssignmentAllows` all run for real, so the rule under test is
// the shipped rule and not a restatement of it.

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

const ORG = 'org_mail';
const OTHER_ORG = 'org_other';
const USER = 'user_asking';
const TEAM_MINE = 'team_mine';
const TEAM_THEIRS = 'team_theirs';
const ATTACHMENT = 'blob_cv';
const CONVERSATION = 'conv_inbound';

/** Access that admits conversation rows, as the resolver now always does. */
const ACCESS = {
  teamIds: [],
  projectIds: [],
  includeHub: true,
  includeConversationScoped: true,
  userId: USER,
} as const;

/**
 * A ctx holding one emailed attachment bound to one conversation.
 *
 * `rows` overrides let a case bend one fact — the conversation's assignment,
 * its org, the metadata's status — without restating the rest.
 */
function createCtx(
  overrides: {
    metadata?: Record<string, unknown>;
    conversation?: Record<string, unknown> | null;
  } = {},
) {
  const metadata = {
    organizationId: ORG,
    storageId: ATTACHMENT,
    conversationId: CONVERSATION,
    ragStatus: 'completed',
    ...overrides.metadata,
  };
  const conversation =
    overrides.conversation === null
      ? null
      : { _id: CONVERSATION, organizationId: ORG, ...overrides.conversation };
  return {
    db: {
      query: () => ({
        withIndex: (
          _name: string,
          bind: (q: { eq: (f: string, v: unknown) => unknown }) => unknown,
        ) => {
          let storageId = '';
          const q = {
            eq(field: string, value: unknown) {
              if (field === 'storageId') storageId = String(value);
              return q;
            },
          };
          bind(q);
          return {
            first: async () => (storageId === ATTACHMENT ? metadata : null),
          };
        },
      }),
      get: async (id: string) => (id === CONVERSATION ? conversation : null),
    },
  } as never;
}

async function retrievableFor(
  ctx: unknown,
  args: Record<string, unknown> = {},
): Promise<string[]> {
  return filterRetrievableRagFileIds(ctx as never, {
    organizationId: ORG,
    fileIds: [ATTACHMENT],
    access: ACCESS,
    userId: USER,
    ...args,
  });
}

describe('filterRetrievableRagFileIds — emailed attachments', () => {
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
    ).toEqual([ATTACHMENT]);
  });

  it('serves a member of the assigned team', async () => {
    expect(
      await retrievableFor(
        createCtx({ conversation: { assigneeTeamId: TEAM_MINE } }),
      ),
    ).toEqual([ATTACHMENT]);
  });

  it('denies another team’s mail, and unassigned mail, to a plain member', async () => {
    expect(
      await retrievableFor(
        createCtx({ conversation: { assigneeTeamId: TEAM_THEIRS } }),
      ),
    ).toEqual([]);
    // Neither stamp is admin-triage state, not org-readable.
    expect(await retrievableFor(createCtx({ conversation: {} }))).toEqual([]);
  });

  it('serves an admin anything, including unassigned mail', async () => {
    getUserOrganizations.mockResolvedValue([
      { organizationId: ORG, role: 'admin' },
    ]);
    expect(await retrievableFor(createCtx({ conversation: {} }))).toEqual([
      ATTACHMENT,
    ]);
    expect(
      await retrievableFor(
        createCtx({ conversation: { assigneeTeamId: TEAM_THEIRS } }),
      ),
    ).toEqual([ATTACHMENT]);
  });

  it('denies a caller who did not say who they are', async () => {
    const ctx = createCtx({ conversation: { assigneeUserId: USER } });
    expect(await retrievableFor(ctx, { userId: undefined })).toEqual([]);
    // …and does not spend a membership lookup finding that out.
    expect(getUserOrganizations).not.toHaveBeenCalled();
  });

  it('denies when the scope excludes conversation rows', async () => {
    expect(
      await retrievableFor(
        createCtx({ conversation: { assigneeUserId: USER } }),
        {
          access: { ...ACCESS, includeConversationScoped: false },
        },
      ),
    ).toEqual([]);
  });

  it('denies a non-member and a role that cannot read conversations', async () => {
    const ctx = createCtx({ conversation: { assigneeUserId: USER } });
    getUserOrganizations.mockResolvedValue([]);
    expect(await retrievableFor(ctx)).toEqual([]);

    getUserOrganizations.mockResolvedValue([
      { organizationId: ORG, role: 'disabled' },
    ]);
    expect(await retrievableFor(ctx)).toEqual([]);
  });

  it('denies a conversation belonging to another organization', async () => {
    expect(
      await retrievableFor(
        createCtx({
          conversation: { assigneeUserId: USER, organizationId: OTHER_ORG },
        }),
      ),
    ).toEqual([]);
    // A dangling reference is a miss, not a crash.
    expect(await retrievableFor(createCtx({ conversation: null }))).toEqual([]);
  });

  it('never returns an emailed attachment to a folder-scoped search', async () => {
    expect(
      await retrievableFor(
        createCtx({ conversation: { assigneeUserId: USER } }),
        { folder: 'Contracts' },
      ),
    ).toEqual([]);
  });

  it('still requires the attachment itself to be indexed and untrashed', async () => {
    expect(
      await retrievableFor(
        createCtx({
          metadata: { ragStatus: 'running' },
          conversation: { assigneeUserId: USER },
        }),
      ),
    ).toEqual([]);
    expect(
      await retrievableFor(
        createCtx({
          metadata: { lifecycleStatus: 'trashed' },
          conversation: { assigneeUserId: USER },
        }),
      ),
    ).toEqual([]);
  });

  it('resolves teams once per call, and not at all when the assignee decides it', async () => {
    await retrievableFor(
      createCtx({ conversation: { assigneeUserId: USER } }),
      { fileIds: [ATTACHMENT, ATTACHMENT] as never },
    );
    // The individual-assignee branch settles it, so the Better Auth team
    // round-trip is never paid — the laziness `conversation_assignment.ts`
    // documents, preserved through this reader.
    expect(getUserTeamIds).toHaveBeenCalledTimes(1);
    expect(getUserOrganizations).toHaveBeenCalledTimes(1);
  });
});
