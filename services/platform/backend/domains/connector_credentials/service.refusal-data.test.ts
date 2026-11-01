// @vitest-environment node

/**
 * #5222: every refusal of the connector credential door names what its
 * English sentence interpolates — the connector, the setting or secret field
 * by its key, the sign-in method, a limit — in `data`, with the `reason`
 * that tells one refusal of a code from another, so the Settings surface can
 * word it in the admin's language. Never a secret, never a typed value.
 * Every refusal here is reached before a statement runs.
 */

import { describe, expect, it, vi } from 'vitest';

const { createAuditLog } = vi.hoisted(() => ({ createAuditLog: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));

import {
  ConnectorCredentialError,
  createCredential,
  normalizeNewCredentialConfig,
  type CreateCredentialArgs,
} from './service.ts';

/** A `sql` no refusal here may reach. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- never called: every case refuses first
const noSql = {} as never;

const base = {
  organizationId: 'org-1',
  name: 'Primary',
  createdBy: 'user-1',
} as const;

async function refusalOf(
  args: Omit<CreateCredentialArgs, keyof typeof base>,
): Promise<ConnectorCredentialError> {
  const error: unknown = await createCredential(noSql, {
    ...base,
    ...args,
  }).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ConnectorCredentialError);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- asserted just above
  return error as ConnectorCredentialError;
}

function thrownBy(run: () => unknown): ConnectorCredentialError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectorCredentialError);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- asserted just above
    return error as ConnectorCredentialError;
  }
  throw new Error('expected a refusal');
}

describe('a connector credential refusal names its values beside its code', () => {
  it('names the connector the catalog does not know', async () => {
    const refusal = await refusalOf({
      connectorSlug: 'no-such-connector',
      authMethod: 'bearer',
      secret: { token: 't' },
    });
    expect(refusal).toMatchObject({
      code: 'CONNECTOR_UNKNOWN',
      status: 404,
      data: { connector: 'no-such-connector' },
    });
  });

  it('names the sign-in method and the ones the connector accepts', async () => {
    const refusal = await refusalOf({
      connectorSlug: 'outlook',
      authMethod: 'bearer',
      secret: { token: 't' },
    });
    expect(refusal).toMatchObject({
      code: 'AUTH_METHOD_NOT_SUPPORTED',
      data: {
        connector: 'outlook',
        authMethod: 'bearer',
        accepted: ['oauth2', 'client-credentials'],
      },
    });
  });

  it('names the endpoint refusal by its reason, never the typed URL', async () => {
    const forgejo = { connectorSlug: 'forgejo', authMethod: 'bearer' } as const;
    const secret = { token: 't' };
    expect(await refusalOf({ ...forgejo, secret })).toMatchObject({
      code: 'CREDENTIAL_ENDPOINT_REQUIRED',
      data: { connector: 'forgejo' },
    });
    for (const [endpointUrl, reason] of [
      ['not a url', 'notUrl'],
      ['http://git.example.com', 'notHttps'],
      ['https://user:pw@git.example.com', 'credentials'],
    ] as const) {
      const refusal = await refusalOf({ ...forgejo, secret, endpointUrl });
      expect(refusal.code).toBe('CREDENTIAL_ENDPOINT_INVALID');
      expect(refusal.data).toEqual({ connector: 'forgejo', reason });
    }
    expect(
      await refusalOf({
        ...forgejo,
        secret,
        endpointUrl: 'https://git.example.com/api/v1?x=1',
      }),
    ).toMatchObject({
      code: 'CREDENTIAL_ENDPOINT_INVALID',
      data: {
        connector: 'forgejo',
        reason: 'notOrigin',
        origin: 'https://git.example.com',
      },
    });
    expect(
      await refusalOf({
        connectorSlug: 'github',
        authMethod: 'bearer',
        secret,
        endpointUrl: 'https://github.example.com',
      }),
    ).toMatchObject({
      code: 'CREDENTIAL_ENDPOINT_INVALID',
      data: { connector: 'github', reason: 'fixed' },
    });
  });

  it('names the setting by its key, and the limit it broke', () => {
    const imap = (config: Record<string, string | number | boolean>) =>
      thrownBy(() =>
        normalizeNewCredentialConfig('imap-smtp', 'basic', config),
      );
    const hosts = {
      imapHost: 'imap.example.com',
      smtpHost: 'smtp.example.com',
    };

    expect(imap({ smtpHost: 'smtp.example.com' })).toMatchObject({
      code: 'CREDENTIAL_CONFIG_REQUIRED',
      data: { connector: 'imap-smtp', field: 'imapHost', reason: 'required' },
    });
    expect(imap({ ...hosts, imapPort: 70000 })).toMatchObject({
      code: 'CREDENTIAL_CONFIG_INVALID',
      data: {
        connector: 'imap-smtp',
        field: 'imapPort',
        reason: 'number',
        min: 1,
        max: 65535,
      },
    });
    expect(imap({ ...hosts, security: 'ssl' })).toMatchObject({
      code: 'CREDENTIAL_CONFIG_INVALID',
      data: {
        field: 'security',
        reason: 'option',
        options: ['tls', 'starttls'],
      },
    });
    expect(imap({ ...hosts, region: 'eu' })).toMatchObject({
      code: 'CREDENTIAL_CONFIG_INVALID',
      data: { connector: 'imap-smtp', field: 'region', reason: 'unknown' },
    });
    expect(
      thrownBy(() =>
        normalizeNewCredentialConfig('slack', 'oauth2', { mailbox: 'x@y.z' }),
      ),
    ).toMatchObject({
      code: 'CREDENTIAL_CONFIG_INVALID',
      data: { connector: 'slack', reason: 'none' },
    });
    expect(
      thrownBy(() =>
        normalizeNewCredentialConfig('outlook', 'client-credentials', {}),
      ),
    ).toMatchObject({
      code: 'CREDENTIAL_CONFIG_REQUIRED',
      data: {
        connector: 'outlook',
        field: 'mailbox',
        authMethod: 'client-credentials',
        reason: 'requiredFor',
      },
    });
    const email = thrownBy(() =>
      normalizeNewCredentialConfig('outlook', 'oauth2', { mailbox: 'support' }),
    );
    expect(email).toMatchObject({
      code: 'CREDENTIAL_CONFIG_INVALID',
      data: { connector: 'outlook', field: 'mailbox', reason: 'email' },
    });
    expect(JSON.stringify(email.data)).not.toContain('support');
  });

  it('names the secret field by its key, never its value', async () => {
    const blank = await refusalOf({
      connectorSlug: 'tavily',
      authMethod: 'api-key',
      secret: { token: '   ' },
    });
    expect(blank).toMatchObject({
      code: 'CREDENTIAL_SECRET_INVALID',
      data: {
        field: 'token',
        authMethod: 'api-key',
        reason: 'length',
        max: 8192,
      },
    });

    const tenant = await refusalOf({
      connectorSlug: 'outlook',
      authMethod: 'client-credentials',
      secret: {
        tenantId: 'not/a/tenant',
        clientId: 'app',
        clientSecret: 'shh',
      },
      config: { mailbox: 'support@example.com' },
    });
    expect(tenant).toMatchObject({
      code: 'CREDENTIAL_SECRET_INVALID',
      data: {
        authMethod: 'client-credentials',
        field: 'tenantId',
        reason: 'shape',
      },
    });
    expect(JSON.stringify(tenant.data)).not.toContain('shh');

    expect(
      await refusalOf({
        connectorSlug: 'outlook',
        authMethod: 'client-credentials',
        secret: { clientId: 'app', clientSecret: 'shh' },
        config: { mailbox: 'support@example.com' },
      }),
    ).toMatchObject({
      code: 'CREDENTIAL_SECRET_INVALID',
      data: { connector: 'outlook', field: 'tenantId', reason: 'required' },
    });
  });
});
