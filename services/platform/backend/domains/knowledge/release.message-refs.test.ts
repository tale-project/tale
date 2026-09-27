// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An indexed email body rides the release seam under its MESSAGE ref: dead
 * once its inbound email row is gone or its conversation is marked spam,
 * released by deleting its corpus rows —
 * and never handed to the blob stage, where `parseBlobRef` would coerce the
 * ref into a storage id instead of refusing it. The corpus reconcile walks
 * message refs apart from blob refs, from a random start, so neither a large
 * inbox nor a long run of live messages can keep anything out of reach.
 */

/** What the reconcile asks `listKnowledgeDocumentRefs` for, per page. */
interface WalkArgs {
  orgSlug: string;
  refs: 'blobs' | 'messages';
  afterFileId: string | null;
  beforeFileId?: string | null;
  limit: number;
}

const { deleteKnowledgeDocumentsBatch, listKnowledgeDocumentRefs } = vi.hoisted(
  () => ({
    deleteKnowledgeDocumentsBatch:
      vi.fn<
        (args: { orgSlug: string; fileIds: string[] }) => Promise<unknown>
      >(),
    listKnowledgeDocumentRefs: vi.fn<(args: WalkArgs) => Promise<string[]>>(),
  }),
);
const { deleteOrgObject } = vi.hoisted(() => ({ deleteOrgObject: vi.fn() }));

vi.mock('../../core/legacy/knowledge_delete.ts', () => ({
  deleteKnowledgeDocumentsBatch,
  listKnowledgeDocumentRefs,
}));
vi.mock('../../lib/object-store.ts', () => ({ deleteOrgObject }));
vi.mock('./service.ts', () => ({
  reconcileDocumentScopeStamps: vi.fn(async () => ({
    scanned: 0,
    corrected: 0,
  })),
}));

const { reconcileCorpusForOrg, releaseCorpusRefs, releaseRefs } =
  await import('./release.ts');

const ORG = { organizationId: 'org-1', orgSlug: 'acme' };
const LIVE_ID = '11111111-1111-4111-8111-111111111111';
const DEAD_ID = '22222222-2222-4222-8222-222222222222';
const ref = (id: string) => `msg:${id}`;

interface Statement {
  text: string;
  values: unknown[];
}

/**
 * The app database as the liveness predicates read it: `messages` maps each
 * inbound email that still exists to its conversation, `spam` names the
 * conversations marked spam; `liveBlobs` are the blob refs something still
 * references.
 */
function fakeSql(state: {
  messages?: Record<string, string>;
  spam?: string[];
  liveBlobs?: string[];
}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.conversation_messages m')) {
      const ids = values[1] as string[];
      return Promise.resolve(
        ids
          .filter((id) => {
            const conversationId = state.messages?.[id];
            return (
              conversationId !== undefined &&
              !(state.spam ?? []).includes(conversationId)
            );
          })
          .map((id) => ({ id })),
      );
    }
    if (text.includes('FROM unnest(')) {
      const refs = values.at(-1) as string[];
      return Promise.resolve(
        refs.map((blob) => {
          const live = state.liveBlobs?.includes(blob) ?? false;
          return { ref: blob, corpusLive: live, blobLive: live };
        }),
      );
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: fn as unknown as Sql, statements };
}

beforeEach(() => {
  deleteKnowledgeDocumentsBatch.mockReset();
  deleteKnowledgeDocumentsBatch.mockResolvedValue({
    success: true,
    deleted_count: 1,
    failed_file_ids: [],
  });
  listKnowledgeDocumentRefs.mockReset();
  deleteOrgObject.mockReset();
});

