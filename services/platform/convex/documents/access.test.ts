import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  canReadDocument,
  checkProjectDocumentAccess,
  hasKnowledgeHubDocumentAccess,
  isProjectScopedDocument,
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
    expect(isProjectScopedDocument({} as AnyDoc)).toBe(false);
    expect(isProjectScopedDocument({ teamId: 't1' } as AnyDoc)).toBe(false);
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
    expect(hasKnowledgeHubDocumentAccess({} as AnyDoc, [])).toBe(true);
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
