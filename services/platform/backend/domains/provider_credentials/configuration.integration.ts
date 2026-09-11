/** Real PostgreSQL transactions; mounted by backend/integration-check.ts.
 * Only synthetic env references are stored. Native HTTP auth is covered by
 * the neighboring provider credential lane, not replaced by these scopes. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import {
  createCredential,
  listCredentials,
  updateCredential,
  type CredentialScope,
} from './service.ts';

function errorCode(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string'
  )
    return error.code;
  return undefined;
}

/** Force both first attempts to observe the same real database snapshot.
 * Retried native transactions must take a fresh snapshot without rejoining
 * this gate; no sleep guesses whether concurrent work actually started. */
async function compete<T>(
  sql: Sql,
  scope: CredentialScope,
  provider: string,
  work: ((tx: TransactionSql) => Promise<T>)[],
) {
  const gate = Promise.withResolvers<void>();
  const attempts = work.map(() => 0);
  let arrived = 0;
  const timeout = setTimeout(
    () => gate.reject(new Error('Credential transaction gate timed out')),
    10_000,
  );
  try {
    const outcomes = await Promise.allSettled(
      work.map((job, index) =>
        transactSerializable(sql, async (tx) => {
          attempts[index] += 1;
          if (attempts[index] === 1) {
            await tx`SELECT id FROM app.provider_credentials WHERE org_id = ${scope.organizationId} AND provider_slug = ${provider}`;
            if (++arrived === work.length) gate.resolve();
            await gate.promise;
          }
          return job(tx);
        }),
      ),
    );
    return { outcomes, attempts };
  } finally {
    clearTimeout(timeout);
  }
}

function oneWinner<T>(
  outcomes: PromiseSettledResult<T>[],
  rejectedCode: string,
): T {
  const successes = outcomes.filter(
    (outcome) => outcome.status === 'fulfilled',
  );
  const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(errorCode(failures[0]?.reason), rejectedCode);
  assert.ok(successes[0]);
  return successes[0].value;
}

