// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The nightly `knowledge.reconcile_corpus` body. Beyond the release walk it
 * runs two per-organization passes the corpus has no other backstop for:
 * the scope stamps, and the emailed attachments' pass — the only trigger of
 * the conversation-stamp backfill, and the only release of an attachment
 * whose conversation was deleted or marked spam before its lane queued one.
 * A reconcile that stopped calling that pass would leave every attachment
 * indexed before the stamp as an unstamped hub row for good, and nothing
 * else would notice.
 */

const { deleteKnowledgeDocumentsBatch, listKnowledgeDocumentRefs } = vi.hoisted(
  () => ({
    deleteKnowledgeDocumentsBatch:
      vi.fn<
        (args: { orgSlug: string; fileIds: string[] }) => Promise<unknown>
      >(),
    listKnowledgeDocumentRefs: vi.fn<() => Promise<string[]>>(),
  }),
);
const { deleteOrgObject } = vi.hoisted(() => ({ deleteOrgObject: vi.fn() }));
const { reconcileDocumentScopeStamps, reconcileMailAttachmentStamps } =
  vi.hoisted(() => ({
    reconcileDocumentScopeStamps: vi.fn(),
    reconcileMailAttachmentStamps: vi.fn(),
  }));

vi.mock('../../core/legacy/knowledge_delete.ts', () => ({
  deleteKnowledgeDocumentsBatch,
  listKnowledgeDocumentRefs,
}));
vi.mock('../../lib/object-store.ts', () => ({ deleteOrgObject }));
vi.mock('./service.ts', () => ({
  reconcileDocumentScopeStamps,
  reconcileMailAttachmentStamps,
}));

const { runCorpusReconcile } = await import('./release.ts');

type StampArgs = {
  organizationId: string;
  orgSlug: string;
  releaseCorpus: (
    refs: string[],
  ) => Promise<{ released: string[]; failures: unknown[] }>;
};

/** The organizations, and the liveness read of the refs handed back: every
 * ref is corpus-dead (its conversation is gone) and blob-live (the file row
 * still holds the bytes). */
function fakeSql(orgs: { id: string; slug: string | null }[]): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM "organization"')) return Promise.resolve(orgs);
    if (text.includes('FROM unnest(')) {
      const refs = values.at(-1) as string[];
      return Promise.resolve(
        refs.map((ref) => ({ ref, corpusLive: false, blobLive: true })),
      );
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return tag as unknown as Sql;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  listKnowledgeDocumentRefs.mockResolvedValue([]);
  deleteKnowledgeDocumentsBatch.mockResolvedValue({ success: true });
  reconcileDocumentScopeStamps.mockResolvedValue({ scanned: 0, corrected: 0 });
  reconcileMailAttachmentStamps.mockResolvedValue({
    scanned: 0,
    corrected: 0,
    released: 0,
    failures: 0,
  });
});

describe('runCorpusReconcile — the emailed attachments pass', () => {
  it('runs once for every organization with a slug', async () => {
    await runCorpusReconcile(
      fakeSql([
        { id: 'org-1', slug: 'acme' },
        { id: 'org-2', slug: null },
        { id: 'org-3', slug: 'beta' },
      ]),
    );
    expect(reconcileMailAttachmentStamps).toHaveBeenCalledTimes(2);
    expect(
      reconcileMailAttachmentStamps.mock.calls.map(([, args]) => {
        const { organizationId, orgSlug } = args as StampArgs;
        return { organizationId, orgSlug };
      }),
    ).toEqual([
      { organizationId: 'org-1', orgSlug: 'acme' },
      { organizationId: 'org-3', orgSlug: 'beta' },
    ]);
  });

  it('releases a dead attachment corpus-only: its bytes stay with the file row', async () => {
    await runCorpusReconcile(fakeSql([{ id: 'org-1', slug: 'acme' }]));
    const args = reconcileMailAttachmentStamps.mock.calls[0]?.[1] as
      | StampArgs
      | undefined;
    if (args === undefined) throw new Error('the pass never ran');
    const outcome = await args.releaseCorpus(['s3:org-1/mail/cv.pdf']);
    expect(outcome.released).toEqual(['s3:org-1/mail/cv.pdf']);
    expect(deleteKnowledgeDocumentsBatch).toHaveBeenCalledWith({
      orgSlug: 'acme',
      fileIds: ['s3:org-1/mail/cv.pdf'],
    });
    expect(deleteOrgObject).not.toHaveBeenCalled();
  });

  it('keeps going for the next organization when one pass fails', async () => {
    reconcileMailAttachmentStamps.mockRejectedValueOnce(
      new Error('corpus unreachable'),
    );
    await runCorpusReconcile(
      fakeSql([
        { id: 'org-1', slug: 'acme' },
        { id: 'org-3', slug: 'beta' },
      ]),
    );
    expect(reconcileMailAttachmentStamps).toHaveBeenCalledTimes(2);
  });
});
