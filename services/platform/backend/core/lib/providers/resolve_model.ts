'use node';

/**
 * The catalog entry an explicit model id resolves to in an organization —
 * the one lookup behind a turn's model facts. The chat turn reads its wire
 * and its context window from it; a managed harness turn reads the same
 * context window from it (`resolveHarnessTurnContextWindow`), so both lanes
 * mean the same thing by "the model's window".
 */

import type {
  ModelCatalogEntry,
  ProviderDefinition,
} from '@tale/shared/schemas/providers';

import { AppError } from '../../../../lib/shared/errors/app-error';
import type { ActionCtx } from '../ctx';
import { internal } from '../handler_names';
import { directActiveCredential } from './direct_credential';
import { resolveProvidersForOrgId } from './org_providers';
import { getServableCatalog } from './servable_catalog';

interface ResolvedModel {
  readonly entry: ModelCatalogEntry;
  readonly connector: ProviderDefinition;
}

/** Find the catalog entry for an explicit model id in the org's connectors.
 * The connector that lists it is the one whose wire the turn will speak.
 * A provider hint (the composer's picked section) is tried first, so two
 * providers serving the same id resolve to the copy the user chose; an
 * unmatched hint falls back to the id-only walk rather than refusing. With
 * `strict` (the REST door, where the provider is a CHOICE the caller was
 * promised) only the named connector is consulted, and a pair that no
 * longer resolves — the connector removed or renamed, the model gone from
 * its catalog between the 202 and the run — refuses the turn instead of
 * sending the conversation to a provider the caller never named. A
 * catalog-less connector (Azure deployment names) serves its DEFAULT
 * credential's allowlist — the same credential the direct wire resolves. */
export async function resolveModel(
  ctx: ActionCtx,
  organizationId: string,
  modelId: string,
  providerSlug?: string,
  strict = false,
): Promise<ResolvedModel> {
  const connectors = await resolveProvidersForOrgId(ctx, organizationId);
  const ordered =
    providerSlug === undefined
      ? connectors
      : strict
        ? connectors.filter((connector) => connector.name === providerSlug)
        : [
            ...connectors.filter(
              (connector) => connector.name === providerSlug,
            ),
            ...connectors.filter(
              (connector) => connector.name !== providerSlug,
            ),
          ];
  for (const connector of ordered) {
    let allowlist: readonly string[] | undefined;
    if (connector.catalog.source === 'none') {
      const row: unknown = await ctx.runQuery(
        internal.provider_credentials.queries.getDefaultCredentialInternal,
        { organizationId, providerSlug: connector.name },
      );
      const credential = directActiveCredential(row);
      if (credential === null) continue;
      allowlist = credential.modelAllowlist;
    }
    const catalog = await getServableCatalog(connector, allowlist);
    const entry = catalog.find((candidate) => candidate.id === modelId);
    if (entry) return { entry, connector };
  }
  if (strict && providerSlug !== undefined) {
    throw new AppError({
      code: 'CHAT_PROVIDER_UNAVAILABLE',
      message: `Provider "${providerSlug}" no longer serves model "${modelId}" in this organization. Pick a pair GET /api/v1/models lists.`,
    });
  }
  throw new AppError({
    code: 'CHAT_MODEL_UNKNOWN',
    message: `No model "${modelId}" is available in this organization. Pick a model the organization has configured.`,
  });
}
