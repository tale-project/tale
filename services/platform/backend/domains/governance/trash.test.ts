// @vitest-environment node

/**
 * The admin Trash listing and restore over a scripted `sql` tag: chat rows
 * read their title from `app.threads`, hidden lineage siblings are never
 * rows of their own, only listed types are walked, and restoring a chat
 * brings its lineage back with it (2026-09-26 evaluation, E-20/G-15).
 */

import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAuditLog = vi.hoisted(() => vi.fn(() => Promise.resolve('log')));
const emitHintInTx = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));
vi.mock('../contacts/service.ts', () => ({ restoreContact: vi.fn() }));

import { TRASH_LISTED_RESOURCE_TYPES } from '../../core/governance/soft_delete.ts';
import { listTrashedRows, restoreSoftDeletedRow } from './trash.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(answer: (statement: Statement) => unknown[] | undefined): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    // `sql.unsafe` fragments are spliced in as text, so the statement reads
    // as the SQL it becomes; bound values stay `?`.
    let text = strings[0] ?? '';
    const bound: unknown[] = [];
    values.forEach((value, index) => {
      if (typeof value === 'object' && value !== null && 'raw' in value) {
        text += String((value as { raw: string }).raw);
      } else {
        text += '?';
        bound.push(value);
      }
      text += strings[index + 1] ?? '';
    });
    const statement = { text, values: bound };
    statements.push(statement);
    return Promise.resolve(answer(statement) ?? []);
  };
  tag.unsafe = (text: string) => ({ raw: text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trash exercises exactly the tag and unsafe surfaces faked here
  return { sql: tag as unknown as Sql, statements };
}

const AUTH = { organizationId: 'org_1', userId: 'admin_1' };

describe('listTrashedRows', () => {
  it("reads a chat's title from app.threads and skips hidden lineage siblings", async () => {
    const { sql, statements } = fakeSql((statement) =>
      statement.text.includes('FROM app.thread_metadata t')
        ? [
            {
              id: 'thread_1',
              status: 'trashed',
              statusChangedAt: 10,
              createdAt: 10,
              displayName: 'Why the sky is blue',
              ownerId: 'user_1',
            },
          ]
        : [],
    );
    const result = await listTrashedRows(sql, 'org_1', {
      resourceTypes: ['chatThread'],
    });
    expect(result.rows).toEqual([
      expect.objectContaining({
        resourceType: 'chatThread',
        id: 'thread_1',
        displayName: 'Why the sky is blue',
      }),
    ]);
    const listing = statements.find((s) =>
      s.text.includes('FROM app.thread_metadata t'),
    );
    expect(listing?.text).toContain(
      '(SELECT th.title FROM app.threads th WHERE th.id = t.thread_id) AS "displayName"',
    );
    expect(listing?.text).toContain('AND t.hidden IS NOT true');
  });

  it('walks exactly the listed types, so a type without a trash stop is never queried', async () => {
    const { sql, statements } = fakeSql(() => []);
    await listTrashedRows(sql, 'org_1', {
      resourceTypes: ['automationRun', 'thread', 'usageLedger', 'auditLog'],
    });
    expect(statements).toEqual([]);

    await listTrashedRows(sql, 'org_1');
    const tables = statements
      .map((s) => /FROM app\.(\w+) t/.exec(s.text)?.[1])
      .filter((table) => table !== undefined);
    expect(tables).toHaveLength(TRASH_LISTED_RESOURCE_TYPES.length);
    expect(new Set(tables).size).toBe(tables.length);
  });
});

describe('restoreSoftDeletedRow', () => {
  beforeEach(() => {
    createAuditLog.mockClear();
    emitHintInTx.mockClear();
  });

  it('restores a chat with its trashed lineage siblings', async () => {
    const { sql, statements } = fakeSql((statement) =>
      statement.text.includes('RETURNING') ? [{ id: 'thread_1' }] : [],
    );
    await restoreSoftDeletedRow(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag doubles as the transaction
      sql as unknown as TransactionSql,
      AUTH,
      { resourceType: 'chatThread', id: 'thread_1' },
    );
    const cascade = statements.find(
      (s) =>
        s.text.includes('WHERE org_id = ?') &&
        s.text.includes('AND branch_root_id = ?') &&
        s.text.includes("status = 'active'"),
    );
    expect(cascade?.values).toEqual([expect.any(Number), 'org_1', 'thread_1']);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'chatThread.restored_from_trash' }),
    );
    expect(emitHintInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entity: 'chat_thread', entityId: 'thread_1' }),
    );
  });

  it('flips only the one row for a document', async () => {
    const { sql, statements } = fakeSql((statement) =>
      statement.text.includes('RETURNING') ? [{ id: 'doc_1' }] : [],
    );
    await restoreSoftDeletedRow(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag doubles as the transaction
      sql as unknown as TransactionSql,
      AUTH,
      { resourceType: 'document', id: 'doc_1' },
    );
    expect(statements.some((s) => s.text.includes('branch_root_id'))).toBe(
      false,
    );
  });

  it('refuses a type the Trash never lists', async () => {
    const { sql } = fakeSql(() => []);
    await expect(
      restoreSoftDeletedRow(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag doubles as the transaction
        sql as unknown as TransactionSql,
        AUTH,
        { resourceType: 'automationRun', id: 'run_1' },
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_TYPE_UNSUPPORTED' });
  });
});
