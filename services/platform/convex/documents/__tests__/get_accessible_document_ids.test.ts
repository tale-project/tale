import { describe, it, expect, vi } from 'vitest';

import { getAccessibleDocumentIds } from '../get_accessible_document_ids';

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
    typeof getAccessibleDocumentIds
  >[0];
}

describe('getAccessibleDocumentIds', () => {
  it('returns completed org-wide documents', async () => {
    mockGetUserTeamIds.mockResolvedValue([]);
    const ctx = createMockCtx([
      { _id: 'doc1', ragInfo: { status: 'completed' } },
      { _id: 'doc2', ragInfo: { status: 'completed' }, teamId: undefined },
    ]);

    const ids = await getAccessibleDocumentIds(ctx, {
      organizationId: 'org1',
      userId: 'user1',
    });

    expect(ids).toEqual(['doc1', 'doc2']);
  });

  it('returns documents in user teams', async () => {
    mockGetUserTeamIds.mockResolvedValue(['team-a']);
    const ctx = createMockCtx([
      { _id: 'doc1', ragInfo: { status: 'completed' }, teamId: 'team-a' },
      { _id: 'doc2', ragInfo: { status: 'completed' }, teamId: 'team-b' },
    ]);

    const ids = await getAccessibleDocumentIds(ctx, {
      organizationId: 'org1',
      userId: 'user1',
    });

    expect(ids).toEqual(['doc1']);
  });

  it('excludes documents from other teams', async () => {
    mockGetUserTeamIds.mockResolvedValue(['team-a', 'team-b']);
    const ctx = createMockCtx([
      { _id: 'doc1', ragInfo: { status: 'completed' }, teamId: 'team-x' },
    ]);

    const ids = await getAccessibleDocumentIds(ctx, {
      organizationId: 'org1',
      userId: 'user1',
    });

    expect(ids).toEqual([]);
  });

  it('excludes non-completed documents', async () => {
    mockGetUserTeamIds.mockResolvedValue([]);
    const ctx = createMockCtx([
      { _id: 'doc1', ragInfo: { status: 'queued' } },
      { _id: 'doc2', ragInfo: { status: 'running' } },
      { _id: 'doc3', ragInfo: { status: 'failed' } },
      { _id: 'doc4' },
    ]);

    const ids = await getAccessibleDocumentIds(ctx, {
      organizationId: 'org1',
      userId: 'user1',
    });

    expect(ids).toEqual([]);
  });

  it('returns empty array for empty organization', async () => {
    mockGetUserTeamIds.mockResolvedValue(['team-a']);
    const ctx = createMockCtx([]);

    const ids = await getAccessibleDocumentIds(ctx, {
      organizationId: 'org1',
      userId: 'user1',
    });

    expect(ids).toEqual([]);
  });

  it('combines org-wide and team documents', async () => {
    mockGetUserTeamIds.mockResolvedValue(['team-a']);
    const ctx = createMockCtx([
      { _id: 'doc1', ragInfo: { status: 'completed' } },
      { _id: 'doc2', ragInfo: { status: 'completed' }, teamId: 'team-a' },
      { _id: 'doc3', ragInfo: { status: 'completed' }, teamId: 'team-b' },
      { _id: 'doc4', ragInfo: { status: 'failed' } },
    ]);

    const ids = await getAccessibleDocumentIds(ctx, {
      organizationId: 'org1',
      userId: 'user1',
    });

    expect(ids).toEqual(['doc1', 'doc2']);
  });
});
