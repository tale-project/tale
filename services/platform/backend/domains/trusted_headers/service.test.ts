// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { clampAssertedRole } from '../../../lib/shared/schemas/trusted_headers.ts';
import { hashOpaqueToken } from '../../core/lib/opaque_token.ts';
import {
  createTrustedHeaderKey,
  getTrustedHeadersView,
  resolveTrustedHeaderKey,
  revokeTrustedHeaderKey,
  setTrustedHeaderSettings,
  TRUSTED_HEADER_KEY_MARKER,
  TrustedHeadersError,
} from './service.ts';

/**
 * The credential contract behind the trusted-headers card: a key's
 * plaintext leaves the service exactly once and only its hash lands in the
 * row; the per-organization ceiling is judged before any write; revocation
 * is a stamp; the door's lookup reads the switch and ceiling beside the key
 * and never matches an empty presentation.
 */

interface Captured {
  text: string;
  values: unknown[];
}

/** What `createAuditLog` needs back from an empty chain (genesis head, one
 * inserted row) — every write here audits. */
function auditChainAnswers(text: string): object[] | undefined {
  if (text.startsWith('SELECT last_hash AS "lastHash"')) {
    return [{ lastHash: '', lastTs: 0 }];
  }
  if (text.startsWith('INSERT INTO app.audit_logs')) return [{ id: 'audit-1' }];
  return undefined;
}

function fakeSql(answer: (text: string) => object[] | undefined): {
  sql: Sql;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    return Promise.resolve(auditChainAnswers(text) ?? answer(text) ?? []);
  };
  const begin = async (cb: (tx: unknown) => Promise<unknown>) => cb(tag);
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double (createAuditLog needs tx.json)
    sql: Object.assign(tag, {
      begin,
      json: (value: unknown) => value,
    }) as unknown as Sql,
    queries,
  };
}

const writes = (queries: Captured[]): Captured[] =>
  queries.filter(
    (q) =>
      q.text.startsWith('INSERT INTO app.trusted_header') ||
      q.text.startsWith('UPDATE app.trusted_header'),
  );

const AUDIT_ACTIONS = new Set([
  'trusted_header_key_created',
  'trusted_header_key_revoked',
  'trusted_headers_enabled',
  'trusted_headers_disabled',
  'trusted_headers_policy_updated',
]);

/** The action names the audit rows carry — the resource type
 * (`trusted_headers`, `trusted_header_key`) rides the same INSERT and is
 * deliberately not counted. */
const auditActions = (queries: Captured[]): unknown[] =>
  queries
    .filter((q) => q.text.startsWith('INSERT INTO app.audit_logs'))
    .flatMap((q) => q.values)
    .filter((v) => typeof v === 'string' && AUDIT_ACTIONS.has(v));

const KEY_COUNT = 'SELECT count(*)::text AS count FROM app.trusted_header_keys';
const KEY_INSERT = 'INSERT INTO app.trusted_header_keys';
const KEY_FOR_UPDATE = 'SELECT id, name, token_prefix AS "tokenPrefix"';
const actor = { userId: 'admin-1', email: 'admin@door.test' };

