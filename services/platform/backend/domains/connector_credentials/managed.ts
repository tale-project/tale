import {
  connectorCredentialDigestScope,
  managedSecretDigestAsync,
} from '@tale/shared/config/managed-secret';
import { expectedConfigurationHashSchema } from '@tale/shared/schemas/configuration';
import {
  managedConnectorCredentialTargetSchema,
  type ManagedObservation,
} from '@tale/shared/schemas/managed-configuration';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { assertExpectedHash } from '../../core/lib/config_store/precondition.ts';
import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
import {
  ConnectorCredentialError,
  createCredentialInTransaction,
  credentialSecretFields,
  findCredentialByName,
  lockCredentialPair,
  updateCredentialInTransaction,
  type CredentialActor,
  type CredentialRow,
} from './service.ts';

/**
 * A connector credential as managed configuration declares it
 * (`connector-credential`): the declaration names the environment variables
 * its secret fields are read from when it is applied, never the values.
 * What the platform reads back is the credential's name, sign-in method,
 * endpoint, whether it is the connector's default, the names of the secret
 * fields it holds and a slow, salted digest of their values
 * (`managedSecretDigestAsync`), computed here from the stored values and never
 * stored itself. A sign-in the outside system renews (`oauth2`) takes a
 * person's consent and is never declared.
 */

/** The credential's identity, the names of the secret fields it holds and
 * the digest of their values — `null` when they cannot be read, which reads
 * as differing from any declaration. */
export type ManagedConnectorCredentialView =
  ManagedObservation<'connector-credential'>;

async function credentialView(
  organizationId: string,
  row: CredentialRow,
): Promise<ManagedConnectorCredentialView> {
  if (row.authMethod === 'oauth2')
    throw new ConnectorCredentialError(
      'CREDENTIAL_NOT_DECLARABLE',
      'A credential the connector renews is connected in Tale, never declared.',
      409,
    );
  let fields: string[] = [];
  let valueDigest: string | null = null;
  try {
    const values = credentialSecretFields(row);
    fields = Object.keys(values).sort();
    valueDigest = await managedSecretDigestAsync({
      organizationId,
      scope: connectorCredentialDigestScope(row.connectorSlug, row.name),
      value: values,
    });
  } catch (error) {
    // Unreadable values read as differing, so the next apply writes the
    // declared ones; only the credential's identity is logged.
    console.warn(
      `[connector-credentials] credential ${row.id} could not be read for its digest:`,
      error instanceof Error ? error.name : 'unknown error',
    );
  }
  return {
    connector: row.connectorSlug,
    name: row.name,
    authMethod: row.authMethod,
    endpoint: row.endpointUrl,
    isDefault: row.isDefault,
    fields,
    valueDigest,
  };
}

/** The credential as managed configuration reads it, or `null` with no hash
 * when the connector has none by that name and the declaration may create
 * it. */
export async function readManagedConnectorCredential(
  sql: Sql | TransactionSql,
  organizationId: string,
  connector: string,
  name: string,
  createIfMissing = false,
): Promise<{
  config: ManagedConnectorCredentialView | null;
  hash: string | null;
}> {
  const row = await findCredentialByName(sql, {
    organizationId,
    connectorSlug: connector,
    name,
  });
  if (row === null) {
    if (createIfMissing) return { config: null, hash: null };
    throw new ConnectorCredentialError(
      'CREDENTIAL_NOT_FOUND',
      'Credential not found.',
      404,
    );
  }
  const config = await credentialView(organizationId, row);
  return { config, hash: managedConfigurationHash(config) };
}

// The same bounds as the door Settings → Connectors writes through.
const secretValue = z.string().min(1).max(8192);
const userName = z.string().min(1).max(512);

export const managedConnectorCredentialWriteSchema = z.strictObject({
  /** The declaration without where its values come from. */
  config: managedConnectorCredentialTargetSchema,
  /** The values its environment variables hold, by field. */
  secret: z.strictObject({
    token: secretValue.optional(),
    username: userName.optional(),
    password: secretValue.optional(),
    smtpUsername: userName.optional(),
    smtpPassword: secretValue.optional(),
  }),
  expectedHash: expectedConfigurationHashSchema,
  createIfMissing: z.literal(true).optional(),
});

/**
 * Create the declared credential or bring an existing one in line — its
 * name, endpoint, default and secret fields, sealed again whole — through
 * the writers Settings → Connectors uses, under the connector's pair lock,
 * after comparing the stored credential with the one the plan read. A
 * credential keeps the sign-in method it was created with; its status and
 * per-credential settings stay as they are.
 */
export async function writeManagedConnectorCredential(
  sql: Sql,
  args: z.infer<typeof managedConnectorCredentialWriteSchema> & {
    organizationId: string;
    actor: CredentialActor;
  },
): Promise<void> {
  const { config } = args;
  await sql.begin(async (tx) => {
    await lockCredentialPair(tx, args.organizationId, config.connector);
    const row = await findCredentialByName(tx, {
      organizationId: args.organizationId,
      connectorSlug: config.connector,
      name: config.name,
      lock: true,
    });
    assertExpectedHash(
      row === null
        ? null
        : managedConfigurationHash(
            await credentialView(args.organizationId, row),
          ),
      args.expectedHash,
    );
    if (row === null) {
      if (args.createIfMissing !== true)
        throw new ConnectorCredentialError(
          'CREDENTIAL_NOT_FOUND',
          'Credential not found.',
          404,
        );
      await createCredentialInTransaction(tx, {
        organizationId: args.organizationId,
        connectorSlug: config.connector,
        authMethod: config.authMethod,
        name: config.name,
        secret: args.secret,
        ...(config.endpoint !== undefined
          ? { endpointUrl: config.endpoint }
          : {}),
        ...(config.isDefault !== undefined
          ? { isDefault: config.isDefault }
          : {}),
        createdBy: args.actor.userId,
        actor: args.actor,
      });
      return;
    }
    if (row.authMethod !== config.authMethod)
      throw new ConnectorCredentialError(
        'CREDENTIAL_AUTH_METHOD_FIXED',
        `Credential "${row.name}" signs in with ${row.authMethod}; create another credential to use ${config.authMethod}.`,
        409,
      );
    await updateCredentialInTransaction(tx, {
      organizationId: args.organizationId,
      credentialId: row.id,
      name: config.name,
      secret: args.secret,
      ...(config.endpoint !== undefined
        ? { endpointUrl: config.endpoint }
        : {}),
      ...(config.isDefault !== undefined
        ? { isDefault: config.isDefault }
        : {}),
      actor: args.actor,
    });
  });
}
