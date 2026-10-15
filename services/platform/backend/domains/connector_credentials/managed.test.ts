// @vitest-environment node

/**
 * A connector credential as a managed declaration reads and writes it: the
 * readback names its secret fields and a digest of their values — never a
 * value — a credential the connector renews is never declared, and the
 * write goes through the connector settings' own writers on the hash its
 * plan read, keeping the sign-in method the credential was created with.
 */

import {
  connectorCredentialDigestScope,
  managedSecretDigest,
} from '@tale/shared/config/managed-secret';
import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';

vi.mock('../../core/lib/secret_box.ts', () => ({
  encryptSecret: vi.fn((value: string) => ({ sealed: value })),
  decryptSecret: vi.fn((envelope: { sealed: string }) => envelope.sealed),
  KeyRotatedError: class KeyRotatedError extends Error {},
}));
vi.mock('./service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service.ts')>();
  return {
    ...actual,
    lockCredentialPair: vi.fn(),
    createCredentialInTransaction: vi.fn(() =>
      Promise.resolve({ credentialId: 'created' }),
    ),
    updateCredentialInTransaction: vi.fn(),
  };
});

const service = await import('./service.ts');
const {
  checkManagedConnectorCredential,
  readManagedConnectorCredential,
  writeManagedConnectorCredential,
} = await import('./managed.ts');

const PASSWORD = 'jira-stored-secret-value-0001';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cred-1',
    organizationId: 'org-1',
    connectorSlug: 'jira',
    authMethod: 'basic',
    name: 'Ops',
    encryptedData: {
      sealed: JSON.stringify({
        username: 'ops@example.com',
        password: PASSWORD,
      }),
    },
    endpointUrl: 'https://ops.atlassian.net',
    config: null,
    maskedPreview: null,
    isDefault: true,
    status: 'active',
    statusDetail: null,
    createdBy: 'ada',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** An organization's credentials for one connector. */