describe('releaseRefs — email message refs', () => {
  it('deletes the corpus rows of an email whose message is gone, and nothing else', async () => {
    const { sql, statements } = fakeSql({ messages: {} });
    const outcome = await releaseRefs(sql, { ...ORG, refs: [ref(DEAD_ID)] });
    expect(outcome).toEqual({
      released: [ref(DEAD_ID)],
      kept: [],
      failures: [],
    });
    expect(deleteKnowledgeDocumentsBatch).toHaveBeenCalledWith({
      orgSlug: 'acme',
      fileIds: [ref(DEAD_ID)],
    });
    // No bytes behind a message: no blob liveness read, no object delete.
    expect(deleteOrgObject).not.toHaveBeenCalled();
    expect(statements.some((s) => s.text.includes('FROM unnest('))).toBe(false);
  });

  it('keeps the corpus rows of an email that still exists', async () => {
    const { sql } = fakeSql({ messages: { [LIVE_ID]: 'conv-1' } });
    const outcome = await releaseRefs(sql, { ...ORG, refs: [ref(LIVE_ID)] });
    expect(outcome.kept).toEqual([ref(LIVE_ID)]);
    expect(outcome.released).toEqual([]);
    expect(deleteKnowledgeDocumentsBatch).not.toHaveBeenCalled();
  });

  it('asks only after inbound email of this organization', async () => {
    const { sql, statements } = fakeSql({ messages: {} });
    await releaseRefs(sql, { ...ORG, refs: [ref(DEAD_ID)] });
    const read = statements.find((s) =>
      s.text.includes('FROM app.conversation_messages m'),
    );
    expect(read?.values).toEqual(['org-1', [DEAD_ID], 'inbound', 'email']);
    // Only mail a connector delivered was ever indexed, and a spam
    // conversation's is not kept.
    expect(read?.text).toContain("m.connector_name <> ''");
    expect(read?.text).toContain("c.status IS DISTINCT FROM 'spam'");
    expect(read?.text).toContain('c.org_id = m.org_id');
  });

  it('releases the email of a conversation marked spam', async () => {
    // The verdict queues this release; lifting it queues the index again.
    const { sql } = fakeSql({
      messages: { [LIVE_ID]: 'conv-junk' },
      spam: ['conv-junk'],
    });
    const outcome = await releaseRefs(sql, { ...ORG, refs: [ref(LIVE_ID)] });
    expect(outcome.released).toEqual([ref(LIVE_ID)]);
  });

  it('reports a corpus failure instead of claiming the release', async () => {
    deleteKnowledgeDocumentsBatch.mockRejectedValue(new Error('corpus down'));
    const { sql } = fakeSql({ messages: {} });
    const outcome = await releaseRefs(sql, { ...ORG, refs: [ref(DEAD_ID)] });
    expect(outcome.released).toEqual([]);
    expect(outcome.failures).toEqual([
      { ref: ref(DEAD_ID), stage: 'corpus', message: 'corpus down' },
    ]);
  });

  it('splits a mixed batch: blob refs to the blob lane, message refs to theirs', async () => {
    const blob = 's3:acme/uploads/brief.txt';
    const { sql, statements } = fakeSql({ messages: {}, liveBlobs: [blob] });
    const outcome = await releaseRefs(sql, {
      ...ORG,
      refs: [blob, ref(DEAD_ID), blob],
    });
    expect(outcome.kept).toEqual([blob]);
    expect(outcome.released).toEqual([ref(DEAD_ID)]);
    const blobRead = statements.find((s) => s.text.includes('FROM unnest('));
    expect(blobRead?.values.at(-1)).toEqual([blob]);
  });

  it('reads a malformed message ref as naming nothing', async () => {
    const { sql, statements } = fakeSql({ messages: {} });
    const outcome = await releaseRefs(sql, { ...ORG, refs: ['msg:not an id'] });
    expect(outcome.released).toEqual(['msg:not an id']);
    expect(
      statements.some((s) => s.text.includes('app.conversation_messages')),
    ).toBe(false);
  });

  it('releases email refs the same way when only the corpus is released', async () => {
    const { sql } = fakeSql({ messages: { [LIVE_ID]: 'conv-1' } });
    const outcome = await releaseCorpusRefs(sql, {
      ...ORG,
      refs: [ref(LIVE_ID), ref(DEAD_ID)],
    });
    expect(outcome.kept).toEqual([ref(LIVE_ID)]);
    expect(outcome.released).toEqual([ref(DEAD_ID)]);
    expect(deleteKnowledgeDocumentsBatch).toHaveBeenCalledWith({
      orgSlug: 'acme',
      fileIds: [ref(DEAD_ID)],
    });
  });
});

