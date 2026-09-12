// @vitest-environment node

/**
 * `updateDocument` at the service seam, on two rules a REST client relies
 * on and a stub row can pin without Postgres:
 *
 *  - `metadata` MERGES per RFC 7396 (the contacts/products rule) — it used
 *    to be replaced whole, so a caller tagging a document wiped every other
 *    key in the bag, the platform's own bookkeeping included;
 *  - a write that changes nothing writes nothing — `updated_at_ms` is the
 *    optimistic-concurrency token every other client holds, so an empty
 *    PATCH must not spend it and hand them a spurious `DOCUMENT_STALE`.
 */

import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emitDocumentChangeHints } from './hints.ts';
import { updateDocument } from './service.ts';

vi.mock('./hints.ts', () => ({ emitDocumentChangeHints: vi.fn() }));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));

interface Statement {
  text: string;
  values: unknown[];
}

const HUB_DOC = {
  id: 'doc-1',
  organizationId: 'org_1',
  title: 'notes.md',
  fileRef: 's3:acme/blob-1',
  mimeType: 'text/markdown',
  extension: 'md',
  sourceProvider: 'knowledge',
  externalItemId: null,
  contentHash: 'abc',
  historyFiles: [] as string[],
  teamId: null,
  teamTags: [] as string[],
  projectId: null,
  createdBy: 'user-1',
  folderId: null,
  metadata: { contentHash: 'abc', owner: 'ops' } as Record<string, unknown>,
  lifecycleStatus: null,
  record: null,
  scannedPagesDetected: null,
  ocrApplied: null,
  sourceCreatedAt: null,
  sourceModifiedAt: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

/** A transaction double: answers the locked row load and the stored-content
 * comparison, records every statement. */
function fakeTx(
  doc: Record<string, unknown> = HUB_DOC,
  options: { contentSame?: boolean } = {},
): { tx: TransactionSql; statements: Statement[] } {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.documents WHERE id = ? LIMIT 1 FOR UPDATE')) {
      return Promise.resolve([doc]);
    }
    if (text.includes('IS NOT DISTINCT FROM')) {
      return Promise.resolve([{ same: options.contentSame ?? false }]);
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(run, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
  }) as unknown as TransactionSql;
  return { tx, statements };
}

const auth = {
  organizationId: 'org_1',
  userId: 'user-1',
  email: 'user@example.com',
  role: 'admin',
  teamIds: [] as string[],
};

afterEach(() => {
  vi.clearAllMocks();
});

const updateOf = (statements: Statement[]): Statement | undefined =>
  statements.find((s) => s.text.startsWith('UPDATE app.documents SET'));

describe('updateDocument metadata', () => {
  it('merges the patch into the stored bag per RFC 7396', async () => {
    const { tx, statements } = fakeTx();
    await updateDocument(tx, auth, {
      documentId: 'doc-1',
      metadata: { note: 'reviewed', owner: null },
    });
    const update = updateOf(statements);
    expect(update).toBeDefined();
    // Sent keys set, an omitted key (`contentHash`) stays, a key sent as
    // null (`owner`) is removed.
    expect(update?.values).toContainEqual({
      contentHash: 'abc',
      note: 'reviewed',
    });
    expect(emitDocumentChangeHints).toHaveBeenCalledTimes(1);
  });

  it('clears the whole bag when the field itself is null', async () => {
    const { tx, statements } = fakeTx();
    await updateDocument(tx, auth, { documentId: 'doc-1', metadata: null });
    const update = updateOf(statements);
    expect(update?.text).toContain('metadata = ?');
    expect(update?.values).toContain(null);
  });
});

describe('updateDocument no-op', () => {
  it('writes nothing and emits nothing for an empty patch', async () => {
    const { tx, statements } = fakeTx();
    const result = await updateDocument(tx, auth, { documentId: 'doc-1' });
    expect(updateOf(statements)).toBeUndefined();
    expect(emitDocumentChangeHints).not.toHaveBeenCalled();
    expect(result).toEqual({
      teamScopeChanged: false,
      folderChanged: false,
      fileRef: 's3:acme/blob-1',
    });
  });

  it('writes nothing when every patched field already holds its value — key order included', async () => {
    const { tx, statements } = fakeTx(HUB_DOC, { contentSame: true });
    await updateDocument(tx, auth, {
      documentId: 'doc-1',
      title: 'notes.md',
      metadata: { owner: 'ops', contentHash: 'abc' },
      mimeType: 'text/markdown',
      content: 'the same bytes',
    });
    expect(updateOf(statements)).toBeUndefined();
    expect(emitDocumentChangeHints).not.toHaveBeenCalled();
  });

  it('still writes when the content differs — compared in the database, not read back', async () => {
    const { tx, statements } = fakeTx(HUB_DOC, { contentSame: false });
    await updateDocument(tx, auth, {
      documentId: 'doc-1',
      content: 'new bytes',
    });
    const compare = statements.find((s) =>
      s.text.includes('IS NOT DISTINCT FROM'),
    );
    expect(compare?.values).toContain('new bytes');
    expect(updateOf(statements)).toBeDefined();
    expect(emitDocumentChangeHints).toHaveBeenCalledTimes(1);
  });

  it('still writes when only the title changed', async () => {
    const { tx, statements } = fakeTx();
    await updateDocument(tx, auth, {
      documentId: 'doc-1',
      title: 'renamed.md',
    });
    expect(updateOf(statements)?.values).toContain('renamed.md');
  });
});