function database(rows: ReturnType<typeof row>[]) {
  const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM app.connector_credentials'))
      return Promise.resolve(
        rows.filter(
          (candidate) =>
            candidate.name.toLowerCase() === String(values[3]).toLowerCase(),
        ),
      );
    return Promise.resolve([]);
  };
  Object.assign(query, {
    unsafe: (text: string) => text,
    begin: (work: (tx: unknown) => Promise<unknown>) => work(query),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return query as unknown as Sql;
}

const view = {
  connector: 'jira',
  name: 'Ops',
  authMethod: 'basic',
  endpoint: 'https://ops.atlassian.net',
  isDefault: true,
  fields: ['password', 'username'],
  valueDigest: managedSecretDigest({
    organizationId: 'org-1',
    scope: connectorCredentialDigestScope('jira', 'Ops'),
    value: { username: 'ops@example.com', password: PASSWORD },
  }),
};

const ada = { userId: 'ada' };

afterEach(() => {
  vi.clearAllMocks();
});

describe('a declared credential is read back as a digest of its values; a renewed sign-in is never declared [CCRED-R8]', () => {
  it('answers its fields by name and the digest of their values, whatever the name’s case', async () => {
    const read = await readManagedConnectorCredential(
      database([row()]),
      'org-1',
      'jira',
      'OPS',
    );
    expect(read).toEqual({
      config: view,
      hash: managedConfigurationHash(view),
    });
    expect(JSON.stringify(read)).not.toContain(PASSWORD);
  });

  it('refuses a credential the connector renews', async () => {
    await expect(
      readManagedConnectorCredential(
        database([
          row({
            authMethod: 'oauth2',
            encryptedData: { sealed: JSON.stringify({ accessToken: 'x' }) },
          }),
        ]),
        'org-1',
        'jira',
        'Ops',
      ),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_DECLARABLE' });
  });

  it('creates an absent credential only when the declaration may, with its values', async () => {
    await expect(
      readManagedConnectorCredential(
        database([]),
        'org-1',
        'jira',
        'Ops',
        true,
      ),
    ).resolves.toEqual({ config: null, hash: null });
    const config = {
      connector: 'jira',
      name: 'Ops',
      authMethod: 'basic' as const,
      endpoint: 'https://ops.atlassian.net',
    };
    const secret = { username: 'ops@example.com', password: PASSWORD };
    await expect(
      writeManagedConnectorCredential(database([]), {
        config,
        secret,
        expectedHash: null,
        organizationId: 'org-1',
        actor: ada,
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    await writeManagedConnectorCredential(database([]), {
      config,
      secret,
      expectedHash: null,
      createIfMissing: true,
      organizationId: 'org-1',
      actor: ada,
    });
    expect(service.createCredentialInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'org-1',
        connectorSlug: 'jira',
        authMethod: 'basic',
        name: 'Ops',
        secret,
        endpointUrl: 'https://ops.atlassian.net',
        createdBy: 'ada',
        actor: ada,
      },
    );
  });

  it('rewrites an existing credential on the hash its plan read, never under another sign-in method', async () => {
    const secret = { username: 'ops@example.com', password: 'rotated' };
    await writeManagedConnectorCredential(database([row()]), {
      config: { connector: 'jira', name: 'Ops', authMethod: 'basic' },
      secret,
      expectedHash: managedConfigurationHash(view),
      organizationId: 'org-1',
      actor: ada,
    });
    expect(service.updateCredentialInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'org-1',
        credentialId: 'cred-1',
        name: 'Ops',
        secret,
        actor: ada,
      },
    );
    await expect(
      writeManagedConnectorCredential(database([row()]), {
        config: { connector: 'jira', name: 'Ops', authMethod: 'bearer' },
        secret: { token: 'x' },
        expectedHash: managedConfigurationHash(view),
        organizationId: 'org-1',
        actor: ada,
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_AUTH_METHOD_FIXED' });
    await expect(
      writeManagedConnectorCredential(database([row()]), {
        config: { connector: 'jira', name: 'Ops', authMethod: 'basic' },
        secret,
        expectedHash: null,
        createIfMissing: true,
        organizationId: 'org-1',
        actor: ada,
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    expect(service.updateCredentialInTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('a declared credential is checked against its connector before anything is written [CCRED-R8]', () => {
  type Target = Parameters<typeof checkManagedConnectorCredential>[2];
  /** The verdict on a declared credential, against the shipped catalog. */
  const check = (
    config: Omit<Target, 'name' | 'authMethod'> &
      Partial<Pick<Target, 'authMethod'>>,
    rows: ReturnType<typeof row>[] = [],
  ) =>
    checkManagedConnectorCredential(database(rows), 'org-1', {
      name: 'Ops',
      authMethod: 'basic',
      ...config,
    });
  const refusal = (path: string, code: string) => ({
    ok: false,
    issues: [{ path, code, message: expect.any(String) }],
  });

  it('takes a new credential its connector takes as declared', async () => {
    await expect(
      check({
        connector: 'confluence',
        endpoint: 'https://ops.atlassian.net',
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      check({ connector: 'github', authMethod: 'bearer' }),
    ).resolves.toEqual({ ok: true });
  });

  it('names the field its connector refuses', async () => {
    await expect(check({ connector: 'jirra' })).resolves.toEqual(
      refusal('connector', 'CONNECTOR_UNKNOWN'),
    );
    await expect(check({ connector: 'github' })).resolves.toEqual(
      refusal('authMethod', 'AUTH_METHOD_NOT_SUPPORTED'),
    );
    await expect(check({ connector: 'confluence' })).resolves.toEqual(
      refusal('endpoint', 'CREDENTIAL_ENDPOINT_REQUIRED'),
    );
    await expect(
      check({
        connector: 'github',
        authMethod: 'bearer',
        endpoint: 'https://github.example.com',
      }),
    ).resolves.toEqual(refusal('endpoint', 'CREDENTIAL_ENDPOINT_INVALID'));
  });

  it('refuses a new credential whose connector needs settings a declaration has none of', async () => {
    // A mailbox needs its IMAP and SMTP servers, HTTP its base URL.
    await expect(check({ connector: 'imap-smtp' })).resolves.toEqual(
      refusal('connector', 'CREDENTIAL_CONFIG_REQUIRED'),
    );
    await expect(
      check({ connector: 'http', authMethod: 'bearer' }),
    ).resolves.toEqual(refusal('connector', 'CREDENTIAL_CONFIG_REQUIRED'));
  });

  it('keeps an existing credential’s sign-in method, settings and endpoint unless stated', async () => {
    const stored = row({ connectorSlug: 'confluence' });
    await expect(check({ connector: 'confluence' }, [stored])).resolves.toEqual(
      { ok: true },
    );
    await expect(
      check({ connector: 'confluence', authMethod: 'api-key' }, [stored]),
    ).resolves.toEqual(refusal('authMethod', 'CREDENTIAL_AUTH_METHOD_FIXED'));
    await expect(
      check({ connector: 'confluence' }, [
        row({ connectorSlug: 'confluence', authMethod: 'oauth2' }),
      ]),
    ).resolves.toEqual(refusal('authMethod', 'CREDENTIAL_NOT_DECLARABLE'));
  });
});
