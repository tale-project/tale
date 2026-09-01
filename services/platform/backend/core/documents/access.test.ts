import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  canReadDocument,
  checkProjectDocumentAccess,
  hasKnowledgeHubDocumentAccess,
  isProjectScopedDocument,
  resolveKnowledgeAccessForUser,
} from './access';

vi.mock('../lib/get_user_teams', () => ({
  getUserTeamIds: vi.fn(),
}));
vi.mock('../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: vi.fn(),
}));

import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

const mockGetUserTeamIds = vi.mocked(getUserTeamIds);
const mockGetOrganizationMember = vi.mocked(getOrganizationMember);

function createMockCtx(projects: Record<string, Record<string, unknown>>) {
  return {
    db: {
      get: vi.fn(async (id: string) => projects[id] ?? null),
      // The projects walk in resolveKnowledgeAccessForUser: yield every
      // seeded project (the fixtures only ever seed the org under test).
      query: vi.fn(() => ({
        withIndex: vi.fn(() => ({
          async *[Symbol.asyncIterator]() {
            for (const project of Object.values(projects)) yield project;
          },
        })),
      })),
    },
  } as unknown as Parameters<typeof canReadDocument>[0];
}

type AnyDoc = Parameters<typeof canReadDocument>[1];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isProjectScopedDocument', () => {
  it('is true only when projectId is set', () => {
    expect(isProjectScopedDocument({ projectId: 'p1' } as AnyDoc)).toBe(true);
    expect(isProjectScopedDocument({})).toBe(false);
    expect(isProjectScopedDocument({ teamId: 't1' })).toBe(false);
  });
});

describe('hasKnowledgeHubDocumentAccess', () => {
  it('excludes project docs even when the user is in every team', () => {
    const doc = { projectId: 'p1' } as AnyDoc;
    expect(hasKnowledgeHubDocumentAccess(doc, ['team-a', 'team-b'])).toBe(
      false,
    );
  });

  it('treats team-less hub docs as org-wide', () => {
    expect(hasKnowledgeHubDocumentAccess({}, [])).toBe(true);
  });

  it('applies team rules to team-scoped hub docs', () => {
    const doc = { teamId: 'team-a' } as AnyDoc;
    expect(hasKnowledgeHubDocumentAccess(doc, ['team-a'])).toBe(true);
    expect(hasKnowledgeHubDocumentAccess(doc, ['team-b'])).toBe(false);
  });
});

