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
 * else would notice. Bytes a release of the reconcile could not delete once
 * their corpus rows were gone go to the durable release job, since no walk
 * would ever list their ref again.
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
const { addJobInTx } = vi.hoisted(() => ({
  addJobInTx: vi.fn(
    async (_sql: unknown, _name: string, _payload: unknown) => 'job-1',
  ),
}));

vi.mock('../../core/legacy/knowledge_delete.ts', () => ({
  deleteKnowledgeDocumentsBatch,
  listKnowledgeDocumentRefs,
}));
vi.mock('../../lib/object-store.ts', () => ({ deleteOrgObject }));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx }));
vi.mock('./service.ts', () => ({
  reconcileDocumentScopeStamps,
  reconcileMailAttachmentStamps,
}));

const { runCorpusReconcile, settleReleaseOutcome } =
  await import('./release.ts');

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
  restamped: 0,
  unbackedReleased: 0,
  unbackedFailures: 0,
  recheckReleased: 0,
  recheckFailures: 0,
};

let info: MockInstance<typeof console.info>;
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  vi.clearAllMocks();
  deleteOrgObject.mockReset();
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
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('queues the release job for bytes the stamp pass could not delete once their corpus rows went', async () => {
    deleteOrgObject.mockRejectedValue(new Error('s3 down'));
    const { sql } = fakeSql([{ id: 'org-1', slug: 'acme' }]);
    const { releaseUnbacked } = await wiredReleases(sql);
    const outcome = await releaseUnbacked(['s3:org-1/mail/orphan.pdf']);
    expect(outcome.failures).toEqual([
      { ref: 's3:org-1/mail/orphan.pdf', stage: 'blob', message: 's3 down' },
    ]);
    // Nothing lists the ref again: the second walk reads stamped corpus
    // rows, and that row is gone.
    expect(deleteKnowledgeDocumentsBatch).toHaveBeenCalledWith({
      orgSlug: 'acme',
      fileIds: ['s3:org-1/mail/orphan.pdf'],
    });
    expect(addJobInTx).toHaveBeenCalledTimes(1);
    expect(addJobInTx).toHaveBeenCalledWith(sql, 'knowledge.release_refs', {
      organizationId: 'org-1',
      refs: ['s3:org-1/mail/orphan.pdf'],
    });
    // The job retries the delete: the line says so, never reading as final.
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      '[knowledge] reconcile release failed for s3:org-1/mail/orphan.pdf (blob): s3 down — re-queued to knowledge.release_refs',
    ]);
  });

  it('queues nothing for a ref whose corpus delete failed: its row lists it for the next night', async () => {
    deleteKnowledgeDocumentsBatch.mockRejectedValue(new Error('corpus down'));
    deleteOrgObject.mockRejectedValue(new Error('s3 down'));
    const { sql } = fakeSql([{ id: 'org-1', slug: 'acme' }]);
    const { releaseUnbacked } = await wiredReleases(sql);
    const outcome = await releaseUnbacked(['s3:org-1/mail/orphan.pdf']);
    // The bytes stay with the row, for a retry that releases both.
    expect(outcome.failures).toEqual([
      {
        ref: 's3:org-1/mail/orphan.pdf',
        stage: 'corpus',
        message: 'corpus down',
      },
    ]);
    expect(deleteOrgObject).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('logs a re-queue that fails and hands the outcome on, for the pass to go on', async () => {
    deleteOrgObject.mockRejectedValue(new Error('s3 down'));
    addJobInTx.mockRejectedValueOnce(new Error('queue down'));
    const { sql } = fakeSql([{ id: 'org-1', slug: 'acme' }]);
    const { releaseUnbacked } = await wiredReleases(sql);
    const outcome = await releaseUnbacked(['s3:org-1/mail/orphan.pdf']);
    expect(outcome.failures).toHaveLength(1);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      '[knowledge] reconcile release failed for s3:org-1/mail/orphan.pdf (blob): s3 down — not re-queued',
      '[knowledge] could not re-queue a byte release for org org-1 (refs=1), their bytes stay:',
    ]);
  });

  it('says of each failed byte delete whether its job was queued, when only one job failed', async () => {
    deleteOrgObject.mockRejectedValue(new Error('s3 down'));
    addJobInTx.mockRejectedValueOnce(new Error('queue down'));
    const { sql } = fakeSql([{ id: 'org-1', slug: 'acme' }]);
    const { releaseUnbacked } = await wiredReleases(sql);
    const refs = Array.from(
      { length: 501 },
      (_, at) => `s3:org-1/mail/orphan-${String(at).padStart(3, '0')}.pdf`,
    );
    await releaseUnbacked(refs);
    // The first job of 500 failed to queue, the second went.
    expect(addJobInTx).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      ...refs
        .slice(0, 500)
        .map(
          (ref) =>
            `[knowledge] reconcile release failed for ${ref} (blob): s3 down — not re-queued`,
        ),
      ...refs
        .slice(500)
        .map(
          (ref) =>
            `[knowledge] reconcile release failed for ${ref} (blob): s3 down — re-queued to knowledge.release_refs`,
        ),
      '[knowledge] could not re-queue a byte release for org org-1 (refs=500), their bytes stay:',
    ]);
  });

  it('queues the bytes it could not delete in jobs of at most 500 refs', async () => {
    deleteOrgObject.mockRejectedValue(new Error('s3 down'));
    const { sql } = fakeSql([{ id: 'org-1', slug: 'acme' }]);
    const { releaseUnbacked } = await wiredReleases(sql);
    const refs = Array.from(
      { length: 501 },
      (_, at) => `s3:org-1/mail/orphan-${String(at).padStart(3, '0')}.pdf`,
    );
    await releaseUnbacked(refs);
    expect(
      addJobInTx.mock.calls.map(([, name, payload]) => ({
        name,
        refs: (payload as { refs: string[] }).refs,
      })),
    ).toEqual([
      { name: 'knowledge.release_refs', refs: refs.slice(0, 500) },
      { name: 'knowledge.release_refs', refs: refs.slice(500) },
    ]);
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

  it('queues the release job for bytes the blob walk could not delete, its corpus-stage failures aside', async () => {
    // The blob walk lists corpus refs: once a dead ref's rows are gone it is
    // never listed again, so bytes it failed to delete would stay for good.
    listKnowledgeDocumentRefs.mockResolvedValueOnce([
      's3:org-1/docs/rotated.pdf',
    ]);
    deleteOrgObject.mockRejectedValue(new Error('s3 down'));
    const { sql } = fakeSql([{ id: 'org-1', slug: 'acme' }]);
    await runCorpusReconcile(sql);
    expect(addJobInTx).toHaveBeenCalledTimes(1);
    expect(addJobInTx).toHaveBeenCalledWith(sql, 'knowledge.release_refs', {
      organizationId: 'org-1',
      refs: ['s3:org-1/docs/rotated.pdf'],
    });
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      '[knowledge] reconcile release failed for s3:org-1/docs/rotated.pdf (blob): s3 down — re-queued to knowledge.release_refs',
    ]);

    // A failed corpus delete keeps the row, which the next night lists.
    addJobInTx.mockClear();
    listKnowledgeDocumentRefs.mockResolvedValueOnce([
      's3:org-1/docs/rotated.pdf',
    ]);
    deleteKnowledgeDocumentsBatch.mockRejectedValue(new Error('corpus down'));
    await runCorpusReconcile(sql);
    expect(addJobInTx).not.toHaveBeenCalled();
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

  it('reports the stale stamps apart from drift, each outcome of the second walk apart', async () => {
    reconcileMailAttachmentStamps.mockResolvedValue({
      ...QUIET,
      scanned: 4,
      stampsScanned: 9,
      cleared: 3,
      restamped: 1,
      unbackedReleased: 2,
      unbackedFailures: 1,
      recheckReleased: 1,
      recheckFailures: 1,
    });
    await runCorpusReconcile(fakeSql([{ id: 'org-1', slug: 'acme' }]).sql);
    // No sync failed: no drift line.
    expect(lines(warn)).toEqual([]);
    // Cleared, released, or back to an attachment by the time the clear
    // landed: the line names what the rows have in common, no one cause.
    expect(lines(info)).toEqual([
      '[knowledge] stale conversation stamps for acme: cleared=3 restamped=1 released=2 failures=1 recheckReleased=1 recheckFailures=1 (of stamped=9) — rows no emailed attachment backed when the walk read them, not a failed sync',
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
      '[knowledge] stale conversation stamps for acme: cleared=0 restamped=0 released=2 failures=0 recheckReleased=0 recheckFailures=0 (of stamped=3) — rows no emailed attachment backed when the walk read them, not a failed sync',
    ]);
  });

  it.each([
    ['a stamp the recheck put back', { restamped: 1 }],
    ['an attachment the recheck released', { recheckReleased: 1 }],
    ['a release of the recheck that failed', { recheckFailures: 1 }],
  ])('reports %s even when nothing stayed cleared', async (_name, counts) => {
    reconcileMailAttachmentStamps.mockResolvedValue({
      ...QUIET,
      stampsScanned: 1,
      ...counts,
    });
    await runCorpusReconcile(fakeSql([{ id: 'org-1', slug: 'acme' }]).sql);
    expect(lines(info)).toHaveLength(1);
    expect(lines(info)[0]).toContain('stale conversation stamps for acme');
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

describe('settleReleaseOutcome — one step for both stages', () => {
  // Two helpers used to settle a release: one logged the corpus stage and
  // skipped the blob stage, trusting every caller to pipe the outcome
  // through the other, which re-queued and logged the bytes. A caller using
  // the first alone would have dropped a failed byte delete silently.
  it('logs a corpus failure, re-queues and logs a blob failure, and hands the outcome on', async () => {
    const outcome = {
      released: ['s3:org-1/ok.pdf'],
      kept: [],
      failures: [
        {
          ref: 's3:org-1/listed.pdf',
          stage: 'corpus' as const,
          message: 'corpus down',
        },
        {
          ref: 's3:org-1/bytes.pdf',
          stage: 'blob' as const,
          message: 's3 down',
        },
      ],
    };

    const settled = await settleReleaseOutcome(
      fakeSql([]).sql,
      'org-1',
      outcome,
    );

    expect(settled).toBe(outcome);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      '[knowledge] reconcile release failed for s3:org-1/listed.pdf (corpus): corpus down',
      '[knowledge] reconcile release failed for s3:org-1/bytes.pdf (blob): s3 down — re-queued to knowledge.release_refs',
    ]);
    // Only the bytes go to the job: the corpus failure's rows still list
    // its ref for the next night.
    expect(addJobInTx).toHaveBeenCalledTimes(1);
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'knowledge.release_refs',
      { organizationId: 'org-1', refs: ['s3:org-1/bytes.pdf'] },
    );
  });

  it('queues nothing and says nothing for a release that failed nowhere', async () => {
    await settleReleaseOutcome(fakeSql([]).sql, 'org-1', {
      released: ['s3:org-1/ok.pdf'],
      kept: [],
      failures: [],
    });

    expect(addJobInTx).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
