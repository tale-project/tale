// @vitest-environment node

/**
 * An agent secret as a managed declaration reads and writes it: the
 * readback carries the secret's name and a digest of its stored value —
 * never the value — and the write replaces the value on the hash its plan
 * read, through the app's own save (its trimming, cap and audit row).
 */

import {
  agentSecretDigestScope,
  managedSecretDigest,
} from '@tale/shared/config/managed-secret';
import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';

vi.mock('../../core/lib/secret_box.ts', () => ({
  encryptSecret: vi.fn((value: string) => ({ sealed: value })),
  decryptSecret: vi.fn((envelope: { sealed: string }) => envelope.sealed),
}));
const { createAuditLog } = vi.hoisted(() => ({
  createAuditLog: vi.fn(() => Promise.resolve('audit-1')),
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(() => Promise.resolve()),
}));

const { readManagedAgentSecret, writeManagedAgentSecret } =
  await import('./managed.ts');

const VALUE = 'ghp_stored-secret-value-0001';

/** An organization holding one secret, recording what it is sent. */
function database(stored: { name: string; value: string } | null) {
  const statements: { text: string; values: unknown[] }[] = [];
  const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('encrypted_value AS "encryptedValue"'))
      return Promise.resolve(
        stored === null
          ? []
          : [{ name: stored.name, encryptedValue: { sealed: stored.value } }],
      );
    if (text.startsWith('SELECT description'))
      return Promise.resolve(
        stored === null ? [] : [{ description: 'Kept by a person' }],
      );
    if (text.startsWith('SELECT count(*)'))
      return Promise.resolve([{ count: '0' }]);
    if (text.startsWith('INSERT INTO app.agent_secrets'))
      return Promise.resolve([{ created: stored === null }]);
    return Promise.resolve([]);
  };
  Object.assign(query, {
    json: (value: unknown) => value,
    begin: (work: (tx: unknown) => Promise<unknown>) => work(query),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: query as unknown as Sql, statements };
}

const digest = (value: string) =>
  managedSecretDigest({
    organizationId: 'org-1',
    scope: agentSecretDigestScope('GITHUB_TOKEN'),
    value,
  });

afterEach(() => {
  vi.clearAllMocks();
});

describe('a declared secret is read back as a digest of its value, never the value [ASEC-R5]', () => {
  it('answers the name and the digest of the stored value', async () => {
    const { sql } = database({ name: 'GITHUB_TOKEN', value: VALUE });
    const read = await readManagedAgentSecret(sql, 'org-1', 'GITHUB_TOKEN');
    expect(read.config).toEqual({
      name: 'GITHUB_TOKEN',
      valueDigest: digest(VALUE),
    });
    expect(JSON.stringify(read)).not.toContain(VALUE);
    // A value replaced in Tale reads differently.
    const replaced = await readManagedAgentSecret(
      database({ name: 'GITHUB_TOKEN', value: 'typed-in-tale' }).sql,
      'org-1',
      'GITHUB_TOKEN',
    );
    expect(replaced.hash).not.toBe(read.hash);
  });

  it('reads a name the organization lacks as absent only when the declaration may create it', async () => {
    await expect(
      readManagedAgentSecret(database(null).sql, 'org-1', 'GITHUB_TOKEN', true),
    ).resolves.toEqual({ config: null, hash: null });
    await expect(
      readManagedAgentSecret(database(null).sql, 'org-1', 'GITHUB_TOKEN'),
    ).rejects.toMatchObject({ code: 'AGENT_SECRET_NOT_FOUND' });
  });

  it('replaces the value on the hash its plan read, keeping the description and auditing the name alone', async () => {
    const { sql, statements } = database({
      name: 'GITHUB_TOKEN',
      value: VALUE,
    });
    await writeManagedAgentSecret(sql, {
      organizationId: 'org-1',
      actorId: 'ada',
      name: 'GITHUB_TOKEN',
      value: '  ghp_rotated-value-0002\n',
      expectedHash: managedConfigurationHash({
        name: 'GITHUB_TOKEN',
        valueDigest: digest(VALUE),
      }),
    });
    const upsert = statements.find(({ text }) =>
      text.startsWith('INSERT INTO app.agent_secrets'),
    );
    expect(upsert?.values).toContain('Kept by a person');
    expect(upsert?.values).toContainEqual({ sealed: 'ghp_rotated-value-0002' });
    expect(JSON.stringify(createAuditLog.mock.calls)).not.toContain(
      'ghp_rotated',
    );
  });

  it('writes nothing over a hash its plan did not read, or a secret it may not create', async () => {
    const stale = database({ name: 'GITHUB_TOKEN', value: 'typed-in-tale' });
    await expect(
      writeManagedAgentSecret(stale.sql, {
        organizationId: 'org-1',
        actorId: 'ada',
        name: 'GITHUB_TOKEN',
        value: VALUE,
        expectedHash: managedConfigurationHash({
          name: 'GITHUB_TOKEN',
          valueDigest: digest(VALUE),
        }),
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    const absent = database(null);
    await expect(
      writeManagedAgentSecret(absent.sql, {
        organizationId: 'org-1',
        actorId: 'ada',
        name: 'GITHUB_TOKEN',
        value: VALUE,
        expectedHash: null,
      }),
    ).rejects.toMatchObject({ code: 'AGENT_SECRET_NOT_FOUND' });
    for (const { statements } of [stale, absent])
      expect(
        statements.filter(({ text }) => text.startsWith('INSERT')),
      ).toEqual([]);
  });
});
