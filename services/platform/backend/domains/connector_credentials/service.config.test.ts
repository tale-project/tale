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

import {
  createCredential,
  listCredentials,
  normalizeNewCredentialConfig,
  updateCredential,
} from './service.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** A `sql` that records every statement, answers the insert with an id
 * and a read of the table with `stored`, when given. */
function fakeSql(stored?: Record<string, unknown>): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('INSERT INTO app.connector_credentials')) {
      return Promise.resolve([{ id: 'cred-new' }]);
    }
    if (
      stored !== undefined &&
      text.startsWith('SELECT') &&
      text.includes('FROM app.connector_credentials')
    ) {
      return Promise.resolve([stored]);
    }
    return Promise.resolve([]);
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

/** The stored row of an app sign-in, as the table answers it. */
const APP_ROW = {
  id: 'cred-app',
  organizationId: 'org-1',
  connectorSlug: 'outlook',
  authMethod: 'client-credentials',
  name: 'Promotion mailbox',
  encryptedData: { keyFingerprint: 'fp', iv: 'iv', ciphertext: 'ct', tag: 't' },
  endpointUrl: null,
  config: {
    mailbox: 'promotion@example.com',
    fromAddress: 'promotion@example.com',
  },
  maskedPreview: 'app-…ue',
  clientApp: { tenantId: 'contoso.onmicrosoft.com', clientId: 'app-client-id' },
  isDefault: true,
  mailSyncInboundSince: null,
  mailSyncOutboundSince: null,
  status: 'active',
  statusDetail: null,
  createdBy: 'user-1',
  createdAt: 1,
  updatedAt: 1,
};

/** The statement that wrote the row, and the values it carried. */
function write(statements: readonly Statement[], verb: 'INSERT' | 'UPDATE') {
  const statement = statements.find(
    (entry) =>
      entry.text.startsWith(`${verb} INTO app.connector_credentials`) ||
      entry.text.startsWith(`${verb} app.connector_credentials`),
  );
  if (statement === undefined) throw new Error(`no ${verb} of the row`);
  return statement;
}

describe('an app sign-in shows which app it signs in as, never its secret [CCRED-R11]', () => {
  it('stores the directory and application ID beside the sealed secret', async () => {
    const { sql, statements } = fakeSql();

    await createCredential(sql, {
      ...APP_SIGN_IN,
      config: { mailbox: 'promotion@example.com' },
    });

    const insert = write(statements, 'INSERT');
    expect(insert.text).toContain('client_app');
    expect(insert.values).toContainEqual({
      tenantId: 'contoso.onmicrosoft.com',
      clientId: 'app-client-id',
    });
    expect(JSON.stringify(insert.values)).not.toContain(
      'app-client-secret-value',
    );
  });

  it('lists them on the row, beside the client secret’s excerpt', async () => {
    const { sql } = fakeSql(APP_ROW);

    const [listed] = await listCredentials(sql, 'org-1');

    expect(listed).toMatchObject({
      maskedPreview: 'app-…ue',
      clientApp: {
        tenantId: 'contoso.onmicrosoft.com',
        clientId: 'app-client-id',
      },
    });
  });

  it('rewrites them with a replaced secret, and keeps them through any other edit', async () => {
    const replaced = fakeSql(APP_ROW);
    await updateCredential(replaced.sql, {
      organizationId: 'org-1',
      credentialId: 'cred-app',
      secret: {
        tenantId: 'fabrikam.onmicrosoft.com',
        clientId: 'other-app-id',
        clientSecret: 'other-secret-value',
      },
    });
    expect(write(replaced.statements, 'UPDATE').values).toContainEqual({
      tenantId: 'fabrikam.onmicrosoft.com',
      clientId: 'other-app-id',
    });

    const renamed = fakeSql(APP_ROW);
    await updateCredential(renamed.sql, {
      organizationId: 'org-1',
      credentialId: 'cred-app',
      name: 'Promotion',
    });
    // `unsafe('client_app')`: the column keeps what it holds.
    expect(write(renamed.statements, 'UPDATE').values).toContain('client_app');
  });
});

describe('a setting the connector fixes is kept for the credential’s life [CCRED-R12]', () => {
  const PERSON_ROW = {
    ...APP_ROW,
    id: 'cred-lena',
    authMethod: 'oauth2',
    name: 'Promotion (Lena)',
    clientApp: null,
  };
  const edit = (config: Record<string, string>) => {
    const { sql, statements } = fakeSql(PERSON_ROW);
    return {
      statements,
      done: updateCredential(sql, {
        organizationId: 'org-1',
        credentialId: 'cred-lena',
        config,
      }),
    };
  };

  it('refuses an edit that moves the credential to another mailbox, or off its mailbox', async () => {
    const moves: Record<string, string>[] = [
      { mailbox: 'support@example.com' },
      {},
      { mailbox: '  ' },
    ];
    for (const config of moves) {
      const { statements, done } = edit(config);
      await expect(done).rejects.toMatchObject({
        code: 'CREDENTIAL_CONFIG_INVALID',
        message: expect.stringContaining('add another credential'),
      });
      expect(
        statements.some((statement) => statement.text.startsWith('UPDATE')),
      ).toBe(false);
    }
  });

  it('saves an edit that keeps the mailbox, however it is spaced', async () => {
    const { statements, done } = edit({
      mailbox: ' promotion@example.com ',
      fromAddress: 'promotion@example.com',
    });
    await done;
    expect(write(statements, 'UPDATE').values).toContainEqual({
      mailbox: 'promotion@example.com',
      fromAddress: 'promotion@example.com',
    });
  });

  it('never fixes a setting the connector leaves editable', async () => {
    const { sql } = fakeSql({
      ...APP_ROW,
      connectorSlug: 'imap-smtp',
      authMethod: 'basic',
      clientApp: null,
      config: {
        imapHost: 'imap.example.com',
        smtpHost: 'smtp.example.com',
        fromAddress: 'lena@example.com',
      },
    });
    await expect(
      updateCredential(sql, {
        organizationId: 'org-1',
        credentialId: 'cred-app',
        config: {
          imapHost: 'imap.other.example',
          smtpHost: 'smtp.other.example',
          fromAddress: 'lena@example.com',
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('checks a new connection’s settings by the rules it will be created by', () => {
    expect(
      normalizeNewCredentialConfig('outlook', 'oauth2', {
        mailbox: ' promotion@example.com ',
      }),
    ).toEqual({ mailbox: 'promotion@example.com' });
    expect(() =>
      normalizeNewCredentialConfig('outlook', 'oauth2', { region: 'eu' }),
    ).toThrow(/has no setting "region"/);
    expect(() =>
      normalizeNewCredentialConfig('slack', 'oauth2', { mailbox: 'x@y.z' }),
    ).toThrow(/takes no per-credential settings/);
  });
});