describe('canReadDocument', () => {
  const orgArgs = { userId: 'user1', organizationId: 'org1' };

  it('denies a document from another organization', async () => {
    const ctx = createMockCtx({});
    const doc = { organizationId: 'org2' } as AnyDoc;
    expect(await canReadDocument(ctx, doc, orgArgs)).toBe(false);
  });

  it('delegates hub docs to team access', async () => {
    mockGetUserTeamIds.mockResolvedValue(['team-a']);
    const ctx = createMockCtx({});
    const orgWide = { organizationId: 'org1' } as AnyDoc;
    const otherTeam = { organizationId: 'org1', teamId: 'team-b' } as AnyDoc;
    expect(await canReadDocument(ctx, orgWide, orgArgs)).toBe(true);
    expect(await canReadDocument(ctx, otherTeam, orgArgs)).toBe(false);
  });

  it('allows a project doc when the user is in an owning team', async () => {
    mockGetOrganizationMember.mockResolvedValue({
      userId: 'user1',
      role: 'member',
    } as Awaited<ReturnType<typeof getOrganizationMember>>);
    mockGetUserTeamIds.mockResolvedValue(['team-a']);
    const ctx = createMockCtx({
      p1: { _id: 'p1', organizationId: 'org1', teamId: 'team-a' },
    });
    const doc = { organizationId: 'org1', projectId: 'p1' } as AnyDoc;
    expect(await canReadDocument(ctx, doc, orgArgs)).toBe(true);
  });

  it('denies a project doc when the user is outside the project teams', async () => {
    mockGetOrganizationMember.mockResolvedValue({
      userId: 'user1',
      role: 'member',
    } as Awaited<ReturnType<typeof getOrganizationMember>>);
    mockGetUserTeamIds.mockResolvedValue(['team-b']);
    const ctx = createMockCtx({
      p1: { _id: 'p1', organizationId: 'org1', teamId: 'team-a' },
    });
    const doc = { organizationId: 'org1', projectId: 'p1' } as AnyDoc;
    expect(await canReadDocument(ctx, doc, orgArgs)).toBe(false);
  });

  it('allows org admins into any project doc', async () => {
    mockGetOrganizationMember.mockResolvedValue({
      userId: 'user1',
      role: 'admin',
    } as Awaited<ReturnType<typeof getOrganizationMember>>);
    mockGetUserTeamIds.mockResolvedValue([]);
    const ctx = createMockCtx({
      p1: { _id: 'p1', organizationId: 'org1', teamId: 'team-a' },
    });
    const doc = { organizationId: 'org1', projectId: 'p1' } as AnyDoc;
    expect(await canReadDocument(ctx, doc, orgArgs)).toBe(true);
  });

  it('denies when the owning project is gone or in another org', async () => {
    mockGetOrganizationMember.mockResolvedValue({
      userId: 'user1',
      role: 'admin',
    } as Awaited<ReturnType<typeof getOrganizationMember>>);
    mockGetUserTeamIds.mockResolvedValue([]);
    const ctx = createMockCtx({
      foreign: { _id: 'foreign', organizationId: 'org2' },
    });
    const dangling = { organizationId: 'org1', projectId: 'gone' } as AnyDoc;
    const crossOrg = {
      organizationId: 'org1',
      projectId: 'foreign',
    } as AnyDoc;
    expect(await canReadDocument(ctx, dangling, orgArgs)).toBe(false);
    expect(await canReadDocument(ctx, crossOrg, orgArgs)).toBe(false);
  });

  it('denies when membership resolution fails', async () => {
    mockGetOrganizationMember.mockRejectedValue(new Error('no member'));
    const ctx = createMockCtx({
      p1: { _id: 'p1', organizationId: 'org1' },
    });
    const doc = { organizationId: 'org1', projectId: 'p1' } as AnyDoc;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await canReadDocument(ctx, doc, orgArgs)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('resolveKnowledgeAccessForUser', () => {
  const orgArgs = { organizationId: 'org1', userId: 'user1' };
  const projects = {
    orgWide: { _id: 'orgWide', organizationId: 'org1' },
    mine: { _id: 'mine', organizationId: 'org1', teamId: 'team-a' },
    shared: {
      _id: 'shared',
      organizationId: 'org1',
      teamId: 'team-z',
      sharedWithTeamIds: ['team-a'],
    },
    foreign: { _id: 'foreign', organizationId: 'org1', teamId: 'team-z' },
  };

  function memberWithRole(role: string) {
    mockGetOrganizationMember.mockResolvedValue({
      userId: 'user1',
      role,
    } as Awaited<ReturnType<typeof getOrganizationMember>>);
  }

  it("mirrors the listing rules: the user's teams, their projects, the hub", async () => {
    memberWithRole('member');
    mockGetUserTeamIds.mockResolvedValue(['team-a']);
    const access = await resolveKnowledgeAccessForUser(
      createMockCtx(projects),
      orgArgs,
    );
    expect(access.includeHub).toBe(true);
    // The org pseudo-team rides along, matching getAccessibleDocumentIds.
    expect(access.teamIds).toEqual(['org_org1', 'team-a']);
    // Org-wide + owning-team + shared-with — never the foreign-team project.
    expect([...access.projectIds].sort()).toEqual([
      'mine',
      'orgWide',
      'shared',
    ]);
  });

  it('carries the identity, so an emailed attachment can be decided at all', async () => {
    // The other fields are SETS — a conversation-scoped row cannot be expressed
    // as one, because its reader is whoever the mail is currently assigned to.
    // So the scope carries who asked, and the Convex-truth re-check asks the
    // conversation. Without the identity that re-check denies every such row,
    // which is the fail-closed direction but also means no inbox attachment is
    // ever found.
    memberWithRole('member');
    mockGetUserTeamIds.mockResolvedValue(['team-a']);
    const access = await resolveKnowledgeAccessForUser(
      createMockCtx(projects),
      orgArgs,
    );
    expect(access.userId).toBe('user1');
    expect(access.includeConversationScoped).toBe(true);
  });

  it('grants a denied caller no identity and no conversation rows', async () => {
    memberWithRole('disabled');
    mockGetUserTeamIds.mockResolvedValue(['team-a']);
    const access = await resolveKnowledgeAccessForUser(
      createMockCtx(projects),
      orgArgs,
    );
    expect(access.userId).toBeUndefined();
    expect(access.includeConversationScoped).toBeUndefined();
  });

  it('names which readable projects are archived, without dropping them', async () => {
    memberWithRole('member');
    mockGetUserTeamIds.mockResolvedValue(['team-a']);
    const withArchived = {
      ...projects,
      retired: {
        _id: 'retired',
        organizationId: 'org1',
        teamId: 'team-a',
        archivedAt: 1_700_000_000_000,
      },
    };
    const access = await resolveKnowledgeAccessForUser(
      createMockCtx(withArchived),
      orgArgs,
    );
    // Still readable: an archived project's material stays searchable.
    expect([...access.projectIds].sort()).toEqual([
      'mine',
      'orgWide',
      'retired',
      'shared',
    ]);
    // And separately labelled, so a result can say the project is retired.
    expect(access.archivedProjectIds).toEqual(['retired']);
  });

  it('reports no archived projects when none are', async () => {
    memberWithRole('member');
    mockGetUserTeamIds.mockResolvedValue(['team-a']);
    const access = await resolveKnowledgeAccessForUser(
      createMockCtx(projects),
      orgArgs,
    );
    expect(access.archivedProjectIds).toEqual([]);
  });

  it('never names an archived project the caller cannot read', async () => {
    memberWithRole('member');
    mockGetUserTeamIds.mockResolvedValue(['team-a']);
    const access = await resolveKnowledgeAccessForUser(
      createMockCtx({
        ...projects,
        foreignRetired: {
          _id: 'foreignRetired',
          organizationId: 'org1',
          teamId: 'team-z',
          archivedAt: 1,
        },
      }),
      orgArgs,
    );
    // A subset of projectIds, always. Otherwise the label would leak the
    // existence of a project the caller has no access to.
    expect(access.archivedProjectIds).toEqual([]);
    expect(access.projectIds).not.toContain('foreignRetired');
  });

  it('gives org admins every project', async () => {
    memberWithRole('admin');
    mockGetUserTeamIds.mockResolvedValue([]);
    const access = await resolveKnowledgeAccessForUser(
      createMockCtx(projects),
      orgArgs,
    );
    expect([...access.projectIds].sort()).toEqual([
      'foreign',
      'mine',
      'orgWide',
      'shared',
    ]);
  });

  it('fails closed when membership cannot be proven', async () => {
    mockGetOrganizationMember.mockRejectedValue(new Error('no member'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const access = await resolveKnowledgeAccessForUser(
      createMockCtx(projects),
      orgArgs,
    );
    warn.mockRestore();
    expect(access).toEqual({
      teamIds: [],
      projectIds: [],
      includeHub: false,
      archivedProjectIds: [],
    });
  });

  it('fails closed for a disabled member', async () => {
    memberWithRole('disabled');
    mockGetUserTeamIds.mockResolvedValue(['team-a']);
    const access = await resolveKnowledgeAccessForUser(
      createMockCtx(projects),
      orgArgs,
    );
    expect(access).toEqual({
      teamIds: [],
      projectIds: [],
      includeHub: false,
      archivedProjectIds: [],
    });
  });
});

describe('checkProjectDocumentAccess', () => {
  const orgArgs = { userId: 'user1', organizationId: 'org1' };
  const projectDoc = { organizationId: 'org1', projectId: 'p1' } as AnyDoc;
  const projects = {
    p1: { _id: 'p1', organizationId: 'org1', teamId: 'team_a' },
  };

  function memberWithRole(role: string) {
    mockGetOrganizationMember.mockResolvedValue({
      userId: 'user1',
      role,
    } as Awaited<ReturnType<typeof getOrganizationMember>>);
  }

  it('returns null for a non-project document', async () => {
    const ctx = createMockCtx(projects);
    const hubDoc = { organizationId: 'org1' } as AnyDoc;
    expect(await checkProjectDocumentAccess(ctx, hubDoc, orgArgs)).toBeNull();
  });

  it('grants read but not edit to a plain member of the owning team', async () => {
    memberWithRole('member');
    mockGetUserTeamIds.mockResolvedValue(['team_a']);
    const ctx = createMockCtx(projects);
    const access = await checkProjectDocumentAccess(ctx, projectDoc, orgArgs);
    expect(access).toMatchObject({ canRead: true, canEdit: false });
  });

  it('grants edit to editor-tier roles in the owning team', async () => {
    memberWithRole('editor');
    mockGetUserTeamIds.mockResolvedValue(['team_a']);
    const ctx = createMockCtx(projects);
    const access = await checkProjectDocumentAccess(ctx, projectDoc, orgArgs);
    expect(access).toMatchObject({ canRead: true, canEdit: true });
  });

  it('denies everything outside the project teams', async () => {
    memberWithRole('editor');
    mockGetUserTeamIds.mockResolvedValue(['team_z']);
    const ctx = createMockCtx(projects);
    const access = await checkProjectDocumentAccess(ctx, projectDoc, orgArgs);
    expect(access).toMatchObject({ canRead: false, canEdit: false });
  });
});
