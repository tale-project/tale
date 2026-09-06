// @vitest-environment node

/**
 * The agent document upsert converges concurrent runs on ONE row. Its
 * SELECT … FOR UPDATE cannot lock a row that is not there, so two runs both
 * missed and both inserted — and every later refresh updated only the
 * oldest, leaving the twin in listings and RAG forever. The key is unique in
 * the schema now (0073); the insert is `ON CONFLICT DO NOTHING`, and a run
 * that loses the insert race refreshes the winner's row instead. The live
 * race rides the integration check; this double locks the statement shape
 * and the lost-race path.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { upsertAgentDocument } from './agent-write.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../files/service.ts', () => ({
  putOrgBlobBytes: vi.fn(),
  registerUploadedBytes: vi.fn(),
}));
vi.mock('../knowledge/service.ts', () => ({ markRagQueued: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

interface Statement {
  text: string;
  values: unknown[];
}

const LOOKUP = 'SELECT id, file_ref AS "fileRef", record FROM app.documents';

/** A folder row as the scope read answers it (the folder write's target). */
interface FolderScope {
  projectId: string | null;
  teamId: string | null;
  teamTags: string[];
}

function fakeUpsert(script: {
  /** Answers, in order, to every locked document read — by key AND, for a
   * folder write, the same-name-in-folder fallback (same SELECT shape). */
  lookups: {
    id: string;
    fileRef: string | null;
    record: Record<string, unknown> | null;
  }[][];
  inserts: { id: string }[][];
  /** The folder the write targets; `null` = no such folder in the org. */
  folder?: FolderScope | null;
}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT content_hash')) {
      return Promise.resolve([{ contentHash: 'sha-1' }]);
    }
    if (text.startsWith('SELECT project_id AS "projectId", team_id')) {
      return Promise.resolve(script.folder ? [script.folder] : []);
    }
    if (text.startsWith(LOOKUP)) {
      return Promise.resolve(script.lookups.shift() ?? []);
    }
    if (text.startsWith('INSERT INTO app.documents')) {
      return Promise.resolve(script.inserts.shift() ?? []);
    }
    return Promise.resolve([]);
  };
  const sql = {
    begin: (callback: (t: typeof tx) => unknown): unknown => callback(tx),
  } as unknown as Sql;
  return { sql, statements };
}

/** The realtime hints the transaction wrote, as `(entity)` in order. */
function hintEntities(statements: Statement[]): string[] {
  return statements
    .filter((s) => s.text.startsWith('INSERT INTO app_realtime.outbox'))
    .map((s) => String(s.values[2]));
}

