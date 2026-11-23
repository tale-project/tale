import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import type { Sql } from 'postgres';

import type { ActionCtx } from '../../core/lib/ctx.ts';
import { getProviderCatalog } from '../../core/lib/providers/catalog_fetch.ts';
import { resolveProvidersForOrgId } from '../../core/lib/providers/org_providers.ts';
import { buildProviderProvision } from '../../core/node_only/sandbox/gateway_provisioning.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { orgAdapterShimHandlers } from '../../lib/org-config.ts';
import { credentialShimHandlers } from '../provider_credentials/service.ts';
import { type RelayConnector, UpstreamUnavailableError } from './endpoint.ts';
import type { RelayHandlerDeps } from './server.ts';
import { bookCall, grantOf, remainingCents } from './store.ts';

/**
 * The relay's reads and writes in the running backend: grants and spend in
 * Postgres (`store.ts`), and the connector a model is served by, resolved
 * the way a turn's mint resolves it (`buildProviderProvision`): the
 * organization's connector, the credential the turn names or the default,
 * refused for a credential only its vendor's own harness may use.
 */

/** How long a connector's resolution is reused: short, so a credential an
 * admin disables or rotates stops serving within half a minute. */
const CONNECTOR_CACHE_MS = 30_000;
const CONNECTOR_CACHE_ENTRIES = 500;

/** The ctx the resolution reads through: credentials and the org slug. */
function resolutionCtx(sql: Sql): ActionCtx {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the resolution's only ctx facilities are the credential reads and the org-slug read these handlers answer
  return createCtxShim({
    ...credentialShimHandlers(sql),
    ...orgAdapterShimHandlers(sql),
  }) as unknown as ActionCtx;
}

export function relayDeps(sql: Sql): RelayHandlerDeps {
  const ctx = resolutionCtx(sql);
  const connectors = new Map<
    string,
    {
      at: number;
      value: Promise<{
        connector: RelayConnector;
        catalog: readonly ModelCatalogEntry[];
      }>;
    }
  >();

  const resolve = async (
    organizationId: string,
    providerSlug: string,
    credentialId: string | undefined,
  ): Promise<{
    connector: RelayConnector;
    catalog: readonly ModelCatalogEntry[];
  }> => {
    const provision = await buildProviderProvision(ctx, {
      organizationId,
      providerSlug,
      ...(credentialId !== undefined ? { credentialId } : {}),
    });
    if (provision === null) {
      throw new UpstreamUnavailableError(
        'its credential cannot be served through the model relay (a subscription runs only in its vendor’s own harness, and a per-credential endpoint is not served)',
      );
    }
    const definition = (
      await resolveProvidersForOrgId(ctx, organizationId)
    ).find((entry) => entry.name === providerSlug);
    return {
      connector: {
        name: provision.name,
        // A provision names no format for an OpenAI-compatible connector.
        apiFormat: provision.apiFormat ?? 'openai',
        baseUrl: provision.baseUrl,
        apiKey: provision.apiKey,
        ...(provision.harnessEndpoint !== undefined
          ? { harnessEndpoint: provision.harnessEndpoint }
          : {}),
      },
      catalog:
        definition === undefined ? [] : await getProviderCatalog(definition),
    };
  };

  return {
    grantOf: (tokenHash) => grantOf(sql, tokenHash),
    remainingCents: (keyId) => remainingCents(sql, keyId),
    bookCall: (keyId, usage, cents) => bookCall(sql, keyId, usage, cents),
    connectorFor: async (grant, providerSlug, modelId) => {
      const credentialId = grant.servingCredentials[providerSlug];
      const key = `${grant.organizationId}\u0000${providerSlug}\u0000${credentialId ?? ''}`;
      const now = Date.now();
      let cached = connectors.get(key);
      if (cached === undefined || now - cached.at >= CONNECTOR_CACHE_MS) {
        if (connectors.size >= CONNECTOR_CACHE_ENTRIES) connectors.clear();
        cached = {
          at: now,
          value: resolve(grant.organizationId, providerSlug, credentialId),
        };
        connectors.set(key, cached);
        // A failed resolution is not kept: the next call asks again.
        cached.value.catch(() => connectors.delete(key));
      }
      const { connector, catalog } = await cached.value;
      return {
        connector,
        entry: catalog.find((candidate) => candidate.id === modelId),
      };
    },
  };
}
