/** Real broker HTTP -> resolver -> durable Postgres selection. No vendor
 * credentials, external inference, sleeps or probabilistic balance claims. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import { credentialRetryAtMs } from '../../core/provider_credentials/resolve_credential.ts';
import { hashBrokerAccount } from '../../core/provider_credentials/token_hash.ts';
import { createSql } from '../../db/sql.ts';
import {
  recordBrokerFailure,
  selectBrokerAccount,
} from './broker-selection.ts';
import {
  createCredential,
  listCredentials,
  resolveProviderCredential,
} from './service.ts';

export async function checkBrokerAccountSelection(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  let pool = ['a', 'b', 'c'].map((id) => ({
    id,
    provider: 'openai',
    account_id: `vendor-${id}`,
    access_token: `synthetic-${id}`,
    status: 'active',
    available: true,
  }));
  /** A second pool: an account the broker counts as available beside one
   * it holds back for its coming token refresh (TALE-101). */
  let heldPool: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url?.endsWith('/held') === true) {
      res.end(JSON.stringify({ tokens: heldPool }));
      return;
    }
    // Reordering is harmless: round-robin tracks account identity, not index.
    pool = [...pool.slice(1), ...pool.slice(0, 1)];
    res.end(JSON.stringify({ tokens: pool }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const oldPrivatePolicy = process.env.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS;
  process.env.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS = '1';
  const scope = {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    role: 'owner',
  };
  const anotherPool = createSql(process.env.DATABASE_URL ?? '');
  try {
    const credentialId = await transactSerializable(sql, (tx) =>
      createCredential(tx, scope, {
        providerSlug: 'openai',
        authMethod: 'subscription-broker',
        name: `Broker proof ${randomUUID()}`,
        isDefault: false,
        secret: JSON.stringify({
          endpoint: `http://127.0.0.1:${address.port}/api/tokens/openai`,
          httpMethod: 'GET',
          auth: { method: 'none' },
          responseMapping: {
            tokensPath: '$.tokens',
            tokenField: 'access_token',
            statusField: 'status',
            activeValue: 'active',
          },
          targetEnvVar: 'TALE_SUBSCRIPTION_TOKEN',
          selection: 'round-robin',
        }),
      }),
    );
    const args = {
      organizationId: ctx.orgId,
      providerSlug: 'openai',
      credentialId,
    };
    const before = (await listCredentials(sql, scope, 'openai')).find(
      (row) => row.id === credentialId,
    );
    const picks: string[] = [];
    for (let i = 0; i < 12; i++) {
      const resolved = await resolveProviderCredential(
        i % 2 ? anotherPool : sql,
        args,
      );
      assert.equal(resolved.authMethod, 'subscription-broker');
      if (resolved.authMethod !== 'subscription-broker')
        throw new Error('Unexpected auth method');
      assert.ok(resolved.accountId);
      picks.push(resolved.accountId);
    }
    for (let i = 0; i < 12; i += 3)
      assert.equal(new Set(picks.slice(i, i + 3)).size, 3);
    record(
      'broker: sequential rotation survives reordered HTTP pools and separate clients',
      true,
      '12 selections; all 3 accounts used once per cycle',
    );

    const concurrent = await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        resolveProviderCredential(i % 2 ? anotherPool : sql, args),
      ),
    );
    const counts = new Map<string, number>();
    for (const resolved of concurrent) {
      assert.equal(resolved.authMethod, 'subscription-broker');
      if (resolved.authMethod !== 'subscription-broker')
        throw new Error('Unexpected auth method');
      counts.set(resolved.token, (counts.get(resolved.token) ?? 0) + 1);
    }
    assert.deepEqual([...counts.values()], [8, 8, 8]);
    record(
      'broker: concurrent workers balance exactly across three accounts',
      true,
      '24 concurrent HTTP resolutions, 8 selections per account',
    );

    const first = pool[0];
    assert.ok(first);
    const firstHash = hashBrokerAccount(credentialId, {
      id: first.id,
      token: first.access_token,
    });
    first.access_token = 'synthetic-refreshed';
    const refreshed = await resolveProviderCredential(sql, {
      ...args,
      excludeBrokerTokenHashes: [firstHash],
    });
    assert.ok(
      refreshed.authMethod === 'subscription-broker' &&
        refreshed.token !== 'synthetic-refreshed',
    );
    record(
      'broker: retry exclusion survives token refresh',
      true,
      'the same gateway id retains its hash after access token changes',
    );

    const now = Date.now();
    await recordBrokerFailure(
      sql,
      {
        organizationId: 'different-organization',
        brokerTokenHash: firstHash,
        apiErrorStatus: 429,
      },
      now,
    );
    const statesBefore = await sql<
      { until: number }[]
    >`SELECT cooldown_until_ms::float8 AS until FROM app.provider_broker_accounts WHERE org_id = ${ctx.orgId} AND account_hash = ${firstHash}`;
    assert.equal(statesBefore[0]?.until, 0);
    await recordBrokerFailure(
      sql,
      {
        organizationId: ctx.orgId,
        brokerTokenHash: firstHash,
        apiErrorStatus: 429,
      },
      now,
    );
    const candidates = pool.map((account) => ({
      hash: hashBrokerAccount(credentialId, {
        id: account.id,
        token: account.access_token,
      }),
      excluded: true,
    }));
    const chosen = await selectBrokerAccount(
      anotherPool,
      { ...args, selection: 'first', candidates },
      now,
    );
    assert.notEqual(chosen.hash, firstHash);
    assert.equal(chosen.fellBack, true);
    record(
      'broker: tenant-scoped cooldown is shared and never bypassed by retry fallback',
      true,
      'another tenant cannot cool the account; another client sees the correct tenant cooldown',
    );

    for (const candidate of candidates)
      await recordBrokerFailure(
        sql,
        {
          organizationId: ctx.orgId,
          brokerTokenHash: candidate.hash,
          apiErrorStatus: 429,
        },
        now,
      );
    const blocked = await selectBrokerAccount(
      sql,
      { ...args, selection: 'random', candidates },
      now,
    );
    assert.equal(blocked.hash, null);
    assert.equal(blocked.retryAtMs, now + 60_000);
    await assert.rejects(
      resolveProviderCredential(sql, {
        ...args,
        excludeBrokerTokenHashes: candidates.map((candidate) => candidate.hash),
      }),
      /cooling down/,
    );
    const recovered = await selectBrokerAccount(
      sql,
      { ...args, selection: 'round-robin', candidates },
      now + 60_000,
    );
    assert.ok(recovered.hash);
    record(
      'broker: exhausted cooldown refuses selection and reopens exactly at its deadline',
      true,
      'no advisory fallback can select a cooling account',
    );

    await assert.rejects(
      selectBrokerAccount(
        sql,
        {
          ...args,
          organizationId: 'different-organization',
          selection: 'first',
          candidates,
        },
        now,
      ),
      /no longer active/,
    );
    const after = (await listCredentials(sql, scope, 'openai')).find(
      (row) => row.id === credentialId,
    );
    assert.equal(after?.updatedAt, before?.updatedAt);
    assert.equal(after?.maskedPreview, null);
    record(
      'broker: runtime state preserves credential metadata and tenant boundaries',
      true,
      'selections do not edit configuration timestamps or expose secrets',
    );

    const control = {
      organizationId: ctx.orgId,
      credentialId,
      candidates: candidates.map((candidate) => ({
        ...candidate,
        excluded: false,
      })),
    };
    assert.equal(
      (
        await selectBrokerAccount(
          sql,
          { ...control, selection: 'first' },
          now + 60_001,
        )
      ).hash,
      candidates[0]?.hash,
    );
    assert.equal(
      (
        await selectBrokerAccount(
          sql,
          { ...control, selection: 'random' },
          now + 60_001,
          () => 0.999,
        )
      ).hash,
      candidates[2]?.hash,
    );
    record(
      'broker: first and random keep their documented selection semantics',
      true,
      'deterministic random source checks endpoint buckets',
    );

    // A two-account pool: the broker counts A as able to take the work and
    // holds B back for its coming refresh, knowing nothing of this
    // platform's cooldown or of OpenAI's account-id rule.
    const heldCredentialId = await transactSerializable(sql, (tx) =>
      createCredential(tx, scope, {
        providerSlug: 'openai',
        authMethod: 'subscription-broker',
        name: `Broker hold proof ${randomUUID()}`,
        isDefault: false,
        secret: JSON.stringify({
          endpoint: `http://127.0.0.1:${address.port}/api/tokens/held`,
          httpMethod: 'GET',
          auth: { method: 'none' },
          responseMapping: {
            tokensPath: '$.tokens',
            tokenField: 'access_token',
            statusField: 'status',
            activeValue: 'active',
          },
          targetEnvVar: 'TALE_SUBSCRIPTION_TOKEN',
          selection: 'round-robin',
        }),
      }),
    );
    const heldArgs = {
      organizationId: ctx.orgId,
      providerSlug: 'openai',
      credentialId: heldCredentialId,
    };
    const accountA = {
      id: 'held-proof-a',
      provider: 'openai',
      account_id: 'vendor-held-a',
      access_token: 'synthetic-held-a',
      status: 'active',
      available: true,
      available_at: null,
      hold: null,
    };
    const accountB = {
      id: 'held-proof-b',
      provider: 'openai',
      account_id: 'vendor-held-b',
      access_token: 'synthetic-held-b',
      status: 'active',
      available: false,
      available_at: new Date(Date.now() + 40 * 60_000).toISOString(),
      hold: 'refresh',
    };
    const vendorOf = async (
      resolving: ReturnType<typeof resolveProviderCredential>,
    ): Promise<string | undefined> => {
      const resolved = await resolving;
      return resolved.authMethod === 'subscription-broker'
        ? resolved.accountId
        : undefined;
    };
    heldPool = [accountA, accountB];
    const beforeCooldown = await vendorOf(
      resolveProviderCredential(sql, heldArgs),
    );
    const hashA = hashBrokerAccount(heldCredentialId, {
      id: accountA.id,
      token: accountA.access_token,
    });
    await recordBrokerFailure(sql, {
      organizationId: ctx.orgId,
      brokerTokenHash: hashA,
      apiErrorStatus: 429,
    });
    const whileCooling = await vendorOf(
      resolveProviderCredential(anotherPool, {
        ...heldArgs,
        excludeBrokerTokenHashes: [hashA],
      }),
    );
    // No vendor account id on the available account: only B can serve.
    heldPool = [
      {
        ...accountA,
        id: 'held-proof-c',
        account_id: null,
        access_token: 'synthetic-held-c',
      },
      accountB,
    ];
    const withoutAccountId = await vendorOf(
      resolveProviderCredential(sql, heldArgs),
    );
    record(
      'broker: an account held for its refresh serves when the available one cools down or lacks its vendor account id',
      beforeCooldown === 'vendor-held-a' &&
        whileCooling === 'vendor-held-b' &&
        withoutAccountId === 'vendor-held-b',
      `before cooldown=${beforeCooldown} (want vendor-held-a), A cooling=${whileCooling} (want vendor-held-b), A without account id=${withoutAccountId} (want vendor-held-b)`,
    );

    heldPool = [accountA, accountB];
    const cooledAt = Date.now();
    await recordBrokerFailure(
      sql,
      {
        organizationId: ctx.orgId,
        brokerTokenHash: hashBrokerAccount(heldCredentialId, {
          id: accountB.id,
          token: accountB.access_token,
        }),
        apiErrorStatus: 429,
      },
      cooledAt,
    );
    const refusal = await resolveProviderCredential(sql, heldArgs).then(
      () => undefined,
      (error: unknown) => error,
    );
    const retryAtMs = credentialRetryAtMs(refusal);
    // A cooled first, so it is the first back: the retry can wait for it.
    const cooldowns = await sql<{ until: number }[]>`
      SELECT cooldown_until_ms::float8 AS until FROM app.provider_broker_accounts
      WHERE org_id = ${ctx.orgId} AND credential_id = ${heldCredentialId}
        AND account_hash = ${hashA}
    `;
    record(
      'broker: a pool whose every account cools down refuses with the moment the first comes back',
      retryAtMs !== undefined &&
        retryAtMs === cooldowns[0]?.until &&
        retryAtMs <= cooledAt + 60_000,
      `retryAtMs=${retryAtMs} (want A's cooldown end ${cooldowns[0]?.until}, at most ${cooledAt + 60_000})`,
    );
  } finally {
    if (oldPrivatePolicy === undefined)
      delete process.env.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS;
    else process.env.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS = oldPrivatePolicy;
    await anotherPool.end();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
