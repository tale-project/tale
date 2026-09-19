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
  options: { contentSame?: boolean; folder?: Record<string, unknown> } = {},
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
    if (text.includes('FROM app.folders')) {
      return Promise.resolve(options.folder ? [options.folder] : []);
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
/**
 * A move is a create in every way that matters to scope, so it answers to
 * the same two folder rules `createDocumentFromBlobUpload` enforces. Until
 * these landed nothing set `folderId` from the UI, so both were unreachable
 * and untested; the move action makes them the door.
 */
describe('updateDocument folder move', () => {
  const teamFolder = {
    id: 'folder-team',
    organizationId: 'org_1',
    name: 'Product Documents',
    parentId: null,
    teamId: 'team-product',
    teamTags: ['team-product'],
    projectId: null,
    createdBy: 'user-1',
    createdAt: 1_700_000_000_000,
  };
  const orgFolder = {
    ...teamFolder,
    id: 'folder-org',
    teamId: null,
    teamTags: [],
  };
  const authIn = { ...auth, role: 'editor', teamIds: ['team-product'] };
  const authOut = { ...auth, role: 'editor', teamIds: ['team-sales'] };

  it('refuses a destination folder the caller cannot see', async () => {
    const { tx, statements } = fakeTx(HUB_DOC, { folder: teamFolder });
    await expect(
      updateDocument(tx, authOut, {
        documentId: 'doc-1',
        folderId: 'folder-team',
      }),
    ).rejects.toMatchObject({ code: 'FOLDER_NOT_ACCESSIBLE' });
    expect(updateOf(statements)).toBeUndefined();
  });

  it('lets an admin file into a team folder they are not a member of', async () => {
    // Owners and admins see every audience (`canSeeAudience`), so the folder
    // rule never hides a destination from them — the document still takes
    // the folder's audience, as for anyone else.
    const { tx, statements } = fakeTx(HUB_DOC, { folder: teamFolder });
    await updateDocument(tx, auth, {
      documentId: 'doc-1',
      folderId: 'folder-team',
    });
    expect(updateOf(statements)?.values).toContainEqual(['team-product']);
  });

  it('stamps the folder team onto a document moved into a team folder', async () => {
    const { tx, statements } = fakeTx(HUB_DOC, { folder: teamFolder });
    await updateDocument(tx, authIn, {
      documentId: 'doc-1',
      folderId: 'folder-team',
    });
    const update = updateOf(statements);
    expect(update).toBeDefined();
    // An org-wide document filed into a team folder must not stay org-wide:
    // it would sit in a place only that team can open.
    expect(update?.values).toContain('team-product');
    expect(update?.values).toContainEqual(['team-product']);
  });

  it('leaves the team alone for an org-wide destination', async () => {
    const { tx, statements } = fakeTx(HUB_DOC, { folder: orgFolder });
    await updateDocument(tx, authIn, {
      documentId: 'doc-1',
      folderId: 'folder-org',
    });
    const update = updateOf(statements);
    expect(update).toBeDefined();
    expect(update?.values).not.toContain('team-product');
  });

  it('keeps a team document’s audience on a plain move to an org-wide folder — nothing is re-validated', async () => {
    // The document's existing teams are not a request: an editor in sales
    // moves a sales document into an org-wide folder and it stays sales —
    // no team read, no `TEAM_ACCESS_DENIED` for a team they are not in.
    const salesDoc = {
      ...HUB_DOC,
      teamId: 'team-sales',
      teamTags: ['team-sales', 'team-product'],
    };
    const { tx, statements } = fakeTx(salesDoc, { folder: orgFolder });
    await updateDocument(tx, authOut, {
      documentId: 'doc-1',
      folderId: 'folder-org',
    });
    expect(statements.some((s) => s.text.includes('FROM "team"'))).toBe(false);
    const update = updateOf(statements);
    expect(update).toBeDefined();
    expect(update?.values).not.toContainEqual([]);
    expect(update?.values).not.toContainEqual(['team-sales']);
  });

  it('re-stamps a team document moved into another team’s folder with that folder’s audience', async () => {
    const salesDoc = {
      ...HUB_DOC,
      teamId: 'team-sales',
      teamTags: ['team-sales'],
    };
    const both = {
      ...auth,
      role: 'editor',
      teamIds: ['team-sales', 'team-product'],
    };
    const { tx, statements } = fakeTx(salesDoc, { folder: teamFolder });
    await updateDocument(tx, both, {
      documentId: 'doc-1',
      folderId: 'folder-team',
    });
    expect(updateOf(statements)?.values).toContainEqual(['team-product']);
  });

  it('lets a document leave a folder for the root', async () => {
    const inFolder = { ...HUB_DOC, folderId: 'folder-org' };
    const { tx, statements } = fakeTx(inFolder, { folder: orgFolder });
    await updateDocument(tx, authIn, {
      documentId: 'doc-1',
      folderId: null,
    });
    expect(updateOf(statements)).toBeDefined();
  });
});
