import { describe, expect, it, vi } from 'vitest';

import type { QueryCtx } from '../_generated/server';
import { searchDocumentsForMention } from './search_documents_for_mention';

interface FakeFileMeta {
  fileName: string;
  contentType: string;
  size: number;
  ragStatus?: 'queued' | 'running' | 'completed' | 'failed';
}

function createCtx(
  docs: Array<Record<string, unknown>>,
  fileMetaByStorageId: Record<string, FakeFileMeta>,
) {
  const paginate = vi.fn().mockResolvedValue({
    page: docs,
    isDone: true,
    continueCursor: '',
  });
  const documentsBuilder = {
    withIndex: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    paginate,
  };
  const ctx = {
    db: {
      query: vi.fn((table: string) => {
        if (table === 'documents') return documentsBuilder;
        // fileMetadata by_storageId point lookup: capture the eq() value the
        // index callback binds and resolve the matching row.
        return {
          withIndex: (
            _name: string,
            cb: (q: {
              eq: (field: string, value: unknown) => object;
            }) => unknown,
          ) => {
            let storageId: unknown;
            cb({
              eq: (_field, value) => {
                storageId = value;
                return {};
              },
            });
            return {
              first: () =>
                Promise.resolve(fileMetaByStorageId[String(storageId)] ?? null),
            };
          },
        };
      }),
    },
  };
  return { ctx, paginate };
}

const baseDoc = {
  organizationId: 'org_1',
  _creationTime: 1000,
};

describe('searchDocumentsForMention', () => {
  it('returns RAG-indexed docs matching the term by title', async () => {
    const { ctx } = createCtx(
      [
        { ...baseDoc, _id: 'd_1', title: 'Q3 Report', fileId: 'f_1' },
        { ...baseDoc, _id: 'd_2', title: 'Unrelated', fileId: 'f_2' },
      ],
      {
        f_1: {
          fileName: 'q3-report.pdf',
          contentType: 'application/pdf',
          size: 42,
          ragStatus: 'completed',
        },
        f_2: {
          fileName: 'other.pdf',
          contentType: 'application/pdf',
          size: 7,
          ragStatus: 'completed',
        },
      },
    );

    const results = await searchDocumentsForMention(
      ctx as unknown as QueryCtx,
      {
        organizationId: 'org_1',
        term: 'q3',
        userTeamIds: [],
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      documentId: 'd_1',
      fileId: 'f_1',
      title: 'Q3 Report',
      fileType: 'application/pdf',
      fileSize: 42,
    });
  });

  it('excludes documents without a fileId or without completed RAG status', async () => {
    const { ctx } = createCtx(
      [
        { ...baseDoc, _id: 'd_blobless', title: 'Report A' },
        { ...baseDoc, _id: 'd_queued', title: 'Report B', fileId: 'f_q' },
        { ...baseDoc, _id: 'd_failed', title: 'Report C', fileId: 'f_f' },
        { ...baseDoc, _id: 'd_nometa', title: 'Report D', fileId: 'f_none' },
        { ...baseDoc, _id: 'd_ok', title: 'Report E', fileId: 'f_ok' },
      ],
      {
        f_q: {
          fileName: 'b.pdf',
          contentType: 'application/pdf',
          size: 1,
          ragStatus: 'queued',
        },
        f_f: {
          fileName: 'c.pdf',
          contentType: 'application/pdf',
          size: 1,
          ragStatus: 'failed',
        },
        f_ok: {
          fileName: 'e.pdf',
          contentType: 'application/pdf',
          size: 1,
          ragStatus: 'completed',
        },
      },
    );

    const results = await searchDocumentsForMention(
      ctx as unknown as QueryCtx,
      {
        organizationId: 'org_1',
        term: 'report',
        userTeamIds: [],
      },
    );

    expect(results.map((r) => r.documentId)).toEqual(['d_ok']);
  });

  it('excludes documents without team access and inactive documents', async () => {
    const { ctx } = createCtx(
      [
        {
          ...baseDoc,
          _id: 'd_team_a',
          title: 'Doc team A',
          fileId: 'f_1',
          teamId: 'team_a',
        },
        {
          ...baseDoc,
          _id: 'd_team_b',
          title: 'Doc team B',
          fileId: 'f_2',
          teamId: 'team_b',
        },
        {
          ...baseDoc,
          _id: 'd_trashed',
          title: 'Doc trashed',
          fileId: 'f_3',
          lifecycleStatus: 'trashed',
        },
        { ...baseDoc, _id: 'd_org', title: 'Doc org-wide', fileId: 'f_4' },
      ],
      {
        f_1: {
          fileName: 'a.pdf',
          contentType: 'application/pdf',
          size: 1,
          ragStatus: 'completed',
        },
        f_2: {
          fileName: 'b.pdf',
          contentType: 'application/pdf',
          size: 1,
          ragStatus: 'completed',
        },
        f_3: {
          fileName: 'c.pdf',
          contentType: 'application/pdf',
          size: 1,
          ragStatus: 'completed',
        },
        f_4: {
          fileName: 'd.pdf',
          contentType: 'application/pdf',
          size: 1,
          ragStatus: 'completed',
        },
      },
    );

    const results = await searchDocumentsForMention(
      ctx as unknown as QueryCtx,
      {
        organizationId: 'org_1',
        term: 'doc',
        userTeamIds: ['team_a'],
      },
    );

    expect(results.map((r) => r.documentId).sort()).toEqual([
      'd_org',
      'd_team_a',
    ]);
  });

  it('never offers project-scoped documents, even to team members', async () => {
    const { ctx } = createCtx(
      [
        { ...baseDoc, _id: 'd_hub', title: 'Doc hub', fileId: 'f_1' },
        {
          ...baseDoc,
          _id: 'd_project',
          title: 'Doc project',
          fileId: 'f_2',
          projectId: 'proj_1',
        },
      ],
      {
        f_1: {
          fileName: 'hub.pdf',
          contentType: 'application/pdf',
          size: 1,
          ragStatus: 'completed',
        },
        f_2: {
          fileName: 'project.pdf',
          contentType: 'application/pdf',
          size: 1,
          ragStatus: 'completed',
        },
      },
    );

    const results = await searchDocumentsForMention(
      ctx as unknown as QueryCtx,
      {
        organizationId: 'org_1',
        term: 'doc',
        userTeamIds: ['team_a'],
      },
    );

    expect(results.map((r) => r.documentId)).toEqual(['d_hub']);
  });

  it('returns newest docs on an empty query and falls back to the blob file name when the title is empty', async () => {
    const { ctx } = createCtx(
      [
        {
          ...baseDoc,
          _id: 'd_untitled',
          title: '  ',
          fileId: 'f_1',
          mimeType: 'text/plain',
        },
      ],
      {
        f_1: {
          fileName: 'notes.txt',
          contentType: 'text/markdown',
          size: 9,
          ragStatus: 'completed',
        },
      },
    );

    const results = await searchDocumentsForMention(
      ctx as unknown as QueryCtx,
      {
        organizationId: 'org_1',
        term: '',
        userTeamIds: [],
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'notes.txt',
      // doc.mimeType wins over fileMetadata.contentType
      fileType: 'text/plain',
    });
  });
});
