import { providerDefinitionSchema } from '@tale/shared/schemas/providers';
import type { SettingsEffect } from '@tale/shared/schemas/settings-kinds';
import { configurationHash } from '@tale/shared/utils/configuration-hash';

import { isRecord } from '../../../lib/utils/type-utils.ts';
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

async function readProvider(
  ctx: SettingsContext,
  name: string,
): Promise<SettingsResource | null> {
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
  identify: (change) => nameOf(change),
  list: async (ctx, query) => {
    assertProviderManager(ctx.caller.role);
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
            {
              status: 409,
              hint: "check the provider's endpoint and its credential, then refresh again",
            },
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
