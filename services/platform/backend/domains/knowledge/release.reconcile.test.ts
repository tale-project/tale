// @vitest-environment node

import type { Sql } from 'postgres';
import {
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

/**
 * The nightly `knowledge.reconcile_corpus` body. Beyond the release walk it
 * runs two per-organization passes the corpus has no other backstop for:
 * the scope stamps, and the emailed attachments' pass — the only trigger of
 * the conversation-stamp backfill, the only release of an attachment
 * whose conversation was deleted or marked spam before its lane queued one,
 * and what takes a stamp off a row that is no attachment any more.
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
  releaseCorpus: (refs: string[]) => Promise<{
    released: string[];
    kept: string[];
    failures: unknown[];
  }>;
};

interface Liveness {
  corpusLive: boolean;
  blobLive: boolean;
}

/**
 * The organizations, and the liveness read of the refs handed back: `live`
 * per ref, else corpus-dead (its conversation is gone) AND blob-dead. A real
 * attachment's bytes stay live while its file row holds them; the read says
 * dead so that a release reaching the blob stage — `releaseRefs` — would
 * delete them here, and a test can tell. Every statement is recorded.
 */
function fakeSql(
  orgs: { id: string; slug: string | null }[],
  live: Record<string, Liveness> = {},
): { sql: Sql; statements: string[] } {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push(text);
    if (text.includes('FROM "organization"')) return Promise.resolve(orgs);
    if (text.includes('FROM unnest(')) {
      const refs = values.at(-1) as string[];
      return Promise.resolve(
        refs.map((ref) =>
          Object.assign(
            { ref },
            live[ref] ?? { corpusLive: false, blobLive: false },
          ),
        ),
      );
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: tag as unknown as Sql, statements };
}

/** The `releaseCorpus` the reconcile hands the attachments' pass. */
async function wiredRelease(sql: Sql): Promise<StampArgs['releaseCorpus']> {
  await runCorpusReconcile(sql);
  const args = reconcileMailAttachmentStamps.mock.calls[0]?.[1] as
    | StampArgs
    | undefined;
  if (args === undefined) throw new Error('the pass never ran');
  return args.releaseCorpus;
}

let info: MockInstance<typeof console.info>;
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  vi.clearAllMocks();
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  listKnowledgeDocumentRefs.mockResolvedValue([]);
  deleteKnowledgeDocumentsBatch.mockResolvedValue({ success: true });
  reconcileDocumentScopeStamps.mockResolvedValue({ scanned: 0, corrected: 0 });
  reconcileMailAttachmentStamps.mockResolvedValue({
    scanned: 0,
    corrected: 0,
    cleared: 0,
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
      ]).sql,
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
    const { sql, statements } = fakeSql([{ id: 'org-1', slug: 'acme' }]);
    const releaseCorpus = await wiredRelease(sql);
    const outcome = await releaseCorpus(['s3:org-1/mail/cv.pdf']);
    expect(outcome.released).toEqual(['s3:org-1/mail/cv.pdf']);
    expect(deleteKnowledgeDocumentsBatch).toHaveBeenCalledWith({
      orgSlug: 'acme',
      fileIds: ['s3:org-1/mail/cv.pdf'],
    });
    // The read called the bytes dead too, so a release that reached the
    // blob stage would have deleted them and reaped the file row.
    expect(deleteOrgObject).not.toHaveBeenCalled();
    expect(
      statements.filter((text) =>
        text.includes('DELETE FROM app.file_metadata'),
      ),
    ).toEqual([]);
  });

  it('hands back, untouched, a ref something still keeps in the corpus — the pass takes its stamp off', async () => {
    const { sql } = fakeSql([{ id: 'org-1', slug: 'acme' }], {
      's3:org-1/mail/filed.pdf': { corpusLive: true, blobLive: true },
    });
    const releaseCorpus = await wiredRelease(sql);
    const outcome = await releaseCorpus(['s3:org-1/mail/filed.pdf']);
    expect(outcome).toMatchObject({
      released: [],
      kept: ['s3:org-1/mail/filed.pdf'],
      failures: [],
    });
    expect(deleteKnowledgeDocumentsBatch).not.toHaveBeenCalled();
  });

  it('keeps going for the next organization when one pass fails', async () => {
    reconcileMailAttachmentStamps.mockRejectedValueOnce(
      new Error('corpus unreachable'),
    );
    await runCorpusReconcile(
      fakeSql([
        { id: 'org-1', slug: 'acme' },
        { id: 'org-3', slug: 'beta' },
      ]).sql,
    );
    expect(reconcileMailAttachmentStamps).toHaveBeenCalledTimes(2);
  });
});

describe('runCorpusReconcile — what the log says', () => {
  const lines = (spy: MockInstance<typeof console.info>) =>
    spy.mock.calls.map((call) => String(call[0]));

  it('reports scope drift as the failed per-edit sync it is', async () => {
    reconcileDocumentScopeStamps.mockResolvedValue({
      scanned: 9,
      corrected: 2,
    });
    await runCorpusReconcile(fakeSql([{ id: 'org-1', slug: 'acme' }]).sql);
    expect(lines(warn)).toEqual([
      '[knowledge] corpus scope drift for acme: corrected=2 of scanned=9 — the per-edit sync had failed for these',
    ]);
  });

  it('reports a cleared conversation stamp apart from drift, as what it is', async () => {
    reconcileMailAttachmentStamps.mockResolvedValue({
      scanned: 4,
      corrected: 0,
      cleared: 3,
      released: 0,
      failures: 0,
    });
    await runCorpusReconcile(fakeSql([{ id: 'org-1', slug: 'acme' }]).sql);
    // Nothing failed: no drift line.
    expect(lines(warn)).toEqual([]);
    expect(lines(info)).toEqual([
      '[knowledge] stale conversation stamps for acme: cleared=3 — rows no longer an emailed attachment (filed into a document), not a failed sync',
    ]);
  });

  it('keeps the stamp line to what it stamped, released and failed', async () => {
    reconcileMailAttachmentStamps.mockResolvedValue({
      scanned: 4,
      corrected: 1,
      cleared: 0,
      released: 2,
      failures: 0,
    });
    await runCorpusReconcile(fakeSql([{ id: 'org-1', slug: 'acme' }]).sql);
    expect(lines(info)).toEqual([
      '[knowledge] emailed attachments for acme: stamped=1 released=2 failures=0 (of scanned=4)',
    ]);
  });
});
