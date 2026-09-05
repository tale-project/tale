// @vitest-environment node

/**
 * The project cascade delete asks the documents domain's pre-walk before it
 * writes anything. Before this test the cascade UPDATE expired every
 * document in the project with no record or hold check — the one delete
 * door that skipped the guard trash, hard delete and the folder cascade all
 * apply — and the retention sweep then purged the retained approved
 * snapshots. This pins: a protected record refuses the whole cascade before
 * any write, names the records, and a detach (which destroys nothing) is
 * untouched by the guard.
 */

import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAuditLog } from '../audit_logs/service.ts';
import { deleteProject, ProjectError } from './service.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
// The documents domain imports this one back; a factory without
// `importOriginal` keeps the cycle out of the test.
vi.mock('../documents/service.ts', () => ({
  recordTrashRefusalFromJson: (record: Record<string, unknown> | null) => {
    if (record === null) return null;
    if (record.state === 'in_review') return 'in_review';
    if (record.state === 'approved') return 'approved';
    return Array.isArray(record.approvedVersions) &&
      record.approvedVersions.length > 0
      ? 'retained_history'
      : null;
  },
}));

interface Statement {
  text: string;
  values: unknown[];
}

const PROJECT = {
  id: 'project-1',
  organizationId: 'org_1',
  name: 'Q2 Sales',
  teamId: null,
  sharedWithTeamIds: [] as string[],
  createdBy: 'user-1',
};

interface DocRow {
  id: string;
  title: string | null;
  record: Record<string, unknown> | null;
  createdBy: string | null;
}

function fakeTx(docs: DocRow[]): {
  tx: TransactionSql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.projects WHERE id = ?')) {
      return Promise.resolve([PROJECT]);
    }
    if (text.includes('FROM app.documents')) {
      return Promise.resolve(docs);
    }
    if (text.startsWith('UPDATE app.documents')) {
      return Promise.resolve(docs.map((doc) => ({ id: doc.id })));
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(run, {
    unsafe: (text: string) => text,
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

const writes = (statements: Statement[]): Statement[] =>
  statements.filter((s) => /^(UPDATE|DELETE|INSERT)/.test(s.text));

afterEach(() => {
  vi.clearAllMocks();
});

describe('deleteProject (cascade)', () => {
  it('refuses the whole cascade before any write when a record is protected', async () => {
    const { tx, statements } = fakeTx([
      { id: 'doc-a', title: 'plain.txt', record: null, createdBy: 'user-1' },
      {
        id: 'doc-b',
        title: 'SOP-7.pdf',
        record: { state: 'approved', version: 2, approvedVersions: [{}] },
        createdBy: 'user-2',
      },
      {
        id: 'doc-c',
        title: null,
        record: { state: 'draft', version: 2, approvedVersions: [{}] },
        createdBy: 'user-2',
      },
    ]);
    const attempt = deleteProject(tx, auth, {
      projectId: 'project-1',
      mode: 'cascade',
      confirmPhrase: 'q2 sales',
    });
    await expect(attempt).rejects.toMatchObject({
      code: 'PROJECT_HAS_PROTECTED_RECORDS',
      status: 400,
      data: { documents: ['SOP-7.pdf', 'doc-c'] },
    });
    await expect(attempt).rejects.toBeInstanceOf(ProjectError);
    expect(writes(statements)).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('expires the documents once every record passes the guard', async () => {
    const { tx, statements } = fakeTx([
      { id: 'doc-a', title: 'plain.txt', record: null, createdBy: 'user-1' },
      {
        id: 'doc-d',
        title: 'first-draft.md',
        record: { state: 'draft', version: 1, approvedVersions: [] },
        createdBy: 'user-1',
      },
    ]);
    const result = await deleteProject(tx, auth, {
      projectId: 'project-1',
      mode: 'cascade',
      confirmPhrase: 'Q2 Sales',
    });
    expect(result.cascadedDocCount).toBe(2);
    const cascade = statements.find((s) =>
      s.text.startsWith(
        "UPDATE app.documents SET project_id = NULL, lifecycle_status = 'expired'",
      ),
    );
    expect(cascade).toBeDefined();
    // The pre-walk ran BEFORE the cascade write.
    const walkAt = statements.findIndex((s) =>
      s.text.startsWith('SELECT id, title, record, created_by'),
    );
    expect(walkAt).toBeGreaterThanOrEqual(0);
    expect(walkAt).toBeLessThan(statements.indexOf(cascade as Statement));
    expect(createAuditLog).toHaveBeenCalledTimes(1);
  });

  it('leaves a detach alone — nothing is destroyed, so nothing is guarded', async () => {
    const { tx, statements } = fakeTx([
      {
        id: 'doc-b',
        title: 'SOP-7.pdf',
        record: { state: 'approved', version: 2, approvedVersions: [{}] },
        createdBy: 'user-2',
      },
    ]);
    const result = await deleteProject(tx, auth, {
      projectId: 'project-1',
      mode: 'detach',
    });
    expect(result.detachedDocCount).toBe(1);
    expect(
      statements.some((s) => s.text.startsWith('SELECT id, title, record')),
    ).toBe(false);
    expect(
      statements.some((s) =>
        s.text.startsWith('UPDATE app.documents SET project_id = NULL WHERE'),
      ),
    ).toBe(true);
  });
});
