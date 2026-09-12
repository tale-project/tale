import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
  providerDefinitionSchema,
  type ProviderDefinition,
} from '@tale/shared/schemas/providers';
import type { Sql } from 'postgres';

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
) {
  const parsed = providerDefinitionSchema.safeParse(config);
  if (!parsed.success || parsed.data.name !== name) {
    throw new ConfigurationError(
      'PROVIDER_DEFINITION_INVALID',
      'Invalid provider definition.',
      400,
    );
  }
  const file = definitionPath(scope.orgSlug, name);
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
  const content = stringifyYaml(parsed.data);
  return sql.begin((tx) =>
    withConfigWriteLock(tx, scope.orgSlug, 'providers', async () => {
      const current = await readProviderDefinition(scope.orgSlug, name);
      assertExpectedHash(current.hash, expectedHash);
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
      }
      await atomicWrite(file, content);
      invalidateCatalogFetchCache();
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
    }),
  );
}