/** A corpus answering the keyset walk the way `listKnowledgeDocumentRefs`
 * does — one vocabulary, after/before bounds, ascending, capped. */
function walkable(refs: string[]): void {
  const sorted = [...refs].sort();
  listKnowledgeDocumentRefs.mockImplementation((args: WalkArgs) =>
    Promise.resolve(
      sorted
        .filter((candidate) =>
          args.refs === 'messages'
            ? candidate.startsWith('msg:')
            : !candidate.startsWith('msg:'),
        )
        .filter(
          (candidate) =>
            (args.afterFileId === null || candidate > args.afterFileId) &&
            (args.beforeFileId == null || candidate < args.beforeFileId),
        )
        .slice(0, args.limit),
    ),
  );
}

describe('reconcileCorpusForOrg — the email walk', () => {
  it('walks blob refs and message refs apart', async () => {
    walkable(['s3:acme/a', ref(DEAD_ID)]);
    const { sql } = fakeSql({ messages: {}, liveBlobs: ['s3:acme/a'] });
    await reconcileCorpusForOrg(sql, {
      ...ORG,
      messagePivot: 'msg:00000000',
    });
    const walks = listKnowledgeDocumentRefs.mock.calls.map(
      ([args]) => args.refs,
    );
    expect(walks[0]).toBe('blobs');
    expect(walks.slice(1).every((kind) => kind === 'messages')).toBe(true);
  });

  it('starts the email walk at its pivot and wraps round to it', async () => {
    const ids = ['0a', '3b', '7c', 'ad', 'fe'].map(
      (prefix) => `${prefix}000000-0000-4000-8000-000000000000`,
    );
    walkable(ids.map(ref));
    const { sql } = fakeSql({ messages: {} });
    const stats = await reconcileCorpusForOrg(sql, {
      ...ORG,
      messagePivot: 'msg:7',
    });
    // Every message ref was reached once — the tail after the pivot, then
    // the head before it — and each one's message is gone, so each released.
    expect(stats.scanned).toBe(5);
    expect(stats.released).toBe(5);
    const released = deleteKnowledgeDocumentsBatch.mock.calls.flatMap(
      ([args]) => args.fileIds,
    );
    expect(released).toEqual([
      ref(ids[2] ?? ''),
      ref(ids[3] ?? ''),
      ref(ids[4] ?? ''),
      ref(ids[0] ?? ''),
      ref(ids[1] ?? ''),
    ]);
    const messageWalks = listKnowledgeDocumentRefs.mock.calls
      .map(([args]) => args)
      .filter((args) => args.refs === 'messages');
    expect(messageWalks[0]).toMatchObject({
      afterFileId: 'msg:7',
      beforeFileId: null,
    });
    expect(messageWalks.at(-1)).toMatchObject({ beforeFileId: 'msg:7' });
  });

  it('keeps the email walk inside its own budget', async () => {
    // 600 live emails after the pivot: the walk stops at its budget and
    // never wraps round, and the blob walk had its own budget before it.
    const ids = Array.from(
      { length: 600 },
      (_, index) =>
        `f${String(index).padStart(7, '0')}-0000-4000-8000-000000000000`,
    );
    walkable(['s3:acme/a', ...ids.map(ref)]);
    const { sql } = fakeSql({
      messages: Object.fromEntries(ids.map((id) => [id, 'conv-1'])),
      liveBlobs: ['s3:acme/a'],
    });
    const stats = await reconcileCorpusForOrg(sql, {
      ...ORG,
      messagePivot: 'msg:e',
    });
    expect(stats.scanned).toBe(1 + 500);
    expect(stats.released).toBe(0);
    const messageWalks = listKnowledgeDocumentRefs.mock.calls
      .map(([args]) => args)
      .filter((args) => args.refs === 'messages');
    expect(messageWalks.every((args) => args.beforeFileId === null)).toBe(true);
  });
});
