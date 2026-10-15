// @vitest-environment node

/**
 * A credential's per-credential settings (`configFields`) at the door: what
 * is stored of a value, and what refuses one. Driven through the shipped
 * Outlook connector, whose `mailbox` an app signing in as itself requires.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createAuditLog } = vi.hoisted(() => ({ createAuditLog: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));

import { createCredential } from './service.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** A `sql` that records every statement and answers the insert with an id. */
function fakeSql(): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(
      text.startsWith('INSERT INTO app.connector_credentials')
        ? [{ id: 'cred-new' }]
        : [],
    );
  };
  tag.begin = (fn: (tx: unknown) => Promise<unknown>) => fn(tag);
  tag.unsafe = (text: string) => text;
  tag.json = (value: unknown) => value;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: tag as unknown as Sql, statements };
}

/** The config the credential insert stored. */
function storedConfig(statements: readonly Statement[]): unknown {
  const insert = statements.find((statement) =>
    statement.text.startsWith('INSERT INTO app.connector_credentials'),
  );
  return insert?.values.find(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      'mailbox' in (value as Record<string, unknown>),
  );
}

const APP_SIGN_IN = {
  organizationId: 'org-1',
  connectorSlug: 'outlook',
  authMethod: 'client-credentials' as const,
  name: 'Promotion mailbox',
  secret: {
    tenantId: 'contoso.onmicrosoft.com',
    clientId: 'app-client-id',
    clientSecret: 'app-client-secret-value',
  },
  createdBy: 'user-1',
};

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('a per-credential setting is stored without the blanks around it [CONN-R29]', () => {
  it('stores the mailbox trimmed, and mirrors it as the From', async () => {
    const { sql, statements } = fakeSql();

    await createCredential(sql, {
      ...APP_SIGN_IN,
      config: { mailbox: '  promotion@example.com ' },
    });

    expect(storedConfig(statements)).toEqual({
      mailbox: 'promotion@example.com',
      fromAddress: 'promotion@example.com',
    });
  });

  it('refuses a mailbox of blanks where an app sign-in requires one', async () => {
    const { sql, statements } = fakeSql();

    await expect(
      createCredential(sql, { ...APP_SIGN_IN, config: { mailbox: '   ' } }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_CONFIG_REQUIRED' });
    expect(statements).toEqual([]);
  });
});