const args = {
  organizationId: 'org_1',
  externalItemId: 'agent:report.md',
  title: 'report.md',
  fileRef: 's3:acme/blob-1',
  mimeType: 'text/markdown',
  createdBy: 'agent-1',
  auditActorId: 'user-1',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('upsertAgentDocument', () => {
  it('inserts with an ON CONFLICT claim on the unique key', async () => {
    const fake = fakeUpsert({ lookups: [[]], inserts: [[{ id: 'doc-1' }]] });

    const result = await upsertAgentDocument(fake.sql, args);

    expect(result).toEqual({
      documentId: 'doc-1',
      action: 'created',
      contentChanged: true,
    });
    const insert = fake.statements.find((s) =>
      s.text.startsWith('INSERT INTO app.documents'),
    );
    expect(insert?.text).toContain(
      'ON CONFLICT (org_id, external_item_id) WHERE external_item_id IS NOT NULL DO NOTHING',
    );
    expect(insert?.text).toContain('RETURNING id');
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'document.created',
        resourceId: 'doc-1',
      }),
    );
  });

  it('refreshes the winner row when a concurrent run inserted first', async () => {
    const fake = fakeUpsert({
      // Nothing on the first locked read; the winner's row on the re-read.
      lookups: [[], [{ id: 'doc-winner', fileRef: null, record: null }]],
      // The insert conflicted — no row back.
      inserts: [[]],
    });

    const result = await upsertAgentDocument(fake.sql, args);

    // The winner's row served no bytes yet: this refresh brought new content.
    expect(result).toEqual({
      documentId: 'doc-winner',
      action: 'updated',
      contentChanged: true,
    });
    const lookups = fake.statements.filter((s) => s.text.startsWith(LOOKUP));
    expect(lookups).toHaveLength(2);
    for (const lookup of lookups) expect(lookup.text).toContain('FOR UPDATE');
    const update = fake.statements.find((s) =>
      s.text.startsWith('UPDATE app.documents'),
    );
    expect(update?.values).toContain('doc-winner');
    expect(update?.values).toContain('s3:acme/blob-1');
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'document.updated',
        resourceId: 'doc-winner',
      }),
    );
  });

  it('refreshes an existing row (any lifecycle) without inserting', async () => {
    const fake = fakeUpsert({
      lookups: [[{ id: 'doc-1', fileRef: 's3:acme/blob-1', record: null }]],
      inserts: [],
    });

    const result = await upsertAgentDocument(fake.sql, args);

    // Same blob again: the row's bytes did not change.
    expect(result).toEqual({
      documentId: 'doc-1',
      action: 'updated',
      contentChanged: false,
    });
    expect(
      fake.statements.some((s) =>
        s.text.startsWith('INSERT INTO app.documents'),
      ),
    ).toBe(false);
    const lookup = fake.statements.find((s) => s.text.startsWith(LOOKUP));
    expect(lookup?.text).not.toContain('lifecycle_status');
    // Same blob again: nothing to rotate out.
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('releases the previous blob when a refresh swaps the bytes', async () => {
    // Every re-run of a report-writing automation stores a fresh blob; the
    // one it replaces must stop being bound + active, or it stays counted
    // against the quota and survives every purge (only the current ref was
    // ever released).
    const fake = fakeUpsert({
      lookups: [[{ id: 'doc-1', fileRef: 's3:acme/blob-0', record: null }]],
      inserts: [],
    });

    await upsertAgentDocument(fake.sql, args);

    const unbind = fake.statements.find(
      (s) =>
        s.text.startsWith('UPDATE app.file_metadata SET') &&
        s.text.includes("lifecycle_status = 'trashed'"),
    );
    expect(unbind?.text).toContain('document_id = NULL');
    expect(unbind?.values).toEqual(
      expect.arrayContaining(['org_1', 'doc-1', 's3:acme/blob-0']),
    );
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'knowledge.release_refs',
      { organizationId: 'org_1', refs: ['s3:acme/blob-0'] },
    );
  });

  it('answers contentChanged only when the bytes are new to the row', async () => {
    const fresh = fakeUpsert({ lookups: [[]], inserts: [[{ id: 'doc-1' }]] });
    await expect(upsertAgentDocument(fresh.sql, args)).resolves.toMatchObject({
      contentChanged: true,
    });
    const sameBlob = fakeUpsert({
      lookups: [[{ id: 'doc-1', fileRef: 's3:acme/blob-1', record: null }]],
      inserts: [],
    });
    await expect(
      upsertAgentDocument(sameBlob.sql, args),
    ).resolves.toMatchObject({ action: 'updated', contentChanged: false });
    const swapped = fakeUpsert({
      lookups: [[{ id: 'doc-1', fileRef: 's3:acme/blob-0', record: null }]],
      inserts: [],
    });
    await expect(upsertAgentDocument(swapped.sql, args)).resolves.toMatchObject(
      { action: 'updated', contentChanged: true },
    );
  });

  // Every write is a realtime fact: a hub row owes the document hint; a
  // project row ALSO owes the task hint (its folder's facts ride the task
  // DTO — see documents/hints.ts).
  it('emits the document hint, and the task hint for a project document', async () => {
    const hub = fakeUpsert({ lookups: [[]], inserts: [[{ id: 'doc-1' }]] });
    await upsertAgentDocument(hub.sql, args);
    expect(hintEntities(hub.statements)).toEqual(['document']);

    const project = fakeUpsert({
      lookups: [[]],
      inserts: [[{ id: 'doc-2' }]],
      folder: { projectId: 'proj-1', teamId: null, teamTags: [] },
    });
    await upsertAgentDocument(project.sql, { ...args, folderId: 'fld-q1' });
    expect(hintEntities(project.statements)).toEqual(['document', 'task']);
  });
});

