// @vitest-environment node

/**
 * The hard-delete lane's ORDER: purge first, receipt after. `purgeDocument`
 * keeps the document row when a corpus or blob release fails and throws
 * `PurgeIncompleteError` for the caller to retry. Before this test the
 * `document.deleted` audit row (and the sync stop) committed in a
 * transaction AHEAD of the purge — a failed purge left a tamper-evident
 * record of a deletion that had not happened, and the retry that did delete
 * wrote a second success row. The folder cascade always purged first; this
 * pins the single-document door to the same order.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { purgeDocument } from '../retention/service.ts';
import { deleteDocumentHard } from './service.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));
vi.mock('../legal_holds/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../legal_holds/service.ts')>()),
  assertNotHeld: vi.fn(() => Promise.resolve()),
}));
vi.mock('../onedrive/service.ts', () => ({
  stopSyncForTrashedDocument: vi.fn(() => Promise.resolve(false)),
}));
// A factory without `importOriginal`: the retention module imports this
// domain back, and resolving the original inside the factory hands the
// service the REAL purge through that cycle.
vi.mock('../retention/service.ts', () => ({ purgeDocument: vi.fn() }));

interface Statement {
  text: string;
  values: unknown[];
}

const HUB_DOC = {
  id: 'doc-1',
  organizationId: 'org_1',
  title: 'notes.txt',
  projectId: null,
  teamId: null,
  teamTags: [] as string[],
  record: null,
  createdBy: 'user-1',
  fileRef: 's3:acme/blob-1',
  historyFiles: [] as string[],
  metadata: {},
};

/** The project a project-scoped fixture belongs to: org-wide, so the admin
 * caller passes the edit gate without team membership. */
const PROJECT = {
  id: 'proj-1',
  organizationId: 'org_1',
  teamId: null,
  sharedWithTeamIds: [] as string[],
};

/** A recorder answering the point reads the lane makes (the document, and
 * its project for a project-scoped fixture); `begin` runs the callback
 * inline so the transaction's statements are recorded too. */
function fakeSql(doc: Record<string, unknown> = HUB_DOC): {
  sql: Sql;
  statements: Statement[];
  begun: number[];
} {
  const statements: Statement[] = [];
  const begun: number[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.documents WHERE id = ?')) {
      return Promise.resolve([doc]);
    }
    if (text.includes('FROM app.projects WHERE id = ?')) {
      return Promise.resolve([PROJECT]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(run, {
    unsafe: (text: string) => text,
    begin: (callback: (t: typeof run) => unknown): unknown => {
      begun.push(statements.length);
      return callback(run);
    },
  }) as unknown as Sql;
  return { sql, statements, begun };
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

describe('deleteDocumentHard', () => {
  it('writes no receipt when the purge could not finish', async () => {
    // The shape `purgeDocument` throws when a release failed: the row is
    // kept, the caller retries.
    const incomplete = Object.assign(new Error('Purge incomplete for doc-1'), {
      name: 'PurgeIncompleteError',
      code: 'PURGE_INCOMPLETE',
    });
    vi.mocked(purgeDocument).mockRejectedValueOnce(incomplete);
    const fake = fakeSql();

    await expect(deleteDocumentHard(fake.sql, auth, 'doc-1')).rejects.toBe(
      incomplete,
    );

    expect(createAuditLog).not.toHaveBeenCalled();
    expect(fake.begun).toEqual([]);
  });

  it('audits the deletion only after the purge succeeded', async () => {
    vi.mocked(purgeDocument).mockResolvedValueOnce(undefined);
    const fake = fakeSql();

    await deleteDocumentHard(fake.sql, auth, 'doc-1');

    expect(purgeDocument).toHaveBeenCalledWith(
      fake.sql,
      'acme',
      expect.objectContaining({ id: 'doc-1', fileRef: 's3:acme/blob-1' }),
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'document.deleted',
        resourceId: 'doc-1',
        status: 'success',
      }),
    );
    const purgeOrder = vi.mocked(purgeDocument).mock.invocationCallOrder[0];
    const auditOrder = vi.mocked(createAuditLog).mock.invocationCallOrder[0];
    expect(purgeOrder).toBeLessThan(auditOrder ?? -1);
  });

  // The Files zone's "Delete" removes the last input of an automation-owned
  // task: the task DTO's `hasFiles` flips, so the task reads must refetch —
  // a hub document's deletion moves no task fact and owes no task hint.
  it('emits the task hint for a project document, only the document hint for a hub one', async () => {
    vi.mocked(purgeDocument).mockResolvedValue(undefined);

    await deleteDocumentHard(fakeSql().sql, auth, 'doc-1');
    expect(vi.mocked(emitHintInTx).mock.calls.map((call) => call[1])).toEqual([
      { orgId: 'org_1', entity: 'document', entityId: 'doc-1' },
    ]);

    vi.clearAllMocks();
    vi.mocked(purgeDocument).mockResolvedValue(undefined);
    await deleteDocumentHard(
      fakeSql({ ...HUB_DOC, projectId: 'proj-1' }).sql,
      auth,
      'doc-1',
    );
    expect(vi.mocked(emitHintInTx).mock.calls.map((call) => call[1])).toEqual([
      { orgId: 'org_1', entity: 'document', entityId: 'doc-1' },
      { orgId: 'org_1', entity: 'task', entityId: null },
    ]);
  });
});
