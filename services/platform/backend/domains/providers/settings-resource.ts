import { providerDefinitionSchema } from '@tale/shared/schemas/providers';
import type { SettingsEffect } from '@tale/shared/schemas/settings-kinds';
import { configurationHash } from '@tale/shared/utils/configuration-hash';

import { isRecord } from '../../../lib/utils/type-utils.ts';
import type { CatalogListingFailureCode } from '../../core/lib/providers/catalog_fetch.ts';
import { loadProviderDefinitions } from '../../core/lib/providers/load_system_config.ts';
import { loadOrgCustomProviders } from '../../core/lib/providers/org_providers.ts';
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
import {
  checkProviderDefinition,
  deleteProviderDefinition,
  providerCredentialCount,
  readProviderDefinition,
  saveProviderDefinition,
} from './config.ts';
import {
  hasLiveCatalog,
  mayManageProviders,
  refreshProviderCatalog,
} from './management.ts';

/**
 * The organization's own AI providers as a settings kind over MCP
 * (`provider`): one resource per provider the organization defined, named
 * by the provider's name, read, saved and removed through the writers the
 * AI providers page uses — with their checks, their compare-and-set, their
 * history and their audit rows. The providers Tale ships are not settings;
 * their credentials are (`provider-credential`).
 */

const ID_FORM = 'the provider name, such as local-chat';

function assertProviderManager(role: string): void {
  if (!mayManageProviders(role)) {
    throw new SettingsRefusalError(
      'FORBIDDEN',
      'Only owners, admins and developers can change AI providers.',
      {
        status: 403,
        hint: 'the role of the person whose key this is cannot make this change; an owner, admin or developer can',
      },
    );
  }
}

/** What to do about a catalog refresh that failed, by why it failed: the
 * one fix each coded failure points at, and both suspects when the failure
 * has no code. */