// The workflow `document.create` contract rides `folderId`: the document
// lands IN the folder and takes the folder's scope — never a scope the
// caller names — and a same-named active document in that folder is the
// same document, refreshed rather than duplicated. The first 0.5 cut had no
// folder at all here, so a desk automation's deliverables (return.xml,
// report.md) landed at the project root where no task's Files zone lists
// them, and a fresh row per run when they did.
describe('upsertAgentDocument into a folder', () => {
  const folderArgs = { ...args, folderId: 'fld-q1' };

  it('files the row into the folder with the folder s project scope', async () => {
    const fake = fakeUpsert({
      lookups: [[], []],
      inserts: [[{ id: 'doc-1' }]],
      folder: { projectId: 'proj-1', teamId: null, teamTags: [] },
    });

    const result = await upsertAgentDocument(fake.sql, {
      ...folderArgs,
      // The folder wins over a caller-named project.
      projectId: 'proj-other',
    });

    expect(result).toMatchObject({ documentId: 'doc-1', action: 'created' });
    const scopeRead = fake.statements.find((s) =>
      s.text.startsWith('SELECT project_id AS "projectId", team_id'),
    );
    expect(scopeRead?.values).toEqual(['fld-q1', 'org_1']);
    const insert = fake.statements.find((s) =>
      s.text.startsWith('INSERT INTO app.documents'),
    );
    expect(insert?.text).toContain('project_id, folder_id, team_id');
    expect(insert?.values).toEqual(
      expect.arrayContaining(['proj-1', 'fld-q1', 'agent']),
    );
    expect(insert?.values).not.toContain('proj-other');
  });

  it('inherits a hub folder s team scope and owes no task hint there', async () => {
    const fake = fakeUpsert({
      lookups: [[], []],
      inserts: [[{ id: 'doc-1' }]],
      folder: { projectId: null, teamId: 'team-9', teamTags: ['team-9'] },
    });

    await upsertAgentDocument(fake.sql, folderArgs);

    const insert = fake.statements.find((s) =>
      s.text.startsWith('INSERT INTO app.documents'),
    );
    expect(insert?.values).toEqual(
      expect.arrayContaining(['fld-q1', 'team-9', ['team-9']]),
    );
    expect(hintEntities(fake.statements)).toEqual(['document']);
  });

  it('refreshes the folder s same-named document instead of parking a sibling', async () => {
    const fake = fakeUpsert({
      // No row under the key; the folder holds a same-named upload.
      lookups: [
        [],
        [{ id: 'doc-upload', fileRef: 's3:acme/old', record: null }],
      ],
      inserts: [],
      folder: { projectId: 'proj-1', teamId: null, teamTags: [] },
    });

    const result = await upsertAgentDocument(fake.sql, folderArgs);

    expect(result).toEqual({
      documentId: 'doc-upload',
      action: 'updated',
      contentChanged: true,
    });
    const byTitle = fake.statements.filter((s) => s.text.startsWith(LOOKUP))[1];
    expect(byTitle?.text).toContain('AND folder_id = ? AND title = ?');
    expect(byTitle?.text).toContain(
      "(lifecycle_status IS NULL OR lifecycle_status = 'active')",
    );
    expect(byTitle?.text).toContain('FOR UPDATE');
    expect(byTitle?.values).toEqual(['org_1', 'fld-q1', 'report.md']);
    expect(
      fake.statements.some((s) =>
        s.text.startsWith('INSERT INTO app.documents'),
      ),
    ).toBe(false);
    const update = fake.statements.find((s) =>
      s.text.startsWith('UPDATE app.documents'),
    );
    // Filed there, re-scoped to the folder, stamped as the run's output; the
    // row keeps its own key (a sync-owned row must stay reconcilable).
    expect(update?.text).toContain(
      'folder_id = CASE WHEN ? THEN ? ELSE folder_id END',
    );
    expect(update?.text).not.toContain('external_item_id');
    expect(update?.values).toEqual(
      expect.arrayContaining([
        's3:acme/blob-1',
        'agent',
        'proj-1',
        true,
        'fld-q1',
      ]),
    );
    expect(hintEntities(fake.statements)).toEqual(['document', 'task']);
  });

  it('refuses a folder the organization does not hold, before any row', async () => {
    const fake = fakeUpsert({ lookups: [], inserts: [], folder: null });

    await expect(
      upsertAgentDocument(fake.sql, folderArgs),
    ).rejects.toMatchObject({ code: 'FOLDER_NOT_FOUND' });
    expect(
      fake.statements.some(
        (s) =>
          s.text.startsWith('INSERT INTO app.documents') ||
          s.text.startsWith('UPDATE app.documents'),
      ),
    ).toBe(false);
  });

  it('keeps a folderless refresh where the row already sits', async () => {
    const fake = fakeUpsert({
      lookups: [[{ id: 'doc-1', fileRef: 's3:acme/blob-1', record: null }]],
      inserts: [],
    });

    await upsertAgentDocument(fake.sql, args);

    const update = fake.statements.find((s) =>
      s.text.startsWith('UPDATE app.documents'),
    );
    expect(update?.text).toContain('ELSE folder_id END');
    expect(update?.text).toContain('ELSE team_id END');
    expect(update?.text).toContain('ELSE team_tags END');
    // The re-file switch is off: every CASE keeps the column.
    expect(update?.values).toContain(false);
    expect(update?.values).not.toContain(true);
  });
});
