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
 * and what takes a stamp off a row that is no attachment any more — or
 * releases the row, and the bytes nothing else would ever reach again.
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

type Release = (refs: string[]) => Promise<{
  released: string[];
  kept: string[];
  failures: unknown[];
}>;

type StampArgs = {
  organizationId: string;
  orgSlug: string;
  releaseCorpus: Release;
  releaseUnbacked: Release;
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

/** The releases the reconcile hands the attachments' pass: its first
 * walk's and its second's. */
async function wiredReleases(
  sql: Sql,
): Promise<Pick<StampArgs, 'releaseCorpus' | 'releaseUnbacked'>> {
  await runCorpusReconcile(sql);
  const args = reconcileMailAttachmentStamps.mock.calls[0]?.[1] as
    | StampArgs
    | undefined;
  if (args === undefined) throw new Error('the pass never ran');
  return args;
}

/** What the pass reports when it changed nothing. */
const QUIET = {
  scanned: 0,
  corrected: 0,
  released: 0,
  failures: 0,
  stampsScanned: 0,
  cleared: 0,
  unbackedReleased: 0,
  unbackedFailures: 0,
};

let info: MockInstance<typeof console.info>;
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  vi.clearAllMocks();
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  listKnowledgeDocumentRefs.mockResolvedValue([]);
  deleteKnowledgeDocumentsBatch.mockResolvedValue({ success: true });
  reconcileDocumentScopeStamps.mockResolvedValue({ scanned: 0, corrected: 0 });
  reconcileMailAttachmentStamps.mockResolvedValue(QUIET);
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
    const { releaseCorpus } = await wiredReleases(sql);
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

  it('releases a stamped row no attachment backs with its bytes, where the first walk leaves them', async () => {
    // An attachment deleted while its best-effort blob delete failed, or a
    // release job out of retries: nothing references the ref any more, and
    // once its corpus row goes, nothing would reach the bytes again — the
    // blob walk lists corpus refs only. Beside it, a ref a document still
    // holds (the pass only takes its stamp off): the release decides each
    // ref apart, so one call tells the two releases apart.
    const { sql, statements } = fakeSql([{ id: 'org-1', slug: 'acme' }], {
      's3:org-1/mail/filed.pdf': { corpusLive: true, blobLive: true },
    });
    const { releaseCorpus, releaseUnbacked } = await wiredReleases(sql);
    const outcome = await releaseUnbacked([
      's3:org-1/mail/orphan.pdf',
      's3:org-1/mail/filed.pdf',
    ]);
    expect(outcome).toEqual({
      released: ['s3:org-1/mail/orphan.pdf'],
      kept: ['s3:org-1/mail/filed.pdf'],
      failures: [],
    });
    expect(deleteKnowledgeDocumentsBatch).toHaveBeenCalledTimes(1);
    expect(deleteKnowledgeDocumentsBatch).toHaveBeenCalledWith({
      orgSlug: 'acme',
      fileIds: ['s3:org-1/mail/orphan.pdf'],
    });
    expect(deleteOrgObject).toHaveBeenCalledTimes(1);
    expect(deleteOrgObject).toHaveBeenCalledWith(
      'acme',
      'org-1/mail/orphan.pdf',
    );
    // A trashed, unbound file row that only remembers the ref goes too.
    expect(
      statements.filter((text) =>
        text.includes('DELETE FROM app.file_metadata'),
      ),
    ).toHaveLength(1);
    // The first walk's release, handed a ref the read calls just as dead,
    // keeps its bytes: its refs always have a live file row.
    await releaseCorpus(['s3:org-1/mail/cv.pdf']);
    expect(deleteOrgObject).toHaveBeenCalledTimes(1);
  });

  it('logs each failed release of either walk', async () => {
    deleteKnowledgeDocumentsBatch.mockRejectedValue(new Error('corpus down'));
    const { sql } = fakeSql([{ id: 'org-1', slug: 'acme' }]);
    const { releaseCorpus, releaseUnbacked } = await wiredReleases(sql);
    await releaseCorpus(['s3:org-1/mail/cv.pdf']);
    await releaseUnbacked(['s3:org-1/mail/orphan.pdf']);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      '[knowledge] reconcile release failed for s3:org-1/mail/cv.pdf (corpus): corpus down',
      '[knowledge] reconcile release failed for s3:org-1/mail/orphan.pdf (corpus): corpus down',
    ]);
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

  it('reports the stale stamps apart from drift, with what the second walk released and failed', async () => {
    reconcileMailAttachmentStamps.mockResolvedValue({
      ...QUIET,
      scanned: 4,
      stampsScanned: 9,
      cleared: 3,
      unbackedReleased: 2,
      unbackedFailures: 1,
    });
    await runCorpusReconcile(fakeSql([{ id: 'org-1', slug: 'acme' }]).sql);
    // No sync failed: no drift line.
    expect(lines(warn)).toEqual([]);
    // A cleared row is held by a document — filed into it, or one in any
    // lifecycle — or is a thread or chat file; the line names no one cause.
    expect(lines(info)).toEqual([
      '[knowledge] stale conversation stamps for acme: cleared=3 released=2 failures=1 (of stamped=9) — rows no emailed attachment backs any more (filed into or held by a document, or a thread/chat file), not a failed sync',
    ]);
  });

  it('reports a second-walk release on the stale-stamps line alone', async () => {
    reconcileMailAttachmentStamps.mockResolvedValue({
      ...QUIET,
      scanned: 1,
      stampsScanned: 3,
      unbackedReleased: 2,
    });
    await runCorpusReconcile(fakeSql([{ id: 'org-1', slug: 'acme' }]).sql);
    expect(lines(info)).toEqual([
      '[knowledge] stale conversation stamps for acme: cleared=0 released=2 failures=0 (of stamped=3) — rows no emailed attachment backs any more (filed into or held by a document, or a thread/chat file), not a failed sync',
    ]);
  });

  it('keeps the stamp line to what the first walk stamped, released and failed of the attachments it walked', async () => {
    reconcileMailAttachmentStamps.mockResolvedValue({
      ...QUIET,
      scanned: 4,
      corrected: 1,
      released: 2,
    });
    await runCorpusReconcile(fakeSql([{ id: 'org-1', slug: 'acme' }]).sql);
    expect(lines(info)).toEqual([
      '[knowledge] emailed attachments for acme: stamped=1 released=2 failures=0 (of scanned=4)',
    ]);
  });

  it('says nothing for an organization the pass changed nothing in', async () => {
    reconcileMailAttachmentStamps.mockResolvedValue({
      ...QUIET,
      scanned: 5,
      stampsScanned: 5,
    });
    await runCorpusReconcile(fakeSql([{ id: 'org-1', slug: 'acme' }]).sql);
    expect(lines(info)).toEqual([]);
    expect(lines(warn)).toEqual([]);
  });
});