describe('createTrustedHeaderKey — the plaintext leaves once', () => {
  it('answers a marked 64-hex key and stores only its hash and prefix', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith(KEY_COUNT)) return [{ count: '0' }];
      if (text.startsWith(KEY_INSERT)) return [{ id: 'key-1' }];
      return [];
    });

    const created = await createTrustedHeaderKey(sql, {
      organizationId: 'org-1',
      actor,
      name: '  Host proxy  ',
    });

    expect(created.id).toBe('key-1');
    expect(created.key.startsWith(TRUSTED_HEADER_KEY_MARKER)).toBe(true);
    expect(created.key).toHaveLength(TRUSTED_HEADER_KEY_MARKER.length + 64);
    expect(created.tokenPrefix).toBe(
      `${created.key.slice(0, TRUSTED_HEADER_KEY_MARKER.length + 8)}…`,
    );
    const insert = queries.find((q) => q.text.startsWith(KEY_INSERT));
    expect(insert?.values).toContain(await hashOpaqueToken(created.key));
    expect(insert?.values).toContain(created.tokenPrefix);
    expect(insert?.values).toContain('Host proxy');
    expect(insert?.values).not.toContain(created.key);
    expect(auditActions(queries)).toEqual(['trusted_header_key_created']);
  });

  it('refuses the eleventh live key before any write', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith(KEY_COUNT)) return [{ count: '10' }];
      return [];
    });

    await expect(
      createTrustedHeaderKey(sql, {
        organizationId: 'org-1',
        actor,
        name: 'one too many',
      }),
    ).rejects.toMatchObject({
      name: 'TrustedHeadersError',
      code: 'TRUSTED_HEADER_KEY_LIMIT',
      status: 409,
    });
    expect(writes(queries)).toHaveLength(0);
    expect(auditActions(queries)).toEqual([]);
  });
});

describe('revokeTrustedHeaderKey — a stamp, never a delete', () => {
  it('stamps the live row and audits the revocation', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith(KEY_FOR_UPDATE)) {
        return [
          {
            id: 'key-1',
            name: 'Host proxy',
            tokenPrefix: 'thk_1234abcd…',
            revokedAt: null,
          },
        ];
      }
      return [];
    });

    await revokeTrustedHeaderKey(sql, {
      organizationId: 'org-1',
      actor,
      keyId: 'key-1',
    });

    const update = queries.find((q) =>
      q.text.startsWith('UPDATE app.trusted_header_keys SET revoked_at_ms'),
    );
    expect(update).toBeDefined();
    expect(update?.text).not.toContain('DELETE');
    expect(update?.values).toContain('admin-1');
    expect(auditActions(queries)).toEqual(['trusted_header_key_revoked']);
  });

  it('is a no-op on a key already revoked', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith(KEY_FOR_UPDATE)) {
        return [
          {
            id: 'key-1',
            name: 'Host proxy',
            tokenPrefix: 'thk_1234abcd…',
            revokedAt: '1700000000000',
          },
        ];
      }
      return [];
    });

    await revokeTrustedHeaderKey(sql, {
      organizationId: 'org-1',
      actor,
      keyId: 'key-1',
    });

    expect(writes(queries)).toHaveLength(0);
    expect(auditActions(queries)).toEqual([]);
  });

  it("answers not-found for a key that is not this organization's", async () => {
    const { sql, queries } = fakeSql(() => []);

    await expect(
      revokeTrustedHeaderKey(sql, {
        organizationId: 'org-1',
        actor,
        keyId: 'someone-elses-key',
      }),
    ).rejects.toMatchObject({
      code: 'TRUSTED_HEADER_KEY_NOT_FOUND',
      status: 404,
    });
    expect(writes(queries)).toHaveLength(0);
    expect(
      queries.find((q) => q.text.startsWith(KEY_FOR_UPDATE))?.values,
    ).toEqual(['someone-elses-key', 'org-1']);
  });
});

