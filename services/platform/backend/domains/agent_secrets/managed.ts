import {
  agentSecretDigestScope,
  managedSecretDigest,
} from '@tale/shared/config/managed-secret';
import { expectedConfigurationHashSchema } from '@tale/shared/schemas/configuration';
import {
  agentSecretNameSchema,
  type ManagedObservation,
} from '@tale/shared/schemas/managed-configuration';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { assertExpectedHash } from '../../core/lib/config_store/precondition.ts';
import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
import {
  decryptSecret,
  type EncryptedSecret,
} from '../../core/lib/secret_box.ts';
import {
  AgentSecretError,
  lockAgentSecrets,
  upsertAgentSecretInTx,
} from './service.ts';

/**
 * An organization's agent secret as managed configuration declares it
 * (`agent-secret`): the declaration names the environment variable its value
 * is read from when it is applied, never the value. What the platform reads
 * back is the secret's name and a slow, salted digest of the value it holds
 * (`managedSecretDigest`), computed here from the stored value and never
 * stored itself — so a value a person replaced in Tale reads as differing
 * from the declaration, and the next apply writes the declared one again.
 * The value never leaves: not in a readback, an audit row or a refusal.
 */

/** The secret's name and the digest of its stored value — `null` when it
 * cannot be read with this deployment's key, which reads as differing from
 * any declaration. */
export type ManagedAgentSecretView = ManagedObservation<'agent-secret'>;

async function storedSecret(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
): Promise<{ name: string; encryptedValue: unknown } | null> {
  const rows = await sql<{ name: string; encryptedValue: unknown }[]>`
    SELECT name, encrypted_value AS "encryptedValue"
    FROM app.agent_secrets
    WHERE org_id = ${organizationId} AND name = ${name}
  `;
  return rows[0] ?? null;
}

function secretView(
  organizationId: string,
  row: { name: string; encryptedValue: unknown },
): ManagedAgentSecretView {
  let valueDigest: string | null = null;
  try {
    valueDigest = managedSecretDigest({
      organizationId,
      scope: agentSecretDigestScope(row.name),
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the column stores exactly the encryptSecret envelope
      value: decryptSecret(row.encryptedValue as EncryptedSecret),
    });
  } catch (error) {
    // A value this key cannot open reads as differing, so the next apply
    // writes the declared one; the name alone is logged, never the value.
    console.warn(
      `[agent-secrets] secret '${row.name}' could not be read for its digest:`,
      error instanceof Error ? error.name : 'unknown error',
    );
  }
  return { name: row.name, valueDigest };
}

/** The secret as managed configuration reads it, or `null` with no hash
 * when the organization holds none by that name and the declaration may
 * create it. */
export async function readManagedAgentSecret(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
  createIfMissing = false,
): Promise<{ config: ManagedAgentSecretView | null; hash: string | null }> {
  const row = await storedSecret(sql, organizationId, name);
  if (row === null) {
    if (createIfMissing) return { config: null, hash: null };
    throw new AgentSecretError(
      'AGENT_SECRET_NOT_FOUND',
      'No secret by that name',
      404,
    );
  }
  const config = secretView(organizationId, row);
  return { config, hash: managedConfigurationHash(config) };
}

export const managedAgentSecretWriteSchema = z.strictObject({
  name: agentSecretNameSchema,
  /** The value the declaration's environment variable holds. */
  value: z.string().min(1).max(10_000),
  expectedHash: expectedConfigurationHashSchema,
  createIfMissing: z.literal(true).optional(),
});

/**
 * Write the declared value under the secret's name, after comparing the
 * stored secret with the one the plan read, in one transaction: the value
 * the save trims and validates as the app's own save does, the same cap on
 * the organization's secrets, the same audit row (the name only). A
 * description a person gave the secret stays.
 */
export async function writeManagedAgentSecret(
  sql: Sql,
  args: z.infer<typeof managedAgentSecretWriteSchema> & {
    organizationId: string;
    actorId: string;
    actorEmail?: string;
  },
): Promise<void> {
  await sql.begin(async (tx) => {
    await lockAgentSecrets(tx, args.organizationId);
    const row = await storedSecret(tx, args.organizationId, args.name);
    assertExpectedHash(
      row === null
        ? null
        : managedConfigurationHash(secretView(args.organizationId, row)),
      args.expectedHash,
    );
    if (row === null && args.createIfMissing !== true)
      throw new AgentSecretError(
        'AGENT_SECRET_NOT_FOUND',
        'No secret by that name',
        404,
      );
    const kept = await tx<{ description: string | null }[]>`
      SELECT description FROM app.agent_secrets
      WHERE org_id = ${args.organizationId} AND name = ${args.name}
    `;
    const description = kept[0]?.description ?? undefined;
    await upsertAgentSecretInTx(tx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      ...(args.actorEmail !== undefined ? { actorEmail: args.actorEmail } : {}),
      name: args.name,
      value: args.value,
      ...(description !== undefined ? { description } : {}),
    });
  });
}
