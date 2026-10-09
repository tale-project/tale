import { transactSerializable } from '@tale/shared/db/serializable';
import { providerEnvironmentCredentialSchema } from '@tale/shared/schemas/providers';
import type { SettingsEffect } from '@tale/shared/schemas/settings-kinds';
import { configurationHash } from '@tale/shared/utils/configuration-hash';

import { isRecord } from '../../../lib/utils/type-utils.ts';
import { isAdminOrDeveloperRole } from '../../auth/membership.ts';
import { assertExpectedHash } from '../../core/lib/config_store/precondition';
import {
  identityOf,
  pageOf,
  parseSettingsConfig,
  settingsActor,
  SettingsRefusalError,
} from '../mcp/settings/kit.ts';
import type {
  SettingsChange,
  SettingsContext,
  SettingsKindHandler,
  SettingsResource,
} from '../mcp/settings/registry.ts';
import { followEmbeddingCredential } from './embedding-follow.ts';
import {
  assertCredentialAdmin,
  assertCredentialEndpointUrl,
  createCredential,
  credentialDependents,
  type CredentialListItem,
  deleteCredential,
  listCredentials,
  updateCredential,
} from './service.ts';

/**
 * The organization's provider credentials as a settings kind over MCP
 * (`provider-credential`), through the writers the AI providers page
 * uses, behind its owner, admin or developer gate, with their checks and
 * audit rows. One resource per credential, named `<provider>/<name>`.
 *
 * Every credential reads, none with its secret; only one that reads its key
 * from an environment variable of the deployment is created or changed
 * here, as a declaration applied by the CLI does. An API key or a
 * subscription is entered in Tale, so its secret never travels through
 * MCP; such a credential may still be removed.
 */

const ID_FORM =
  'the provider and the credential name joined by a slash, the name URI-encoded, such as openai/Production%20key';

/** Where a person enters a credential that carries a secret. */
const TALE_ONLY_HINT =
  'tell the person to add or change it in Tale, under Settings > AI providers; over MCP only a credential that reads its key from an environment variable is created or changed';

function idOf(providerSlug: string, name: string): string {
  return `${providerSlug}/${encodeURIComponent(name)}`;
}

/** The provider and the name an id names. */
function partsOf(id: string): { providerSlug: string; name: string } {
  const slash = id.indexOf('/');
  let name: string | undefined;
  if (slash > 0) {
    try {
      name = decodeURIComponent(id.slice(slash + 1));
    } catch (error) {
      console.warn(
        '[provider-credentials] a settings id names no credential:',
        error instanceof Error ? error.message : error,
      );
    }
  }
  if (name === undefined || name === '') {
    throw new SettingsRefusalError(
      'SETTINGS_ID_INVALID',
      `"${id}" names no credential`,
      { hint: `the id is ${ID_FORM}` },
    );
  }
  return { providerSlug: id.slice(0, slash), name };
}

/** A credential as a declaration names it: what it is, never its secret. */
function declarationOf(row: CredentialListItem): Record<string, unknown> {
  return {
    providerSlug: row.providerSlug,
    authMethod: row.authMethod,
    name: row.name,
    envName: row.envName,
    endpointUrl: row.endpointUrl,
    modelAllowlist: row.modelAllowlist,
    status: row.status,
    isDefault: row.isDefault,
  };
}

function resourceOf(row: CredentialListItem): SettingsResource {
  return {
    id: idOf(row.providerSlug, row.name),
    config: declarationOf(row),
    hash: row.hash,
  };
}

/** The stored credential an id names, or null. */
async function findCredential(
  ctx: SettingsContext,
  id: string,
): Promise<CredentialListItem | null> {
  const { providerSlug, name } = partsOf(id);
  const rows = await listCredentials(
    ctx.sql,
    await settingsActor(ctx),
    providerSlug,
  );
  return rows.find((row) => row.name === name) ?? null;
}

/** The credential a change names. */
function credentialIdOf(change: SettingsChange): string {
  const config =
    change.op === 'set' && isRecord(change.config) ? change.config : null;
  const carried =
    typeof config?.providerSlug === 'string' && typeof config.name === 'string'
      ? idOf(config.providerSlug, config.name)
      : undefined;
  return identityOf('provider-credential', change.id, carried, ID_FORM);
}

/** What the resolver serves a provider's requests with. */
function servingOf(config: unknown): unknown {
  if (!isRecord(config)) return null;
  return [
    config.status ?? null,
    config.isDefault ?? null,
    config.envName ?? null,
    config.endpointUrl ?? null,
  ];
}