describe('resolveTrustedHeaderKey — the door looks the organization up by hash', () => {
  it('never matches an empty presentation, and runs no query for it', async () => {
    const { sql, queries } = fakeSql(() => []);

    expect(await resolveTrustedHeaderKey(sql, '')).toBeNull();
    expect(await resolveTrustedHeaderKey(sql, '   ')).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it('looks up the hash, never the plaintext, and answers null for a stranger', async () => {
    const { sql, queries } = fakeSql(() => []);

    expect(await resolveTrustedHeaderKey(sql, 'thk_not_a_real_key')).toBeNull();
    const lookup = queries[0];
    expect(lookup?.text).toContain('FROM app.trusted_header_keys k');
    expect(lookup?.text).toContain('k.revoked_at_ms IS NULL');
    expect(lookup?.values).toEqual([
      await hashOpaqueToken('thk_not_a_real_key'),
    ]);
  });

  it('reads the switch and the ceiling beside the key, defaulting a missing settings row to off / member', async () => {
    const { sql } = fakeSql((text) => {
      if (text.startsWith('SELECT k.id AS "keyId"')) {
        return [
          {
            keyId: 'key-1',
            organizationId: 'org-1',
            enabled: null,
            maxAssertedRole: null,
          },
        ];
      }
      return [];
    });

    expect(await resolveTrustedHeaderKey(sql, 'thk_abc')).toEqual({
      keyId: 'key-1',
      organizationId: 'org-1',
      enabled: false,
      maxAssertedRole: 'member',
    });
  });

  it('carries an enabled organization and its ceiling through', async () => {
    const { sql } = fakeSql((text) => {
      if (text.startsWith('SELECT k.id AS "keyId"')) {
        return [
          {
            keyId: 'key-1',
            organizationId: 'org-1',
            enabled: true,
            maxAssertedRole: 'developer',
          },
        ];
      }
      return [];
    });

    expect(await resolveTrustedHeaderKey(sql, 'thk_abc')).toMatchObject({
      enabled: true,
      maxAssertedRole: 'developer',
    });
  });
});

describe('setTrustedHeaderSettings — one audit row, named for the change that matters', () => {
  it('names a switch flip', async () => {
    const { sql, queries } = fakeSql(() => []);

    await setTrustedHeaderSettings(sql, {
      organizationId: 'org-1',
      actor,
      enabled: true,
      maxAssertedRole: 'member',
    });

    expect(auditActions(queries)).toEqual(['trusted_headers_enabled']);
    const upsert = queries.find((q) =>
      q.text.startsWith('INSERT INTO app.trusted_header_settings'),
    );
    expect(upsert?.text).toContain('ON CONFLICT (org_id) DO UPDATE');
    expect(upsert?.values).toEqual(
      expect.arrayContaining(['org-1', true, 'member', 'admin-1']),
    );
  });

  it('names a ceiling move when the switch stays where it was', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (
        text.startsWith('SELECT enabled, max_asserted_role') &&
        text.includes('FOR UPDATE')
      ) {
        return [{ enabled: true, maxAssertedRole: 'member' }];
      }
      return [];
    });

    await setTrustedHeaderSettings(sql, {
      organizationId: 'org-1',
      actor,
      enabled: true,
      maxAssertedRole: 'admin',
    });

    expect(auditActions(queries)).toEqual(['trusted_headers_policy_updated']);
  });
});

describe('getTrustedHeadersView', () => {
  it('reads off / member and no keys for an organization that never touched the card', async () => {
    const { sql } = fakeSql(() => []);

    const view = await getTrustedHeadersView(sql, 'org-1');

    expect(view.enabled).toBe(false);
    expect(view.maxAssertedRole).toBe('member');
    expect(view.keys).toEqual([]);
    expect(view.headers.email).toBe('Remote-Email');
  });
});

describe('clampAssertedRole — the ceiling and the floor', () => {
  it.each([
    ['member', 'admin', 'member'],
    ['admin', 'admin', 'admin'],
    ['Admin ', 'admin', 'admin'],
    ['admin', 'member', 'member'],
    ['developer', 'editor', 'editor'],
    ['editor', 'developer', 'editor'],
    ['owner', 'admin', 'member'],
    ['disabled', 'admin', 'member'],
    ['', 'admin', 'member'],
    [undefined, 'developer', 'member'],
  ] as const)(
    'asserted %j under ceiling %s → %s',
    (requested, ceiling, expected) => {
      expect(clampAssertedRole(requested, ceiling)).toBe(expected);
    },
  );
});

describe('TrustedHeadersError', () => {
  it('carries its code and status for the route to answer', () => {
    const error = new TrustedHeadersError(
      'TRUSTED_HEADER_KEY_NOT_FOUND',
      'why',
      404,
    );
    expect(error.name).toBe('TrustedHeadersError');
    expect(error.message).toBe('why');
    expect(error.status).toBe(404);
  });
});
