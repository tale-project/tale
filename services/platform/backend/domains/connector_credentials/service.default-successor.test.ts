// @vitest-environment node

/**
 * #3713: deleting a connector's DEFAULT credential hands the default to the
 * oldest remaining active credential of that connector — a continuity rule
 * since 0.4, so calls that name no credential keep working — but the delete
 * confirm said no default would remain. The rule now lives in one function:
 * the delete applies it, and the listing names its answer on the default
 * row, so the confirm can say which account takes over before the admin
 * deletes.
 *
 * Driven against a statement-answering `sql` stand-in; the audit writer is
 * a spy.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));

import {
  defaultSuccessor,
  deleteCredential,
  listCredentials,
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

type Status = 'active' | 'disabled' | 'needs-reauth';

function row(
  id: string,
  name: string,
  createdAt: number,
  patch: { isDefault?: boolean; status?: Status; connectorSlug?: string } = {},
) {
  return {
    id,
    organizationId: 'org-1',
    connectorSlug: patch.connectorSlug ?? 'github',
    authMethod: 'bearer' as const,
    name,
    encryptedData: {
      keyFingerprint: 'fp',
      iv: 'iv',
      ciphertext: 'ct',
      tag: 't',
    },
    endpointUrl: null,
    config: null,
    maskedPreview: 'ghp_***',
    isDefault: patch.isDefault ?? false,
    mailSyncInboundSince: null,
    mailSyncOutboundSince: null,
    status: patch.status ?? ('active' as Status),
    statusDetail: null,
    createdBy: 'user-1',
    createdAt,
    updatedAt: createdAt,
  };
}

const SUPPORT = row('cred-support', 'Support bot', 1, { isDefault: true });
const RELEASE = row('cred-release', 'Release bot', 3);
const OPS = row('cred-ops', 'Ops bot', 5);
const PAUSED = row('cred-paused', 'Paused bot', 2, { status: 'disabled' });
const STALE = row('cred-stale', 'Stale grant', 2, { status: 'needs-reauth' });

/** The table as the delete sees it: the own-row read and the pair read. */
function table(rows: ReturnType<typeof row>[]) {
  return (statement: Statement) => {
    if (statement.text.includes('WHERE id = ? AND org_id = ? LIMIT 1')) {
      return rows.filter((r) => r.id === statement.values[1]);
    }
    if (statement.text.includes('WHERE org_id = ? AND connector_slug = ?')) {
      return rows.filter((r) => r.connectorSlug === statement.values[2]);
    }
    if (statement.text.includes('FROM app.connector_credentials WHERE')) {
      return rows;
    }
    return undefined;
  };
}

/** Whom a run's UPDATE made the default, if anyone. */
const promoted = (statements: readonly Statement[]) =>
  statements
    .filter((s) => s.text.includes('SET is_default = true'))
    .map((s) => s.values.at(-1));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ENCRYPTION_SECRET_HEX', 'test-key-material');
});

describe('defaultSuccessor', () => {
  it('hands the default to the oldest active sibling', () => {
    expect(defaultSuccessor([SUPPORT, OPS, RELEASE], SUPPORT.id)).toBe(RELEASE);
  });

  it('never to a disabled credential or a dead grant', () => {
    expect(defaultSuccessor([SUPPORT, PAUSED, STALE, OPS], SUPPORT.id)).toBe(
      OPS,
    );
    expect(defaultSuccessor([SUPPORT, PAUSED, STALE], SUPPORT.id)).toBeNull();
  });

  it('breaks a tie on the creation instant by id, like the listing reads it', () => {
    const b = row('cred-b', 'B', 7);
    const a = row('cred-a', 'A', 7);
    expect(defaultSuccessor([SUPPORT, b, a], SUPPORT.id)).toBe(a);
  });

  it('answers null when the default is the only credential', () => {
    expect(defaultSuccessor([SUPPORT], SUPPORT.id)).toBeNull();
  });
});

describe('the listing names what a delete of the default would do', () => {
  it('names the successor on the default row alone', async () => {
    const other = row('cred-shop', 'Shop', 0, {
      connectorSlug: 'shopify',
      isDefault: true,
    });
    const { sql } = fakeSql(table([SUPPORT, RELEASE, OPS, other]));

    const listed = await listCredentials(sql, 'org-1');

    const byId = new Map(listed.map((c) => [c.id, c]));
    expect(byId.get(SUPPORT.id)?.defaultSuccessor).toEqual({
      id: RELEASE.id,
      name: 'Release bot',
    });
    // Another connector's credentials never take over GitHub's default.
    expect(byId.get('cred-shop')?.defaultSuccessor).toBeNull();
    expect(byId.get(RELEASE.id)).not.toHaveProperty('defaultSuccessor');
  });

  it('says no default would remain when only disabled or dead siblings are left', async () => {
    const { sql } = fakeSql(table([SUPPORT, PAUSED, STALE]));

    const support = (await listCredentials(sql, 'org-1')).find(
      (c) => c.id === SUPPORT.id,
    );

    expect(support?.defaultSuccessor).toBeNull();
  });
});

describe('deleteCredential', () => {
  it('makes exactly the credential the listing named the default', async () => {
    const rows = [SUPPORT, OPS, RELEASE, PAUSED];
    const named = (
      await listCredentials(fakeSql(table(rows)).sql, 'org-1')
    ).find((c) => c.id === SUPPORT.id)?.defaultSuccessor?.id;
    const { sql, statements } = fakeSql(table(rows));

    await deleteCredential(sql, 'org-1', SUPPORT.id);

    expect(named).toBe(RELEASE.id);
    expect(promoted(statements)).toEqual([RELEASE.id]);
  });

  it('decides under the pair lock, from siblings read after it', async () => {
    const { sql, statements } = fakeSql(table([SUPPORT, RELEASE]));

    await deleteCredential(sql, 'org-1', SUPPORT.id);

    const lock = statements.findIndex((s) =>
      s.text.includes('pg_advisory_xact_lock'),
    );
    const pairRead = statements.findIndex((s) =>
      s.text.includes('WHERE org_id = ? AND connector_slug = ?'),
    );
    const removal = statements.findIndex((s) =>
      s.text.startsWith('DELETE FROM app.connector_credentials'),
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(pairRead);
    expect(pairRead).toBeLessThan(removal);
  });

  it('promotes nobody when no active sibling remains', async () => {
    const { sql, statements } = fakeSql(table([SUPPORT, PAUSED]));

    await deleteCredential(sql, 'org-1', SUPPORT.id);

    expect(promoted(statements)).toEqual([]);
  });

  it('leaves the default alone when a non-default credential is deleted', async () => {
    const { sql, statements } = fakeSql(table([SUPPORT, RELEASE, OPS]));

    await deleteCredential(sql, 'org-1', RELEASE.id);

    expect(promoted(statements)).toEqual([]);
  });

  it('refuses a credential another delete removed while it waited for the lock', async () => {
    let reads = 0;
    const { sql, statements } = fakeSql((statement) => {
      if (statement.text.includes('WHERE id = ? AND org_id = ? LIMIT 1')) {
        reads += 1;
        // Found before the lock, gone after it.
        return reads === 1 ? [SUPPORT] : [];
      }
      if (statement.text.includes('WHERE org_id = ? AND connector_slug = ?')) {
        return [RELEASE];
      }
      return undefined;
    });

    await expect(
      deleteCredential(sql, 'org-1', SUPPORT.id),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    expect(
      statements.some((s) =>
        s.text.startsWith('DELETE FROM app.connector_credentials'),
      ),
    ).toBe(false);
  });
});
