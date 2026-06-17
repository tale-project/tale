import { beforeEach, describe, expect, it, vi } from 'vitest';

import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { fetchDocumentComparison } from './helpers/fetch_document_comparison';

const BASE_FILE_ID = 'file-base-123';
const COMP_FILE_ID = 'file-comp-456';
const ORG_SLUG = 'test-org';

interface RagDiffItem {
  type: 'added' | 'deleted' | 'modified' | 'context';
  base_content: string | null;
  comparison_content: string | null;
  content: string | null;
  inline_diff?: string | null;
  clause_ref?: string | null;
  base_page?: number | null;
  comparison_page?: number | null;
}

interface RagChangeBlock {
  context_before: string | null;
  items: RagDiffItem[];
  context_after: string | null;
}

interface RagCompareSuccess {
  success: true;
  base_document: { file_id: string | null; title: string | null };
  comparison_document: { file_id: string | null; title: string | null };
  change_blocks: RagChangeBlock[];
  stats: {
    total_paragraphs_base: number;
    total_paragraphs_comparison: number;
    unchanged: number;
    modified: number;
    added: number;
    deleted: number;
    high_divergence: boolean;
  };
  truncated: boolean;
}

interface RagCompareNotFound {
  error: string;
  file_id: string;
  role: string;
}

type RagCompareResult = RagCompareSuccess | RagCompareNotFound | null;

function createRagCompareSuccess(
  overrides?: Partial<RagCompareSuccess>,
): RagCompareSuccess {
  return {
    success: true,
    base_document: { file_id: BASE_FILE_ID, title: 'Base Doc' },
    comparison_document: { file_id: COMP_FILE_ID, title: 'Comparison Doc' },
    change_blocks: [
      {
        context_before: 'Some context before',
        items: [
          {
            type: 'modified',
            base_content: 'old text',
            comparison_content: 'new text',
            content: null,
            inline_diff: 'old -> new',
            clause_ref: '1.1',
            base_page: 1,
            comparison_page: 1,
          },
        ],
        context_after: 'Some context after',
      },
    ],
    stats: {
      total_paragraphs_base: 10,
      total_paragraphs_comparison: 12,
      unchanged: 8,
      modified: 1,
      added: 2,
      deleted: 1,
      high_divergence: false,
    },
    truncated: false,
    ...overrides,
  };
}

/**
 * Build a typed `ActionCtx` mock whose `runAction` resolves to `result`. The
 * RAG by-id comparison now flows through an in-process `ctx.runAction`, so the
 * test exercises that contract instead of `globalThis.fetch`/`RAG_URL`. The
 * returned `runAction` spy is asserted against; all other members are typed
 * stubs (never invoked by the helper).
 */
function createCtx(result: RagCompareResult) {
  const runAction = vi.fn().mockResolvedValue(result);
  const ctx: ActionCtx = {
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    runAction,
    scheduler: { runAfter: vi.fn(), runAt: vi.fn(), cancel: vi.fn() },
    auth: { getUserIdentity: vi.fn() },
    storage: {
      generateUploadUrl: vi.fn(),
      getUrl: vi.fn(),
      getMetadata: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      store: vi.fn(),
    },
    vectorSearch: vi.fn(),
  };
  return { ctx, runAction };
}

let runAction: ReturnType<typeof createCtx>['runAction'];
let ctx: ActionCtx;

function mockResult(result: RagCompareResult): void {
  ({ ctx, runAction } = createCtx(result));
}

beforeEach(() => {
  mockResult(createRagCompareSuccess());
});