export async function checkProviderCredentialConfiguration(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const scope: CredentialScope = {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    role: 'owner',
  };
  const suffix = randomUUID();
  const provider = `config-${suffix}`;
  const args = (name: string, selectedProvider = provider) => ({
    providerSlug: selectedProvider,
    authMethod: 'env' as const,
    name,
    envName: 'TALE_PROVIDER_KEY_CONFIGURATION_TEST',
    status: 'active' as const,
    isDefault: false,
  });
  const create = (name: string) =>
    transactSerializable(sql, (tx) =>
      createCredential(tx, scope, args(name), null),
    );
  const list = () => listCredentials(sql, scope, provider);
  const auditCount = async () =>
    Number(
      (
        await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.audit_logs WHERE org_id = ${scope.organizationId}
  `
      )[0]?.count,
    );

  const disabled = await transactSerializable(sql, (tx) =>
    createCredential(
      tx,
      scope,
      { ...args('Disabled'), status: 'disabled' },
      null,
    ),
  );
  assert.deepEqual(
    (await list()).map(({ id, status, isDefault }) => ({
      id,
      status,
      isDefault,
    })),
    [{ id: disabled, status: 'disabled', isDefault: false }],
  );
  record(
    'configuration credentials: disabled creation is never default',
    true,
    'actual persisted row is disabled/nondefault',
  );

  const duplicate = await compete(sql, scope, provider, [
    (tx) => createCredential(tx, scope, args('Same name'), null),
    (tx) => createCredential(tx, scope, args('Same name'), null),
  ]);
  const duplicateId = oneWinner(duplicate.outcomes, 'CONFIG_VERSION_CONFLICT');
  assert.equal(
    (await list()).filter(({ name }) => name === 'Same name').length,
    1,
  );
  assert.equal(
    (await list()).find(({ name }) => name === 'Same name')?.id,
    duplicateId,
  );
  record(
    'configuration credentials: concurrent absence CAS',
    true,
    `one row, one coded conflict; transaction attempts=${duplicate.attempts.join(',')}`,
  );

  const firstProvider = `first-${suffix}`;
  const firstDefaults = await compete(sql, scope, firstProvider, [
    (tx) =>
      createCredential(
        tx,
        scope,
        { ...args('First A', firstProvider), isDefault: true },
        null,
      ),
    (tx) =>
      createCredential(
        tx,
        scope,
        { ...args('First B', firstProvider), isDefault: true },
        null,
      ),
  ]);
  oneWinner(firstDefaults.outcomes, 'CREDENTIAL_DEFAULT_CONFLICT');
  assert.equal(
    (await listCredentials(sql, scope, firstProvider)).filter(
      ({ isDefault }) => isDefault,
    ).length,
    1,
  );
  record(
    'configuration credentials: concurrent first default',
    true,
    `one default, no implicit takeover; transaction attempts=${firstDefaults.attempts.join(',')}`,
  );

  const oldId = await transactSerializable(sql, (tx) =>
    createCredential(
      tx,
      scope,
      { ...args('Old default'), isDefault: true },
      null,
    ),
  );
  const candidateA = await create('Candidate A');
  const candidateB = await create('Candidate B');
  const before = await list();
  const old = before.find(({ id }) => id === oldId);
  const a = before.find(({ id }) => id === candidateA);
  const b = before.find(({ id }) => id === candidateB);
  assert.ok(old && a && b);
  const auditBefore = await auditCount();
  await assert.rejects(
    transactSerializable(sql, (tx) =>
      updateCredential(tx, scope, a.id, { isDefault: true }, a.hash),
    ),
    (error: unknown) => errorCode(error) === 'CREDENTIAL_DEFAULT_CONFLICT',
  );
  await assert.rejects(
    transactSerializable(sql, (tx) =>
      createCredential(
        tx,
        scope,
        { ...args('Undeclared takeover'), isDefault: true },
        null,
      ),
    ),
    (error: unknown) => errorCode(error) === 'CREDENTIAL_DEFAULT_CONFLICT',
  );
  assert.deepEqual(await list(), before);
  assert.equal(await auditCount(), auditBefore);
  record(
    'configuration credentials: existing default takeover refuses atomically',
    true,
    'failed guarded create/update alter neither rows nor audit chain',
  );

  await transactSerializable(sql, (tx) =>
    updateCredential(tx, scope, old.id, { isDefault: false }, old.hash),
  );
  const handover = await compete(sql, scope, provider, [
    (tx) => updateCredential(tx, scope, a.id, { isDefault: true }, a.hash),
    (tx) => updateCredential(tx, scope, b.id, { isDefault: true }, b.hash),
  ]);
  oneWinner(handover.outcomes, 'CREDENTIAL_DEFAULT_CONFLICT');
  const after = await list();
  assert.equal(after.filter(({ isDefault }) => isDefault).length, 1);
  assert.equal(after.find(({ id }) => id === old.id)?.isDefault, false);
  assert.deepEqual(
    after.map(({ id }) => id).sort(),
    before.map(({ id }) => id).sort(),
  );
  await assert.rejects(
    transactSerializable(sql, (tx) =>
      updateCredential(tx, scope, old.id, { isDefault: true }, old.hash),
    ),
    (error: unknown) => errorCode(error) === 'CONFIG_VERSION_CONFLICT',
  );
  record(
    'configuration credentials: explicit default handover preserves identities',
    true,
    `old default cleared, one selected candidate; transaction attempts=${handover.attempts.join(',')}`,
  );

  const current = after.find(({ id }) => id === a.id);
  assert.ok(current);
  const edits = await compete(sql, scope, provider, [
    (tx) =>
      updateCredential(
        tx,
        scope,
        current.id,
        { envName: 'TALE_PROVIDER_KEY_CONFIGURATION_A' },
        current.hash,
      ),
    (tx) =>
      updateCredential(
        tx,
        scope,
        current.id,
        { envName: 'TALE_PROVIDER_KEY_CONFIGURATION_B' },
        current.hash,
      ),
  ]);
  oneWinner(edits.outcomes, 'CONFIG_VERSION_CONFLICT');
  const updated = (await list()).find(({ id }) => id === a.id);
  assert.ok(updated);
  assert.equal(updated.authMethod, 'env');
  assert.equal(updated.providerSlug, provider);
  assert.notEqual(updated.hash, current.hash);
  assert.ok(
    [
      'TALE_PROVIDER_KEY_CONFIGURATION_A',
      'TALE_PROVIDER_KEY_CONFIGURATION_B',
    ].includes(updated.envName ?? ''),
  );
  record(
    'configuration credentials: concurrent metadata CAS',
    true,
    `one reviewed update, one stale refusal; transaction attempts=${edits.attempts.join(',')}`,
  );

  const other: CredentialScope = {
    ...scope,
    organizationId: `configuration-isolation-${suffix}`,
  };
  const otherId = await transactSerializable(sql, (tx) =>
    createCredential(tx, other, args('Candidate A'), null),
  );
  assert.equal(
    (await list()).some(({ id }) => id === otherId),
    false,
  );
  assert.deepEqual(
    (await listCredentials(sql, other, provider)).map(({ id }) => id),
    [otherId],
  );
  await assert.rejects(
    transactSerializable(sql, (tx) =>
      updateCredential(
        tx,
        other,
        updated.id,
        { status: 'disabled' },
        updated.hash,
      ),
    ),
    (error: unknown) => errorCode(error) === 'CREDENTIAL_NOT_FOUND',
  );
  assert.deepEqual(
    (await list()).find(({ id }) => id === updated.id),
    updated,
  );
  assert.equal(Object.hasOwn(updated, 'encryptedData'), false);
  assert.equal(Object.hasOwn(updated, 'secret'), false);
  record(
    'configuration credentials: scoped read/update and safe metadata',
    true,
    'same provider/name in another org stays independent; foreign ID write refused',
  );
}
