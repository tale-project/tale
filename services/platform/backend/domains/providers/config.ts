import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
  providerDefinitionSchema,
  type ProviderDefinition,
} from '@tale/shared/schemas/providers';
import type { Sql, TransactionSql } from 'postgres';

import { checkProviderHostPolicy } from '../../../lib/net/host-policy';
import {
  parseYamlOrThrow,
  stringifyYaml,
} from '../../../lib/shared/config/yaml';
import {
  configSnapshot,
  assertExpectedHash,
  ConfigurationError,
} from '../../core/lib/config_store/precondition';
import { withConfigWriteLock } from '../../core/lib/config_store/write_lock';
import {
  atomicWrite,
  generateHistoryTimestamp,
  pruneHistory,
  readJsonFile,
  removeFileSafe,
  safeJoinWithinDir,
  sha256,
} from '../../core/lib/file_io';
import { invalidateCatalogFetchCache } from '../../core/lib/providers/catalog_fetch';
import { loadProviderDefinitions } from '../../core/lib/providers/load_system_config';
import {
  resolveProvidersDir,
  loadOrgCustomProviders,
} from '../../core/lib/providers/org_providers';
import { createAuditLog } from '../audit_logs/service';

const MAX_PROVIDER_BYTES = 256 * 1024;

function definitionPath(orgSlug: string, name: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/.test(name) || name.length > 64) {
    throw new ConfigurationError(
      'PROVIDER_DEFINITION_INVALID',
      'Invalid provider name.',
      400,
    );
  }
  if (loadProviderDefinitions().some((provider) => provider.name === name)) {
    throw new ConfigurationError(
      'PROVIDER_NAME_RESERVED',
      'A custom provider cannot replace a shipped provider.',
      409,
    );
  }
  return safeJoinWithinDir(resolveProvidersDir(orgSlug), `${name}.yml`);
}

export async function readProviderDefinition(orgSlug: string, name: string) {
  const snapshot = configSnapshot(
    await readJsonFile(
      definitionPath(orgSlug, name),
      MAX_PROVIDER_BYTES,
      (content) => providerDefinitionSchema.parse(parseYamlOrThrow(content)),
    ),
  );
  if (snapshot.config !== null && snapshot.config.name !== name) {
    throw new ConfigurationError(
      'CONFIG_UNREADABLE',
      'The provider definition does not match its native identity.',
    );
  }
  return snapshot;
}

/** Put back what a save replaced: the exact preimage bytes, or no file at
 * all where the save created one. Called while the providers lock holds. */
async function restoreDefinition(
  file: string,
  preimage: string | null,
): Promise<void> {
  if (preimage === null) await removeFileSafe(file);
  else await atomicWrite(file, preimage);
  invalidateCatalogFetchCache();
}

export interface SaveProviderDefinitionOptions {
  /**
   * Database work that lands with the definition or not at all — the
   * credential of a custom provider, edited in the same dialog. It runs in
   * the save's own transaction, under the providers lock, after the
   * definition's compare-and-set and before its file is touched: its
   * refusal writes nothing, and the rollback takes back its rows.
   */
  alongside?: (tx: TransactionSql) => Promise<void>;
}

/** A definition as a save checks it, and the file it is kept in. */
function checkedDefinition(
  orgSlug: string,
  name: string,
  config: unknown,
): { definition: ProviderDefinition; file: string } {
  const parsed = providerDefinitionSchema.safeParse(config);
  if (!parsed.success || parsed.data.name !== name) {
    throw new ConfigurationError(
      'PROVIDER_DEFINITION_INVALID',
      'Invalid provider definition.',
      400,
    );
  }
  const file = definitionPath(orgSlug, name);
  for (const endpoint of [
    parsed.data.baseUrl,
    parsed.data.harnessEndpoint?.baseUrl,
  ]) {
    if (!endpoint) continue;
    try {
      const url = new URL(endpoint);
      if (url.username || url.password || endpoint.trim() !== endpoint)
        throw new Error('unsafe endpoint');
      checkProviderHostPolicy(endpoint);
    } catch {
      throw new ConfigurationError(
        'PROVIDER_ENDPOINT_INVALID',
        'The provider endpoint is not permitted by this deployment.',
        400,
      );
    }
  }
  return { definition: parsed.data, file };
}

/**
 * Check a custom provider's definition as a save checks it, writing
 * nothing: the definition's own shape under the name it is saved as, a
 * name that is a provider's and no shipped provider's, and endpoints that
 * carry no credentials and pass the deployment's host policy. Answers the
 * definition as the save stores it.
 */
export function checkProviderDefinition(
  orgSlug: string,
  name: string,
  config: unknown,
): ProviderDefinition {
  return checkedDefinition(orgSlug, name, config).definition;
}

/** How many of the organization's credentials name the provider — a
 * provider is removed only once none does. */
