/** Real PostgreSQL, the real HTTP doors and real definition files; mounted by
 * backend/integration-check.ts. The provider under test names `.invalid`
 * hosts and lists its models by hand, and its credentials are synthetic env
 * references: no provider or model endpoint is ever called. */
import { chmod } from 'node:fs/promises';

import { providerDefinitionSchema } from '@tale/shared/schemas/providers';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { resolveProvidersDir } from '../../core/lib/providers/org_providers.ts';
import {
  type RecordCheck,
  recordSkip,
} from '../../integration-lane-helpers.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { updateCredentialWithDefinition } from './custom-provider-edit.ts';

const definitionSnapshot = z.object({
  config: z
    .object({ displayName: z.string(), baseUrl: z.string() })
    .loose()
    .nullable(),
  hash: z.string().nullable(),
});
const credentialList = z.object({
  credentials: z.array(
    z
      .object({
        id: z.string(),
        name: z.string(),
        providerSlug: z.string(),
        hash: z.string(),
      })
      .loose(),
  ),
});
const refusal = z.object({ error: z.string() }).loose();

/**
 * The edit dialog's one Save for a custom provider's credential, end to end:
 * a successful edit lands both parts; a refused name (#3662), a definition
 * saved since (#3663) or a credential edited since writes neither; and a
 * definition file that cannot be written takes back the credential row the
 * same transaction had already updated. Every outcome is read back through
 * the doors a reloaded page reads.
 */
