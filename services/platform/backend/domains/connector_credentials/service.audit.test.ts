// @vitest-environment node

/**
 * The connector-credential writes' AUDIT trail. A credential is a stored
 * secret for an external system, and before this it could be created,
 * rotated, disabled, made the default or deleted with no row in the
 * organization's audit log. Every write now leaves one in its own
 * transaction, naming the credential, its connector and auth method — the
 * secret and the config never reach a row. The actor is the signed-in
 * person a door hands in; a write without one is the system's.
 *
 * Driven against a statement-answering `sql` stand-in; the audit writer is
 * a spy. `github` + `bearer` is a shipped connector with no required config.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createAuditLog } = vi.hoisted(() => ({ createAuditLog: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));

import {
  createCredential,
  deleteCredential,
  setDefaultCredential,
  updateCredential,
} from './service.ts';

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
    const statement = {
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    };
    statements.push(statement);
    return Promise.resolve(answer(statement) ?? []);
  };
  tag.begin = (fn: (tx: unknown) => Promise<unknown>) => fn(tag);
  tag.unsafe = (text: string) => text;
  tag.json = (value: unknown) => value;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: tag as unknown as Sql, statements };
}

const ROW = {
  id: 'cred-1',
  organizationId: 'org-1',
  connectorSlug: 'github',
  authMethod: 'bearer',
  name: 'CI bot',
  encryptedData: { keyFingerprint: 'fp', iv: 'iv', ciphertext: 'ct', tag: 't' },
  endpointUrl: null,
  config: null,
  maskedPreview: 'ghp_***',
  isDefault: true,
  mailSyncInboundSince: null,
  mailSyncOutboundSince: null,
  status: 'active',
  statusDetail: null,
  createdBy: 'user-1',
  createdAt: 1,
  updatedAt: 1,
};

const ACTOR = { userId: 'user-1', email: 'ada@example.test' };

const ownRow = (row: typeof ROW) => (statement: Statement) =>
  statement.text.includes('WHERE id = ? AND org_id = ? LIMIT 1')
    ? [row]
    : undefined;

const audited = () => createAuditLog.mock.calls.map((call) => call[1]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('connector credential writes — audit rows', () => {
  it('records a creation under the signed-in person, naming the connector and never the secret', async () => {
    const { sql, statements } = fakeSql((s) =>
      s.text.startsWith('INSERT INTO app.connector_credentials')
        ? [{ id: 'cred-new' }]
        : undefined,
    );

    const created = await createCredential(sql, {
      organizationId: 'org-1',
      connectorSlug: 'github',
      authMethod: 'bearer',
      name: 'CI bot',
      secret: { token: 'ghp_super_secret' },
      createdBy: 'user-1',
      actor: ACTOR,
    });

    expect(created).toEqual({ credentialId: 'cred-new' });
    expect(audited()).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        actorId: 'user-1',
        actorEmail: 'ada@example.test',
        actorType: 'user',
        action: 'connector_credential.created',
        category: 'connector',
        resourceType: 'connector_credential',
        resourceId: 'cred-new',
        resourceName: 'CI bot',
        newState: { name: 'CI bot', status: 'active', isDefault: true },
        metadata: { connectorSlug: 'github', authMethod: 'bearer' },
        status: 'success',
      }),
    ]);
    expect(JSON.stringify(audited())).not.toContain('ghp_super_secret');
    // Written on the transaction the insert rides.
    expect(createAuditLog).toHaveBeenCalledWith(sql, expect.anything());
    expect(
      statements.some((s) =>
        s.text.startsWith('INSERT INTO app.connector_credentials'),
      ),
    ).toBe(true);
  });

  it('records an update with the patched fields and the state before and after', async () => {
    const { sql } = fakeSql(ownRow(ROW));

    await updateCredential(sql, {
      organizationId: 'org-1',
      credentialId: 'cred-1',
      name: 'CI bot (renamed)',
      status: 'disabled',
      actor: ACTOR,
    });

    expect(audited()).toEqual([
      expect.objectContaining({
        actorId: 'user-1',
        action: 'connector_credential.updated',
        resourceId: 'cred-1',
        resourceName: 'CI bot (renamed)',
        previousState: { name: 'CI bot', status: 'active', isDefault: true },
        newState: {
          name: 'CI bot (renamed)',
          status: 'disabled',
          isDefault: true,
        },
        changedFields: ['name', 'status'],
        metadata: { connectorSlug: 'github', authMethod: 'bearer' },
      }),
    ]);
  });

  it('records a secret rotation by field name only', async () => {
    const { sql } = fakeSql(ownRow(ROW));

    await updateCredential(sql, {
      organizationId: 'org-1',
      credentialId: 'cred-1',
      secret: { token: 'ghp_rotated_secret' },
      actor: ACTOR,
    });

    expect(audited()[0]).toEqual(
      expect.objectContaining({
        action: 'connector_credential.updated',
        changedFields: ['secret'],
      }),
    );
    expect(JSON.stringify(audited())).not.toContain('ghp_rotated_secret');
  });

  // The OAuth callback renews a grant on the person's behalf and hands the
  // actor in; a write with none is the system's, never a made-up person.
  it('records the system as the actor when no person was handed in', async () => {
    const { sql } = fakeSql(ownRow(ROW));

    await updateCredential(sql, {
      organizationId: 'org-1',
      credentialId: 'cred-1',
      status: 'needs-reauth',
    });

    expect(audited()[0]).toEqual(
      expect.objectContaining({
        actorId: 'system',
        actorType: 'system',
        action: 'connector_credential.updated',
        changedFields: ['status'],
      }),
    );
    expect(audited()[0]).not.toHaveProperty('actorEmail');
  });

  it('records a deletion with the state it removed and the default it promoted', async () => {
    const { sql } = fakeSql(
      (s) =>
        ownRow(ROW)(s) ??
        (s.text.startsWith('SELECT id FROM app.connector_credentials')
          ? [{ id: 'cred-2' }]
          : undefined),
    );

    await deleteCredential(sql, 'org-1', 'cred-1', ACTOR);

    expect(audited()).toEqual([
      expect.objectContaining({
        actorId: 'user-1',
        action: 'connector_credential.deleted',
        resourceId: 'cred-1',
        resourceName: 'CI bot',
        previousState: { name: 'CI bot', status: 'active', isDefault: true },
        metadata: {
          connectorSlug: 'github',
          authMethod: 'bearer',
          promotedDefaultId: 'cred-2',
        },
      }),
    ]);
  });

  it('folds a default switch into an update on isDefault, and records nothing when already the default', async () => {
    const secondary = {
      ...ROW,
      id: 'cred-2',
      name: 'Backup',
      isDefault: false,
    };
    const { sql } = fakeSql(ownRow(secondary));

    await setDefaultCredential(sql, 'org-1', 'cred-2', ACTOR);

    expect(audited()).toEqual([
      expect.objectContaining({
        action: 'connector_credential.updated',
        resourceId: 'cred-2',
        previousState: { name: 'Backup', status: 'active', isDefault: false },
        newState: { name: 'Backup', status: 'active', isDefault: true },
        changedFields: ['isDefault'],
      }),
    ]);

    vi.clearAllMocks();
    // A row that is already the default: nothing changed, nothing recorded.
    const { sql: already } = fakeSql(ownRow(ROW));
    await setDefaultCredential(already, 'org-1', 'cred-1', ACTOR);
    expect(
      audited().filter(
        (row) => (row as { resourceId: string }).resourceId === 'cred-1',
      ),
    ).toEqual([]);
  });
});