export async function providerCredentialCount(
  db: Sql | TransactionSql,
  organizationId: string,
  name: string,
): Promise<number> {
  const rows = await db<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM app.provider_credentials
    WHERE org_id = ${organizationId}
      AND provider_slug = ${name}
  `;
  return rows[0]?.count ?? 0;
}

export async function saveProviderDefinition(
  sql: Sql,
  scope: {
    organizationId: string;
    orgSlug: string;
    userId: string;
    email?: string;
  },
  name: string,
  config: ProviderDefinition,
  expectedHash: string | null,
  options: SaveProviderDefinitionOptions = {},
) {
  const { definition, file } = checkedDefinition(scope.orgSlug, name, config);
  const content = stringifyYaml(definition);
  const save = (tx: TransactionSql) =>
    withConfigWriteLock(tx, scope.orgSlug, 'providers', async () => {
      const current = await readProviderDefinition(scope.orgSlug, name);
      assertExpectedHash(current.hash, expectedHash);
      await options.alongside?.(tx);
      if (current.hash === sha256(content)) return current;
      await createAuditLog(tx, {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        ...(scope.email ? { actorEmail: scope.email } : {}),
        actorType: 'user',
        action: 'provider_definition.saved',
        category: 'security',
        resourceType: 'provider_definition',
        resourceId: name,
        resourceName: name,
        previousState: { hash: current.hash },
        newState: { hash: sha256(content) },
        status: 'success',
      });
      let preimage: string | null = null;
      if (current.config !== null) {
        // Preserve the exact reviewed preimage, including its original formatting.
        const previous = configSnapshot(
          await readJsonFile(file, MAX_PROVIDER_BYTES, (text) => text),
        );
        assertExpectedHash(previous.hash, current.hash);
        if (previous.config === null)
          throw new ConfigurationError(
            'CONFIG_VERSION_CONFLICT',
            'The provider changed during its save.',
          );
        const history = safeJoinWithinDir(
          resolveProvidersDir(scope.orgSlug),
          `.history/${name}`,
        );
        await mkdir(history, { recursive: true });
        await atomicWrite(
          path.join(history, `${generateHistoryTimestamp()}.yml`),
          previous.config,
        );
        await pruneHistory(history, 100);
        preimage = previous.config;
      }
      await atomicWrite(file, content);
      invalidateCatalogFetchCache();
      try {
        const saved = await readProviderDefinition(scope.orgSlug, name);
        if (
          saved.hash !== sha256(content) ||
          !loadOrgCustomProviders(scope.orgSlug).some(
            (provider) => provider.name === name,
          )
        ) {
          throw new ConfigurationError(
            'CONFIG_READBACK_FAILED',
            'The native provider did not pass its readback.',
          );
        }
        return saved;
      } catch (error) {
        // What fails its readback is not published: the preimage goes back
        // while the lock still holds, and the rollback takes the rest.
        await restoreDefinition(file, preimage).catch((restoreError) => {
          console.error(
            `[providers] the definition "${name}" failed its readback and could not be taken back:`,
            restoreError,
          );
        });
        throw error;
      }
    });
  // A lost COMMIT acknowledgement does not prove rollback. Once this
  // transaction ends, a later writer can also have accepted the same bytes.
  // Never compensate outside its lock: that could undo a committed save.
  // File/DB crash recovery needs a durable protocol; callers must read back
  // an unknown outcome before retrying.
  return sql.begin(save);
}

/**
 * Remove an organization's custom provider definition.
 *
 * Refused while any of the organization's credentials still name the
 * provider: a credential whose connector vanished keeps listing under its
 * stored slug but can serve nothing, so the operator retires the keys first,
 * deliberately, instead of finding them orphaned. The exact reviewed preimage
 * is archived under `.history/<name>/` like every save, so a deletion is as
 * recoverable as an edit.
 */
export async function deleteProviderDefinition(
  sql: Sql,
  scope: {
    organizationId: string;
    orgSlug: string;
    userId: string;
    email?: string;
  },
  name: string,
  expectedHash: string | null | undefined,
): Promise<{ deleted: true }> {
  const file = definitionPath(scope.orgSlug, name);
  return sql.begin((tx) =>
    withConfigWriteLock(tx, scope.orgSlug, 'providers', async () => {
      const current = await readProviderDefinition(scope.orgSlug, name);
      if (current.config === null) {
        throw new ConfigurationError(
          'PROVIDER_NOT_FOUND',
          'No custom provider definition with this name exists.',
          404,
        );
      }
      assertExpectedHash(current.hash, expectedHash);
      const inUse = await providerCredentialCount(
        tx,
        scope.organizationId,
        name,
      );
      if (inUse > 0) {
        throw new ConfigurationError(
          'PROVIDER_IN_USE',
          inUse === 1
            ? '1 credential still uses this provider. Delete it first.'
            : `${inUse} credentials still use this provider. Delete them first.`,
          409,
        );
      }
      // Preserve the exact reviewed preimage, including its original formatting.
      const previous = configSnapshot(
        await readJsonFile(file, MAX_PROVIDER_BYTES, (text) => text),
      );
      assertExpectedHash(previous.hash, current.hash);
      if (previous.config === null) {
        throw new ConfigurationError(
          'CONFIG_VERSION_CONFLICT',
          'The provider changed during its deletion.',
        );
      }
      const history = safeJoinWithinDir(
        resolveProvidersDir(scope.orgSlug),
        `.history/${name}`,
      );
      await mkdir(history, { recursive: true });
      await atomicWrite(
        path.join(history, `${generateHistoryTimestamp()}.yml`),
        previous.config,
      );
      await pruneHistory(history, 100);
      await createAuditLog(tx, {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        ...(scope.email ? { actorEmail: scope.email } : {}),
        actorType: 'user',
        action: 'provider_definition.deleted',
        category: 'security',
        resourceType: 'provider_definition',
        resourceId: name,
        resourceName: name,
        previousState: { hash: current.hash },
        newState: { hash: null },
        status: 'success',
      });
      await removeFileSafe(file);
      invalidateCatalogFetchCache();
      if (
        loadOrgCustomProviders(scope.orgSlug).some(
          (provider) => provider.name === name,
        )
      ) {
        throw new ConfigurationError(
          'CONFIG_READBACK_FAILED',
          'The native provider is still listed after its deletion.',
        );
      }
      return { deleted: true as const };
    }),
  );
}