export async function checkCustomProviderCredentialEdit(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  record: RecordCheck,
): Promise<void> {
  const send = (
    method: 'GET' | 'PUT' | 'POST',
    route: string,
    body?: unknown,
  ): Promise<Response> =>
    fetch(`${base}/api/app${route}?orgId=${ctx.orgId}`, {
      method,
      headers: {
        'content-type': 'application/json',
        cookie: ctx.cookie,
        origin: base,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const outcome = async (response: Response) => {
    const body = refusal.safeParse(await response.json().catch(() => null));
    return `${response.status}${body.success ? ` ${body.data.error}` : ''}`;
  };
  const slug = `itest-gateway-${Date.now() % 100_000}`;
  const url = (version: number) =>
    `https://models-v${version}.itest-gateway.invalid/v1`;
  const config = (displayName: string, version: number) => ({
    name: slug,
    displayName,
    apiFormat: 'openai',
    baseUrl: url(version),
    catalog: { source: 'none' },
    auth: [{ method: 'api-key' }, { method: 'env' }],
  });
  const definition = async () =>
    definitionSnapshot.parse(
      await (await send('GET', `/providers/definitions/${slug}`)).json(),
    );
  const credential = async (id: string) =>
    credentialList
      .parse(await (await send('GET', '/provider-credentials')).json())
      .credentials.find((row) => row.id === id);
  const edit = (id: string, body: Record<string, unknown>) =>
    send('POST', `/provider-credentials/${id}/with-definition`, body);
  const audits = async (action: string) =>
    Number(
      (
        await sql<{ count: string }[]>`
          SELECT count(*)::text AS count FROM app.audit_logs
          WHERE org_id = ${ctx.orgId} AND action = ${action}
            AND (resource_id = ${slug} OR resource_name LIKE 'Gateway%')
        `
      )[0]?.count ?? '0',
    );

  // The provider at v1 and two env-reference credentials, as the dialog's
  // create flow leaves them.
  const seeded = await send('PUT', `/providers/definitions/${slug}`, {
    config: config('Gateway A', 1),
    expectedHash: null,
  });
  const ids: string[] = [];
  for (const [name, envName] of [
    ['Gateway A', 'TALE_PROVIDER_KEY_ITEST_GATEWAY_A'],
    ['Gateway B', 'TALE_PROVIDER_KEY_ITEST_GATEWAY_B'],
  ] as const) {
    const created = z.object({ credentialId: z.string() }).safeParse(
      await (
        await send('POST', '/provider-credentials', {
          providerSlug: slug,
          authMethod: 'env',
          name,
          envName,
          modelAllowlist: ['gateway-model'],
        })
      ).json(),
    );
    ids.push(created.success ? created.data.credentialId : '');
  }
  const [a = '', b = ''] = ids;
  const v1 = await definition();
  const a1 = await credential(a);
  const savedBefore = await audits('provider_definition.saved');

  // 1. A successful edit lands both parts.
  const saved = await edit(a, {
    name: 'Gateway A2',
    modelAllowlist: ['gateway-model', 'gateway-model-2'],
    expectedHash: a1?.hash,
    definition: {
      config: config('Gateway A2', 2),
      expectedHash: v1.hash,
    },
  });
  const v2 = await definition();
  const a2 = await credential(a);
  record(
    'custom provider edit: the credential and its provider save together',
    seeded.ok &&
      a !== '' &&
      b !== '' &&
      saved.status === 200 &&
      v2.config?.baseUrl === url(2) &&
      v2.config.displayName === 'Gateway A2' &&
      a2?.name === 'Gateway A2' &&
      (await audits('provider_definition.saved')) === savedBefore + 1,
    `save → ${saved.status} (want 200); readback baseUrl=${v2.config?.baseUrl}, displayName=${v2.config?.displayName}, credential=${a2?.name}`,
  );

  // 2. #3662 — a name the sibling carries refuses the credential, and the
  // provider keeps its URL and name.
  const taken = await edit(a, {
    name: 'Gateway B',
    modelAllowlist: ['gateway-model'],
    expectedHash: a2?.hash,
    definition: {
      config: config('Gateway B', 3),
      expectedHash: v2.hash,
    },
  });
  const takenOutcome = await outcome(taken);
  const afterTaken = await definition();
  const aAfterTaken = await credential(a);
  record(
    'custom provider edit: a refused credential name leaves the provider as it was',
    takenOutcome === '409 CREDENTIAL_NAME_TAKEN' &&
      afterTaken.hash === v2.hash &&
      afterTaken.config?.baseUrl === url(2) &&
      aAfterTaken?.hash === a2?.hash,
    `rename onto a sibling → ${takenOutcome} (want 409 CREDENTIAL_NAME_TAKEN); readback baseUrl=${afterTaken.config?.baseUrl} (want ${url(2)}), definition unchanged=${afterTaken.hash === v2.hash}, credential unchanged=${aAfterTaken?.hash === a2?.hash}`,
  );

  // 3. #3663 — another administrator moves the provider to v4 through the
  // native door; the dialog that read v2 saves a rename only.
  const newer = await send('PUT', `/providers/definitions/${slug}`, {
    config: config('Gateway A2', 4),
    expectedHash: v2.hash,
  });
  const v4 = await definition();
  const stale = await edit(a, {
    name: 'Gateway A3',
    modelAllowlist: ['gateway-model'],
    expectedHash: a2?.hash,
    definition: {
      config: config('Gateway A3', 2),
      expectedHash: v2.hash,
    },
  });
  const staleOutcome = await outcome(stale);
  const afterStale = await definition();
  const aAfterStale = await credential(a);
  record(
    'custom provider edit: an editor older than the provider is refused, not saved over it',
    newer.ok &&
      staleOutcome === '409 CONFIG_VERSION_CONFLICT' &&
      afterStale.hash === v4.hash &&
      afterStale.config?.baseUrl === url(4) &&
      aAfterStale?.name === 'Gateway A2',
    `native save of v4 → ${newer.status}; older editor's rename → ${staleOutcome} (want 409 CONFIG_VERSION_CONFLICT); readback baseUrl=${afterStale.config?.baseUrl} (want ${url(4)}), credential=${aAfterStale?.name} (want Gateway A2)`,
  );

  // 4. The credential's own version: renamed elsewhere since the dialog read it.
  const renamed = await send('POST', `/provider-credentials/${a}`, {
    name: 'Gateway A elsewhere',
  });
  const staleCredential = await edit(a, {
    name: 'Gateway A4',
    modelAllowlist: ['gateway-model'],
    expectedHash: a2?.hash,
    definition: {
      config: config('Gateway A4', 5),
      expectedHash: v4.hash,
    },
  });
  const staleCredentialOutcome = await outcome(staleCredential);
  const afterStaleCredential = await definition();
  const aElsewhere = await credential(a);
  record(
    'custom provider edit: an editor older than the credential is refused, not saved over it',
    renamed.ok &&
      staleCredentialOutcome === '409 CONFIG_VERSION_CONFLICT' &&
      afterStaleCredential.hash === v4.hash &&
      aElsewhere?.name === 'Gateway A elsewhere',
    `rename elsewhere → ${renamed.status}; older editor → ${staleCredentialOutcome} (want 409 CONFIG_VERSION_CONFLICT); readback definition unchanged=${afterStaleCredential.hash === v4.hash}, credential=${aElsewhere?.name}`,
  );

  const orgSlug = await resolveOrgSlug(sql, ctx.orgId);
  if (orgSlug === null) throw new Error('integration organization missing');
  // PostgreSQL can commit before its acknowledgement is lost. Inject the
  // failure at that exact boundary, after the real transaction commits;
  // an error reaching the caller is not proof the database rolled back.
  let loseAcknowledgement = true;
  const lostAcknowledgementSql = new Proxy(sql, {
    get(target, property, receiver) {
      if (property !== 'begin') return Reflect.get(target, property, receiver);
      return async (work: (tx: TransactionSql) => Promise<unknown>) => {
        const result = await sql.begin(work);
        if (loseAcknowledgement) {
          loseAcknowledgement = false;
          throw new Error('integration: COMMIT acknowledgement lost');
        }
        return result;
      };
    },
  });
  let lostAcknowledgement = false;
  try {
    await updateCredentialWithDefinition(
      lostAcknowledgementSql,
      { organizationId: ctx.orgId, userId: ctx.userId, role: 'owner' },
      orgSlug,
      a,
      { name: 'Gateway committed', modelAllowlist: ['gateway-model'] },
      aElsewhere?.hash ?? '',
      {
        config: providerDefinitionSchema.parse(config('Gateway committed', 7)),
        expectedHash: v4.hash ?? '',
      },
    );
  } catch (error) {
    lostAcknowledgement =
      error instanceof Error &&
      error.message === 'integration: COMMIT acknowledgement lost';
  }
  const committedDefinition = await definition();
  const committedCredential = await credential(a);
  record(
    'custom provider edit: a lost commit acknowledgement does not undo a committed definition',
    lostAcknowledgement &&
      committedDefinition.config?.baseUrl === url(7) &&
      committedDefinition.config.displayName === 'Gateway committed' &&
      committedCredential?.name === 'Gateway committed',
    `injected acknowledgement loss=${lostAcknowledgement}; persisted definition=${committedDefinition.config?.displayName}, credential=${committedCredential?.name}`,
  );

  // 5. The file is written last, in the same transaction: when it cannot be
  // written, the credential row that transaction already updated goes back.
  if (process.getuid?.() === 0) {
    recordSkip(
      record,
      'custom provider edit: an unwritable definition takes the credential edit back',
      'running as root: a read-only directory does not refuse the write',
    );
    return;
  }
  const directory = resolveProvidersDir(orgSlug);
  await chmod(directory, 0o555);
  let unwritable: Response;
  try {
    unwritable = await edit(a, {
      name: 'Gateway A5',
      modelAllowlist: ['gateway-model'],
      expectedHash: committedCredential?.hash,
      definition: {
        config: config('Gateway A5', 6),
        expectedHash: committedDefinition.hash,
      },
    });
  } finally {
    await chmod(directory, 0o755);
  }
  const afterUnwritable = await definition();
  const aAfterUnwritable = await credential(a);
  record(
    'custom provider edit: an unwritable definition takes the credential edit back',
    unwritable.status >= 500 &&
      afterUnwritable.hash === committedDefinition.hash &&
      aAfterUnwritable?.name === 'Gateway committed' &&
      aAfterUnwritable.hash === committedCredential?.hash,
    `edit with a read-only providers directory → ${unwritable.status} (want 5xx); readback definition unchanged=${afterUnwritable.hash === committedDefinition.hash}, credential=${aAfterUnwritable?.name} (want Gateway committed)`,
  );
}