describe('fetchDocumentComparison', () => {
  it('returns correctly mapped result on happy path', async () => {
    const result = await fetchDocumentComparison(
      ctx,
      ORG_SLUG,
      BASE_FILE_ID,
      COMP_FILE_ID,
    );

    expect(result.baseDocument).toEqual({
      fileId: BASE_FILE_ID,
      title: 'Base Doc',
    });
    expect(result.comparisonDocument).toEqual({
      fileId: COMP_FILE_ID,
      title: 'Comparison Doc',
    });
    expect(result.truncated).toBe(false);
    expect(result.stats).toEqual({
      totalParagraphsBase: 10,
      totalParagraphsComparison: 12,
      unchanged: 8,
      modified: 1,
      added: 2,
      deleted: 1,
      highDivergence: false,
    });
  });

  it('maps change blocks with all diff item fields', async () => {
    const result = await fetchDocumentComparison(
      ctx,
      ORG_SLUG,
      BASE_FILE_ID,
      COMP_FILE_ID,
    );

    expect(result.changeBlocks).toHaveLength(1);
    const block = result.changeBlocks[0];
    expect(block.contextBefore).toBe('Some context before');
    expect(block.contextAfter).toBe('Some context after');
    expect(block.items).toHaveLength(1);

    const item = block.items[0];
    expect(item.type).toBe('modified');
    expect(item.baseContent).toBe('old text');
    expect(item.comparisonContent).toBe('new text');
    expect(item.content).toBeNull();
    expect(item.inlineDiff).toBe('old -> new');
    expect(item.clauseRef).toBe('1.1');
    expect(item.basePage).toBe(1);
    expect(item.comparisonPage).toBe(1);
  });

  it('defaults nullable diff item fields to null', async () => {
    mockResult(
      createRagCompareSuccess({
        change_blocks: [
          {
            context_before: null,
            items: [
              {
                type: 'added',
                base_content: null,
                comparison_content: 'new paragraph',
                content: null,
              },
            ],
            context_after: null,
          },
        ],
      }),
    );

    const result = await fetchDocumentComparison(
      ctx,
      ORG_SLUG,
      BASE_FILE_ID,
      COMP_FILE_ID,
    );

    const item = result.changeBlocks[0].items[0];
    expect(item.inlineDiff).toBeNull();
    expect(item.clauseRef).toBeNull();
    expect(item.basePage).toBeNull();
    expect(item.comparisonPage).toBeNull();
  });

  it('calls compareDocuments with null maxChanges when not provided', async () => {
    await fetchDocumentComparison(ctx, ORG_SLUG, BASE_FILE_ID, COMP_FILE_ID);

    expect(runAction).toHaveBeenCalledWith(
      internal.rag.documents.compareDocuments,
      {
        orgSlug: ORG_SLUG,
        baseFileId: BASE_FILE_ID,
        comparisonFileId: COMP_FILE_ID,
        maxChanges: null,
      },
    );
  });

  it('forwards maxChanges as a runAction arg when provided', async () => {
    await fetchDocumentComparison(
      ctx,
      ORG_SLUG,
      BASE_FILE_ID,
      COMP_FILE_ID,
      50,
    );

    expect(runAction).toHaveBeenCalledWith(
      internal.rag.documents.compareDocuments,
      {
        orgSlug: ORG_SLUG,
        baseFileId: BASE_FILE_ID,
        comparisonFileId: COMP_FILE_ID,
        maxChanges: 50,
      },
    );
  });

  it('throws "not found" when compareDocuments returns null', async () => {
    mockResult(null);

    await expect(
      fetchDocumentComparison(ctx, ORG_SLUG, BASE_FILE_ID, COMP_FILE_ID),
    ).rejects.toThrow(/one or both documents were not found/);
  });

  it('throws a role-specific "not found" on an error result', async () => {
    mockResult({ error: 'not_found', file_id: BASE_FILE_ID, role: 'base' });

    await expect(
      fetchDocumentComparison(ctx, ORG_SLUG, BASE_FILE_ID, COMP_FILE_ID),
    ).rejects.toThrow(`base document (${BASE_FILE_ID}) was not found`);
  });

  it('handles empty change_blocks array', async () => {
    mockResult(
      createRagCompareSuccess({
        change_blocks: [],
        stats: {
          total_paragraphs_base: 5,
          total_paragraphs_comparison: 5,
          unchanged: 5,
          modified: 0,
          added: 0,
          deleted: 0,
          high_divergence: false,
        },
      }),
    );

    const result = await fetchDocumentComparison(
      ctx,
      ORG_SLUG,
      BASE_FILE_ID,
      COMP_FILE_ID,
    );

    expect(result.changeBlocks).toEqual([]);
    expect(result.stats.unchanged).toBe(5);
  });

  it('handles truncated response', async () => {
    mockResult(createRagCompareSuccess({ truncated: true }));

    const result = await fetchDocumentComparison(
      ctx,
      ORG_SLUG,
      BASE_FILE_ID,
      COMP_FILE_ID,
    );

    expect(result.truncated).toBe(true);
  });

  it('handles high_divergence flag', async () => {
    mockResult(
      createRagCompareSuccess({
        stats: {
          total_paragraphs_base: 100,
          total_paragraphs_comparison: 5,
          unchanged: 0,
          modified: 5,
          added: 0,
          deleted: 95,
          high_divergence: true,
        },
      }),
    );

    const result = await fetchDocumentComparison(
      ctx,
      ORG_SLUG,
      BASE_FILE_ID,
      COMP_FILE_ID,
    );

    expect(result.stats.highDivergence).toBe(true);
  });

  it('handles null document titles', async () => {
    mockResult(
      createRagCompareSuccess({
        base_document: { file_id: BASE_FILE_ID, title: null },
        comparison_document: { file_id: COMP_FILE_ID, title: null },
      }),
    );

    const result = await fetchDocumentComparison(
      ctx,
      ORG_SLUG,
      BASE_FILE_ID,
      COMP_FILE_ID,
    );

    expect(result.baseDocument.title).toBeNull();
    expect(result.comparisonDocument.title).toBeNull();
  });

  it('maps multiple change blocks', async () => {
    mockResult(
      createRagCompareSuccess({
        change_blocks: [
          {
            context_before: 'ctx1',
            items: [
              {
                type: 'deleted',
                base_content: 'removed',
                comparison_content: null,
                content: null,
              },
            ],
            context_after: null,
          },
          {
            context_before: null,
            items: [
              {
                type: 'added',
                base_content: null,
                comparison_content: 'inserted',
                content: null,
              },
            ],
            context_after: 'ctx2',
          },
        ],
      }),
    );

    const result = await fetchDocumentComparison(
      ctx,
      ORG_SLUG,
      BASE_FILE_ID,
      COMP_FILE_ID,
    );

    expect(result.changeBlocks).toHaveLength(2);
    expect(result.changeBlocks[0].items[0].type).toBe('deleted');
    expect(result.changeBlocks[1].items[0].type).toBe('added');
  });
});
