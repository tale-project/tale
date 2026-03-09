import { describe, it, expect, vi } from 'vitest';

import { getAccessibleFileIds } from '../get_accessible_document_ids';

vi.mock('../../lib/get_user_teams', () => ({
  getUserTeamIds: vi.fn(),
}));

import { getUserTeamIds } from '../../lib/get_user_teams';

const mockGetUserTeamIds = vi.mocked(getUserTeamIds);

function createMockCtx(docs: Array<Record<string, unknown>>) {
  const asyncIterator = {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < docs.length) {
            return { value: docs[index++], done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };

  const query = vi.fn().mockReturnValue({
    withIndex: vi.fn().mockReturnValue(asyncIterator),
  });

  return { db: { query } } as unknown as Parameters<
    typeof getAccessibleFileIds
  >[0];
}

describe('getAccessibleFileIds', () => {
  it('returns fileIds for completed org-wide documents', async () => {
    mockGetUserTeamIds.mockResolvedValue([]);
    const ctx = createMockCtx([
      { _id: 'doc1', fileId: 'file1', ragInfo: { status: 'completed' } },
      { _id: 'doc2', fileId: 'file2', ragInfo: { status: 'completed' } },
    ]);

    const ids = await getAccessibleFileIds(ctx, {
      organizationId: 'org1',
      userId: 'user1',
    });

    expect(ids).toEqual(['file1', 'file2']);
  });

  it('returns fileIds for documents in user teams', async () => {
    mockGetUserTeamIds.mockResolvedValue(['team-a']);
    const ctx = createMockCtx([
      {
        _id: 'doc1',
        fileId: 'file1',
        ragInfo: { status: 'completed' },
        teamId: 'team-a',
      },
      {
        _id: 'doc2',
        fileId: 'file2',
        ragInfo: { status: 'completed' },
        teamId: 'team-b',
      },
    ]);

    const ids = await getAccessibleFileIds(ctx, {
      organizationId: 'org1',
      userId: 'user1',
    });

    expect(ids).toEqual(['file1']);
  });

  it('skips documents without fileId', async () => {
    mockGetUserTeamIds.mockResolvedValue([]);
    const ctx = createMockCtx([
      { _id: 'doc1', ragInfo: { status: 'completed' } },
      { _id: 'doc2', fileId: 'file2', ragInfo: { status: 'completed' } },
      { _id: 'doc3', fileId: undefined, ragInfo: { status: 'completed' } },
    ]);

    const ids = await getAccessibleFileIds(ctx, {
      organizationId: 'org1',
      userId: 'user1',
    });

    expect(ids).toEqual(['file2']);
  });

  it('excludes non-completed documents', async () => {
    mockGetUserTeamIds.mockResolvedValue([]);
    const ctx = createMockCtx([
      { _id: 'doc1', fileId: 'file1', ragInfo: { status: 'queued' } },
      { _id: 'doc2', fileId: 'file2', ragInfo: { status: 'running' } },
      { _id: 'doc3', fileId: 'file3', ragInfo: { status: 'failed' } },
      { _id: 'doc4', fileId: 'file4' },
    ]);

    const ids = await getAccessibleFileIds(ctx, {
      organizationId: 'org1',
      userId: 'user1',
    });

    expect(ids).toEqual([]);
  });

  it('excludes documents from other teams', async () => {
    mockGetUserTeamIds.mockResolvedValue(['team-a']);
    const ctx = createMockCtx([
      {
        _id: 'doc1',
        fileId: 'file1',
        ragInfo: { status: 'completed' },
        teamId: 'team-x',
      },
    ]);

    const ids = await getAccessibleFileIds(ctx, {
      organizationId: 'org1',
      userId: 'user1',
    });

    expect(ids).toEqual([]);
  });

  it('returns empty array for empty organization', async () => {
    mockGetUserTeamIds.mockResolvedValue(['team-a']);
    const ctx = createMockCtx([]);

    const ids = await getAccessibleFileIds(ctx, {
      organizationId: 'org1',
      userId: 'user1',
    });

    expect(ids).toEqual([]);
  });

  it('combines org-wide and team documents', async () => {
    mockGetUserTeamIds.mockResolvedValue(['team-a']);
    const ctx = createMockCtx([
      { _id: 'doc1', fileId: 'file1', ragInfo: { status: 'completed' } },
      {
        _id: 'doc2',
        fileId: 'file2',
        ragInfo: { status: 'completed' },
        teamId: 'team-a',
      },
      {
        _id: 'doc3',
        fileId: 'file3',
        ragInfo: { status: 'completed' },
        teamId: 'team-b',
      },
      { _id: 'doc4', fileId: 'file4', ragInfo: { status: 'failed' } },
    ]);

    const ids = await getAccessibleFileIds(ctx, {
      organizationId: 'org1',
      userId: 'user1',
    });

    expect(ids).toEqual(['file1', 'file2']);
  });
});
