import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Id } from '../_generated/dataModel';
import {
  checkProjectFolderAccess,
  hasKnowledgeHubFolderAccess,
  isProjectScopedFolder,
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
  } as unknown as Parameters<typeof checkProjectFolderAccess>[0];
}

type AnyFolder = Parameters<typeof checkProjectFolderAccess>[1];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isProjectScopedFolder', () => {
  it('is true only when projectId is set', () => {
    expect(isProjectScopedFolder({ projectId: 'p1' } as AnyFolder)).toBe(true);
    expect(isProjectScopedFolder({})).toBe(false);
    expect(isProjectScopedFolder({ teamId: 't1' })).toBe(false);
  });
});

describe('hasKnowledgeHubFolderAccess', () => {
  it('excludes project folders even when the user is in every team', () => {
    const folder = { projectId: 'p1' } as AnyFolder;
    expect(hasKnowledgeHubFolderAccess(folder, ['team-a', 'team-b'])).toBe(
      false,
    );
  });

  it('treats team-less hub folders as org-wide', () => {
    expect(hasKnowledgeHubFolderAccess({}, [])).toBe(true);
  });

  it('applies team rules to team-scoped hub folders', () => {
    const folder = { teamId: 'team-a' } as AnyFolder;
    expect(hasKnowledgeHubFolderAccess(folder, ['team-a'])).toBe(true);
    expect(hasKnowledgeHubFolderAccess(folder, ['team-b'])).toBe(false);
  });

  it('accepts partial projections like breadcrumb items', () => {
    // Structural typing: a breadcrumb item carries only scope fields — no
    // cast through Doc<'folders'> needed.
    const item = {
      teamId: null,
      teamTags: undefined,
      projectId: 'p1' as Id<'projects'>,
    };
    expect(hasKnowledgeHubFolderAccess(item, ['team-a'])).toBe(false);
  });
});

describe('checkProjectFolderAccess', () => {
  const orgArgs = { userId: 'user1', organizationId: 'org1' };
  const projectFolder = {
    organizationId: 'org1',
    projectId: 'p1',
  } as AnyFolder;
  const projects = {
    p1: { _id: 'p1', organizationId: 'org1', teamId: 'team_a' },
  };

  function memberWithRole(role: string) {
    mockGetOrganizationMember.mockResolvedValue({
      userId: 'user1',
      role,
    } as Awaited<ReturnType<typeof getOrganizationMember>>);
  }

  it('returns null for a hub folder', async () => {
    const ctx = createMockCtx(projects);
    const hubFolder = { organizationId: 'org1' } as AnyFolder;
    expect(await checkProjectFolderAccess(ctx, hubFolder, orgArgs)).toBeNull();
  });

  it('denies a folder from another organization', async () => {
    const ctx = createMockCtx(projects);
    const foreign = { organizationId: 'org2', projectId: 'p1' } as AnyFolder;
    const access = await checkProjectFolderAccess(ctx, foreign, orgArgs);
    expect(access).toMatchObject({ canRead: false, canEdit: false });
  });

  it('grants read but not edit to a plain member of the owning team', async () => {
    memberWithRole('member');
    mockGetUserTeamIds.mockResolvedValue(['team_a']);
    const ctx = createMockCtx(projects);
    const access = await checkProjectFolderAccess(ctx, projectFolder, orgArgs);
    expect(access).toMatchObject({ canRead: true, canEdit: false });
  });

  it('grants edit to editor-tier roles in the owning team', async () => {
    memberWithRole('editor');
    mockGetUserTeamIds.mockResolvedValue(['team_a']);
    const ctx = createMockCtx(projects);
    const access = await checkProjectFolderAccess(ctx, projectFolder, orgArgs);
    expect(access).toMatchObject({ canRead: true, canEdit: true });
  });

  it('denies everything outside the project teams', async () => {
    memberWithRole('editor');
    mockGetUserTeamIds.mockResolvedValue(['team_z']);
    const ctx = createMockCtx(projects);
    const access = await checkProjectFolderAccess(ctx, projectFolder, orgArgs);
    expect(access).toMatchObject({ canRead: false, canEdit: false });
  });

  it('keeps a dangling projectId locked rather than falling open', async () => {
    memberWithRole('admin');
    mockGetUserTeamIds.mockResolvedValue([]);
    const ctx = createMockCtx({});
    const dangling = {
      organizationId: 'org1',
      projectId: 'gone',
    } as AnyFolder;
    const access = await checkProjectFolderAccess(ctx, dangling, orgArgs);
    expect(access).toMatchObject({ canRead: false, canEdit: false });
  });

  it('denies when membership resolution fails', async () => {
    mockGetOrganizationMember.mockRejectedValue(new Error('no member'));
    const ctx = createMockCtx(projects);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const access = await checkProjectFolderAccess(ctx, projectFolder, orgArgs);
    expect(access).toMatchObject({ canRead: false, canEdit: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
