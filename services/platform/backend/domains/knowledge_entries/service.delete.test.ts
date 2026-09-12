// @vitest-environment node

/**
 * What a delete removes depends on the row it names. The regression under
 * test: the delete soft-deleted every row sharing the addressed row's
 * TOPIC KEY and trashed the document whichever row was named — so a
 * retention job pruning a superseded version off the REST door's
 * `?status=superseded` listing destroyed the live fact and its Knowledge
 * Hub document, answering 204. Now a superseded row is pruned alone, the
 * active row retires the chain keyed by its DOCUMENT (a topic rename
 * leaves older rows' keys behind and frees the key for a stranger), and a
 * second delete of the same row answers 404, not a 204 that re-stamps
 * nothing.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { releaseCorpusRefs } from '../knowledge/release.ts';
import { deleteKnowledgeEntry, KnowledgeEntryError } from './service.ts';

// The de-index after an active delete talks to the corpus: the seam is
// replaced, and the org slug the release is keyed by comes from a stub.
vi.mock('../knowledge/release.ts', () => ({
  releaseCorpusRefs: vi.fn(() =>
    Promise.resolve({ released: ['s3:acme/blob-1'], kept: [], failures: [] }),
  ),
}));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(lookup: unknown[]): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT ke.status')) return Promise.resolve(lookup);
    return Promise.resolve([]);
  };
  const sql = Object.assign(tx, {
    begin: (callback: (handle: typeof tx) => Promise<unknown>) => callback(tx),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

const args = { organizationId: 'org-1', entryId: 'k-1', role: 'admin' };

const updates = (statements: Statement[]) =>
  statements.filter((s) => s.text.startsWith('UPDATE'));

describe('deleteKnowledgeEntry', () => {
  beforeEach(() => {
    vi.mocked(releaseCorpusRefs).mockClear();
  });

  it('looks only at live rows, and answers 404 for one already deleted', async () => {
    const fake = fakeSql([]);
    let caught: unknown;
    try {
      await deleteKnowledgeEntry(fake.sql, args);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KnowledgeEntryError);
    expect(caught).toMatchObject({
      code: 'KNOWLEDGE_ENTRY_NOT_FOUND',
      status: 404,
    });
    expect(fake.statements[0]?.text).toContain('deleted_at_ms IS NULL');
    expect(updates(fake.statements)).toEqual([]);
  });

  it('prunes a superseded row alone — the active fact and its document stay', async () => {
    const fake = fakeSql([
      {
        status: 'superseded',
        topicKey: 'refunds',
        documentId: 'doc-1',
        fileRef: 's3:acme/blob-1',
      },
    ]);
    await deleteKnowledgeEntry(fake.sql, args);
    const writes = updates(fake.statements);
    expect(writes).toHaveLength(1);
    // History pruned, the fact untouched — its corpus rows stay.
    expect(releaseCorpusRefs).not.toHaveBeenCalled();
    expect(writes[0]?.text).toMatch(
      /^UPDATE app\.knowledge_entries SET deleted_at_ms = \? WHERE id = \?/,
    );
    expect(writes[0]?.values).toContain('k-1');
    expect(writes[0]?.text).not.toContain('document_id');
    expect(writes[0]?.text).not.toContain('topic_key');
  });

  it('retires the whole chain by DOCUMENT and trashes it when the active row goes', async () => {
    const fake = fakeSql([
      {
        status: 'active',
        topicKey: 'refunds',
        documentId: 'doc-1',
        fileRef: 's3:acme/blob-1',
      },
    ]);
    await deleteKnowledgeEntry(fake.sql, args);
    const writes = updates(fake.statements);
    expect(writes).toHaveLength(2);
    expect(writes[0]?.text).toContain('UPDATE app.knowledge_entries');
    expect(writes[0]?.text).toContain('document_id = ?');
    expect(writes[0]?.text).not.toContain('topic_key');
    expect(writes[0]?.values).toContain('doc-1');
    expect(writes[1]?.text).toContain('UPDATE app.documents');
    expect(writes[1]?.text).toContain("lifecycle_status = 'trashed'");
    expect(writes[1]?.values).toContain('doc-1');
    // De-indexed at once, after the commit: the trashed document's chunks
    // used to keep winning candidate slots until the retention purge, so a
    // small page came back empty while a live passage sat below the cut.
    // Corpus rows only — the bytes stay for the Trash and the purge.
    expect(releaseCorpusRefs).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      orgSlug: 'acme',
      refs: ['s3:acme/blob-1'],
      excludeDocumentId: 'doc-1',
    });
  });

  it('survives a failed de-index — the delete stands and the purge retries', async () => {
    vi.mocked(releaseCorpusRefs).mockResolvedValueOnce({
      released: [],
      kept: [],
      failures: [
        { ref: 's3:acme/blob-1', stage: 'corpus', message: 'corpus down' },
      ],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const fake = fakeSql([
        {
          status: 'active',
          topicKey: 'refunds',
          documentId: 'doc-1',
          fileRef: 's3:acme/blob-1',
        },
      ]);
      await expect(
        deleteKnowledgeEntry(fake.sql, args),
      ).resolves.toBeUndefined();
      expect(updates(fake.statements)).toHaveLength(2);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('de-indexing doc-1'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('falls back to the topic key only for a legacy chain without a document', async () => {
    const fake = fakeSql([
      { status: 'active', topicKey: 'refunds', documentId: null },
    ]);
    await deleteKnowledgeEntry(fake.sql, args);
    const writes = updates(fake.statements);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.text).toContain('topic_key = ?');
    expect(writes[0]?.text).toContain('document_id IS NULL');
    expect(writes[0]?.values).toContain('refunds');
  });
});