export const providerCredentialSettings: SettingsKindHandler = {
  kind: 'provider-credential',
  access: async ({ caller }) => {
    const allowed = isAdminOrDeveloperRole(caller.role);
    return { read: allowed, write: allowed };
  },
  identify: (change) => credentialIdOf(change),
  list: async (ctx, query) => {
    const scope = await settingsActor(ctx);
    const rows = await listCredentials(ctx.sql, scope);
    const wanted = query.ids === undefined ? null : new Set(query.ids);
    const items = rows
      .map(resourceOf)
      .filter((item) => wanted === null || wanted.has(item.id ?? ''));
    return pageOf(items, query.cursor, 100);
  },
  read: async (ctx, id) => {
    if (id === null) return null;
    const row = await findCredential(ctx, id);
    return row === null ? null : resourceOf(row);
  },
  plan: async (ctx, change, current) => {
    const scope = await settingsActor(ctx);
    assertCredentialAdmin(scope);
    const id = credentialIdOf(change);
    if (change.op === 'delete') {
      const row = current === null ? null : await findCredential(ctx, id);
      if (row === null) return {};
      const { usedBy } = await credentialDependents(ctx.sql, scope, row.id);
      if (usedBy.length > 0) {
        throw new SettingsRefusalError(
          'CREDENTIAL_IN_USE',
          'The knowledge embedding model uses this credential. Choose another credential for it under Settings → Data residency → Embedding model first.',
          {
            status: 409,
            hint: 'point the knowledge-embedding setting at another credential first',
            data: { usedBy },
          },
        );
      }
      // Nothing promotes another credential when the default goes.
      return row.isDefault && row.status === 'active'
        ? { effects: ['breaks-dependents'] }
        : {};
    }
    const sent = isRecord(change.config) ? change.config.authMethod : undefined;
    if (
      (sent !== undefined && sent !== 'env') ||
      (current !== null &&
        isRecord(current.config) &&
        current.config.authMethod !== 'env')
    ) {
      throw new SettingsRefusalError(
        'SETTINGS_TALE_ONLY',
        `${id} holds a key or a subscription entered in Tale`,
        { hint: TALE_ONLY_HINT },
      );
    }
    const after = parseSettingsConfig(
      providerEnvironmentCredentialSchema,
      change.config,
      `the credential ${id}`,
    );
    if (after.endpointUrl !== null) {
      assertCredentialEndpointUrl(after.endpointUrl);
    }
    const effects: SettingsEffect[] = [];
    // A new active default, or a credential that serves differently now.
    const changesServing =
      current === null
        ? after.isDefault && after.status === 'active'
        : configurationHash(servingOf(after)) !==
          configurationHash(servingOf(current.config));
    if (changesServing) effects.push('changes-serving-account');
    return {
      after,
      unchanged:
        current !== null &&
        configurationHash(after) === configurationHash(current.config),
      effects,
    };
  },
  apply: async (ctx, change, expectedHash) => {
    const scope = await settingsActor(ctx);
    const id = credentialIdOf(change);
    const { providerSlug, name } = partsOf(id);
    if (change.op === 'delete') {
      await transactSerializable(ctx.sql, async (tx) => {
        const row = (await listCredentials(tx, scope, providerSlug)).find(
          (entry) => entry.name === name,
        );
        assertExpectedHash(row?.hash ?? null, expectedHash);
        if (row !== undefined) await deleteCredential(tx, scope, row.id);
      });
      return { hash: null };
    }
    const config = providerEnvironmentCredentialSchema.parse(change.config);
    const existing = await findCredential(ctx, id);
    let credentialId: string;
    if (existing === null) {
      credentialId = await transactSerializable(ctx.sql, (tx) =>
        createCredential(
          tx,
          scope,
          {
            providerSlug: config.providerSlug,
            authMethod: 'env',
            name: config.name,
            envName: config.envName,
            ...(config.endpointUrl === null
              ? {}
              : { endpointUrl: config.endpointUrl }),
            ...(config.modelAllowlist === null
              ? {}
              : { modelAllowlist: config.modelAllowlist }),
            status: config.status,
            isDefault: config.isDefault,
          },
          null,
        ),
      );
    } else {
      credentialId = existing.id;
      await transactSerializable(ctx.sql, (tx) =>
        updateCredential(
          tx,
          scope,
          existing.id,
          {
            envName: config.envName,
            endpointUrl: config.endpointUrl,
            modelAllowlist: config.modelAllowlist,
            status: config.status,
            isDefault: config.isDefault,
          },
          expectedHash ?? undefined,
        ),
      );
    }
    // The documents and websites follow a credential the embedding model
    // resolves, as they do after a save on the page.
    await followEmbeddingCredential(ctx.sql, scope, credentialId);
    return { hash: (await findCredential(ctx, id))?.hash ?? null };
  },
};
