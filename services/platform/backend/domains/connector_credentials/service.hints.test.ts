// @vitest-environment node

/**
 * #3712: an open Settings > Connectors page learns about another session's
 * credential writes only through the realtime hint stream. Every write the
 * listing shows — create (the settings door and the consent callback's
 * in-transaction seam alike), update, delete with its default hand-over,
 * set default and the mailbox config heal — inserts one
 * `connector_credential` hint for the organization, in the write's own
 * transaction. A write that changes nothing emits none.
 *
 * Driven against a statement-answering `sql` stand-in; the audit writer is
 * a spy. `github` + `bearer` is a shipped connector with no required config.
 */

import type { Sql, TransactionSql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONNECTOR_CREDENTIAL_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';

const { createAuditLog } = vi.hoisted(() => ({ createAuditLog: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));

import {
  createCredential,
  createCredentialInTransaction,
  deleteCredential,
  patchCredentialConfigInternal,
  patchMailSyncWatermarks,
  setDefaultCredential,
  updateCredential,
} from './service.ts';

interface Statement {
  text: string;
  values: unknown[];
  /** Whether it ran inside `sql.begin`. */
  inTransaction: boolean;
}

function fakeSql(answer: (statement: Statement) => unknown[] | undefined): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  let depth = 0;
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = {
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
      inTransaction: depth > 0,
    };
    statements.push(statement);
    return Promise.resolve(answer(statement) ?? []);
  };
  tag.begin = async (fn: (tx: unknown) => Promise<unknown>) => {
    depth += 1;
    try {
      return await fn(tag);
    } finally {
      depth -= 1;
    }
  };
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

/** The outbox rows a run inserted, as the hint each one carries. */
function hints(statements: readonly Statement[]) {
  return statements
    .filter((s) => s.text.startsWith('INSERT INTO app_realtime.outbox'))
    .map((s) => ({
      orgId: s.values[0],
      userId: s.values[1],
      entity: s.values[2],
      entityId: s.values[3],
      inTransaction: s.inTransaction,
    }));
}

const hintFor = (entityId: string) => ({
  orgId: 'org-1',
  // Org-wide: every admin's open tab, not only the writer's.
  userId: null,
  entity: CONNECTOR_CREDENTIAL_HINT_ENTITY,
  entityId,
  inTransaction: true,
});

const ownRow =
  (row: typeof ROW, extra?: (s: Statement) => unknown[] | undefined) =>
  (statement: Statement) =>
    statement.text.includes('WHERE id = ? AND org_id = ? LIMIT 1')
      ? [row]
      : extra?.(statement);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('connector credential writes — realtime hints', () => {
  it('hints a creation to the whole organization, inside its transaction', async () => {
    const { sql, statements } = fakeSql((s) =>
      s.text.startsWith('INSERT INTO app.connector_credentials')
        ? [{ id: 'cred-new' }]
        : undefined,
    );

    await createCredential(sql, {
      organizationId: 'org-1',
      connectorSlug: 'github',
      authMethod: 'bearer',
      name: 'CI bot',
      secret: { token: 'ghp_super_secret' },
      createdBy: 'user-1',
      actor: ACTOR,
    });

    expect(hints(statements)).toEqual([hintFor('cred-new')]);
    // The hint names the row, never its secret.
    expect(JSON.stringify(hints(statements))).not.toContain('ghp_');
  });

  it('hints a consent-callback creation in the transaction the callback owns', async () => {
    // The OAuth callback adds (and Reconnect renews) through the
    // in-transaction seams: the hint rides the caller's transaction.
    const { sql, statements } = fakeSql((s) =>
      s.text.startsWith('INSERT INTO app.connector_credentials')
        ? [{ id: 'cred-oauth' }]
        : undefined,
    );

    await sql.begin((tx) =>
      createCredentialInTransaction(tx as unknown as TransactionSql, {
        organizationId: 'org-1',
        connectorSlug: 'github',
        authMethod: 'bearer',
        name: 'CI bot',
        secret: { token: 'ghp_from_consent' },
        createdBy: 'user-1',
      }),
    );

    expect(hints(statements)).toEqual([hintFor('cred-oauth')]);
  });

  it('hints an update: a rename, a rotation, a disable', async () => {
    for (const patch of [
      { name: 'Release bot' },
      { secret: { token: 'ghp_rotated' } },
      { status: 'disabled' as const },
    ]) {
      const { sql, statements } = fakeSql(ownRow(ROW));
      await updateCredential(sql, {
        organizationId: 'org-1',
        credentialId: 'cred-1',
        ...patch,
        actor: ACTOR,
      });
      expect(hints(statements)).toEqual([hintFor('cred-1')]);
    }
  });

  it('hints a delete — and with it the default it handed on', async () => {
    const { sql, statements } = fakeSql(
      ownRow(ROW, (s) =>
        s.text.includes('WHERE org_id = ? AND connector_slug = ?')
          ? [ROW, { ...ROW, id: 'cred-2', isDefault: false, createdAt: 2 }]
          : undefined,
      ),
    );

    await deleteCredential(sql, 'org-1', 'cred-1', ACTOR);

    // One hint covers both rows: the listing refetches whole.
    expect(hints(statements)).toEqual([hintFor('cred-1')]);
  });

  it('hints a new default, and stays quiet when it already was', async () => {
    const other = { ...ROW, id: 'cred-2', isDefault: false };
    let run = fakeSql(ownRow(other));
    await setDefaultCredential(run.sql, 'org-1', 'cred-2', ACTOR);
    expect(hints(run.statements)).toEqual([hintFor('cred-2')]);

    run = fakeSql(ownRow(ROW));
    await setDefaultCredential(run.sql, 'org-1', 'cred-1', ACTOR);
    expect(hints(run.statements)).toEqual([]);
  });

  it('hints the mailbox config heal, which changes the sender the Inbox names', async () => {
    const { sql, statements } = fakeSql((s) =>
      s.text.startsWith('UPDATE app.connector_credentials')
        ? [{ id: 'cred-1' }]
        : undefined,
    );

    await patchCredentialConfigInternal(sql, 'org-1', 'cred-1', {
      imapHost: 'imap.example.test',
      fromAddress: 'inbox@example.test',
    });

    expect(hints(statements)).toEqual([hintFor('cred-1')]);
  });

  it('stays quiet for a heal of a row that is gone, and for the sync cursor', async () => {
    const heal = fakeSql(() => undefined);
    await patchCredentialConfigInternal(heal.sql, 'org-1', 'cred-gone', {
      imapHost: 'imap.example.test',
    });
    expect(hints(heal.statements)).toEqual([]);

    // The mail sync advances its cursor on every pass; nothing a listing
    // shows moved, so no tab refetches for it.
    const cursor = fakeSql(() => undefined);
    await patchMailSyncWatermarks(cursor.sql, 'org-1', 'cred-1', {
      inboundSince: 5,
    });
    expect(hints(cursor.statements)).toEqual([]);
  });

  it('emits nothing for a write the service refused', async () => {
    const { sql, statements } = fakeSql(() => undefined);
    await expect(
      updateCredential(sql, {
        organizationId: 'org-1',
        credentialId: 'cred-gone',
        name: 'x',
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    expect(hints(statements)).toEqual([]);
  });
});