function catalogRefreshHint(
  code: CatalogListingFailureCode | undefined,
): string {
  switch (code) {
    case 'PROVIDER_CATALOG_NOT_JSON':
    case 'PROVIDER_CATALOG_NOT_FOUND':
      return "the provider's base URL answered without a model list: set it to the API root (for most gateways it ends in /v1), then refresh again";
    case 'PROVIDER_CATALOG_KEY_REFUSED':
      return "the provider's endpoint refused the listing or wants a key for it: check the key of the provider's default credential (kind provider-credential, ids beginning with the provider name), then refresh again";
    case 'PROVIDER_CATALOG_UNREACHABLE':
      return "the provider's endpoint did not answer: check that its host is right and reachable from the server, then refresh again";
    case 'PROVIDER_CATALOG_UPSTREAM_ERROR':
      return "the provider's endpoint answered with a server error: refresh again later";
    case undefined:
      return "check the provider's endpoint and its credential, then refresh again";
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}

/** Whether Tale ships a provider of this name: it is no setting, so it is
 * never read as one. */
function isShipped(name: string): boolean {
  return loadProviderDefinitions().some((provider) => provider.name === name);
}

/** The refusal for a change or a read that names a provider Tale ships: not
 * a setting of the organization, with where its keys are kept. */
function shipped(name: string): SettingsRefusalError {
  return new SettingsRefusalError(
    'SETTINGS_NOT_FOUND',
    `${name} is a provider Tale ships, not one of this organization's settings`,
    {
      status: 404,
      hint: 'the organization changes the keys that serve it: kind provider-credential, ids beginning with the provider name; the providers it defines itself are this kind',
    },
  );
}

async function readProvider(
  ctx: SettingsContext,
  name: string,
): Promise<SettingsResource | null> {
  // A provider Tale ships is none the organization defined.
  if (isShipped(name)) return null;
  const snapshot = await readProviderDefinition(ctx.caller.orgSlug, name);
  if (snapshot.config === null || snapshot.hash === null) return null;
  return { id: name, config: snapshot.config, hash: snapshot.hash };
}

/** The provider a change names. */
function nameOf(change: SettingsChange): string {
  const carried =
    change.op === 'set' &&
    isRecord(change.config) &&
    typeof change.config.name === 'string'
      ? change.config.name
      : undefined;
  return identityOf('provider', change.id, carried, ID_FORM);
}

/** Where a definition sends the organization's requests, and with them
 * its keys. */
function endpointsOf(config: unknown): unknown {
  if (!isRecord(config)) return null;
  const harness = isRecord(config.harnessEndpoint)
    ? config.harnessEndpoint.baseUrl
    : undefined;
  return [config.baseUrl ?? null, config.apiFormat ?? null, harness ?? null];
}

export const providerSettings: SettingsKindHandler = {
  kind: 'provider',
  access: async ({ caller }) => {
    const allowed = mayManageProviders(caller.role);
    return { read: allowed, write: allowed };
  },
  identify: (change) => {
    const name = nameOf(change);
    // Only a change that would define it meets the writer's own word for a
    // shipped name; anything else about one is no setting at all.
    if (change.op !== 'set' && isShipped(name)) throw shipped(name);
    return name;
  },
  list: async (ctx, query) => {
    assertProviderManager(ctx.caller.role);
    const asked = query.ids?.find((id) => isShipped(id));
    if (asked !== undefined) throw shipped(asked);
    const names =
      query.ids ??
      loadOrgCustomProviders(ctx.caller.orgSlug)
        .map((provider) => provider.name)
        .sort((a, b) => a.localeCompare(b));
    const items: SettingsResource[] = [];
    for (const name of names) {
      const provider = await readProvider(ctx, name);
      if (provider !== null) items.push(provider);
    }
    return pageOf(items, query.cursor, 100);
  },
  read: async (ctx, id) => {
    assertProviderManager(ctx.caller.role);
    return id === null ? null : readProvider(ctx, id);
  },
  plan: async (ctx, change, current) => {
    assertProviderManager(ctx.caller.role);
    const name = nameOf(change);
    if (change.op === 'delete') {
      if (current === null) return {};
      const inUse = await providerCredentialCount(
        ctx.sql,
        ctx.caller.organizationId,
        name,
      );
      if (inUse > 0) {
        throw new SettingsRefusalError(
          'PROVIDER_IN_USE',
          inUse === 1
            ? '1 credential still uses this provider. Delete it first.'
            : `${inUse} credentials still use this provider. Delete them first.`,
          {
            status: 409,
            hint: 'remove its credentials first: kind provider-credential, ids beginning with the provider name',
            data: { credentials: inUse },
          },
        );
      }
      return {};
    }
    if (change.op === 'act') {
      // Reading a catalog sends the organization's key to the provider.
      return { effects: ['reaches-vendor'] };
    }
    parseSettingsConfig(
      providerDefinitionSchema,
      change.config,
      `the provider ${name}`,
    );
    const after = checkProviderDefinition(
      ctx.caller.orgSlug,
      name,
      change.config,
    );
    const effects: SettingsEffect[] = [];
    if (
      current !== null &&
      configurationHash(endpointsOf(after)) !==
        configurationHash(endpointsOf(current.config))
    ) {
      effects.push('changes-serving-account');
    }
    return {
      after,
      unchanged:
        current !== null &&
        configurationHash(after) === configurationHash(current.config),
      effects,
    };
  },
  apply: async (ctx, change, expectedHash) => {
    const name = nameOf(change);
    const actor = await settingsActor(ctx);
    const scope = { ...actor, orgSlug: ctx.caller.orgSlug };
    if (change.op === 'delete') {
      await deleteProviderDefinition(ctx.sql, scope, name, expectedHash);
      return { hash: null };
    }
    if (change.op === 'act') {
      const provider = loadOrgCustomProviders(ctx.caller.orgSlug).find(
        (entry) => entry.name === name,
      );
      if (provider !== undefined && hasLiveCatalog(provider)) {
        const result = await refreshProviderCatalog(ctx.sql, actor, provider);
        if (result.error !== undefined) {
          // The provider's own words may carry what its endpoint answered;
          // they stay in the server's log.
          console.warn(
            `[providers] refreshing the catalog of "${name}" over MCP failed:`,
            result.error,
          );
          throw new SettingsRefusalError(
            'CATALOG_REFRESH_FAILED',
            `the model catalog of ${name} could not be read`,
            { status: 409, hint: catalogRefreshHint(result.errorCode) },
          );
        }
      }
      return { hash: (await readProvider(ctx, name))?.hash ?? null };
    }
    const saved = await saveProviderDefinition(
      ctx.sql,
      scope,
      name,
      checkProviderDefinition(ctx.caller.orgSlug, name, change.config),
      expectedHash,
    );
    return { hash: saved.hash };
  },
};
