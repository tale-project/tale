'use node';

/**
 * Embedding models the organization could adopt right now — derived from the
 * catalogs of the providers it already holds a DIRECT credential for, using
 * the curated `embedding` facts the shipped catalogs carry (vector width is
 * the parameter an admin cannot safely guess).
 *
 * A listing, not a default: the settings surface offers these as one-click
 * form fills, and the admin's explicit Save is still what writes the
 * configuration. Nothing here auto-selects at index time — a silently picked
 * embedding model would pin the corpus width without anyone deciding it.
 *
 * `'use node'` because resolving connectors and catalogs is filesystem work
 * (same reason as `chat/composer.ts`).
 */

import { ConvexError, v } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import { pickEmbeddingRecommendations } from '../../lib/shared/providers/embedding_recommendations';
import { api } from '../_generated/api';
import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { getProviderCatalog } from '../lib/providers/catalog_fetch';
import { resolveProvidersForOrgId } from '../lib/providers/org_providers';

const embeddingRecommendationValidator = v.object({
  providerSlug: v.string(),
  model: v.string(),
  dimensions: v.number(),
  recommended: v.boolean(),
});

export const listEmbeddingRecommendations = action({
  args: { organizationId: v.string() },
  returns: v.array(embeddingRecommendationValidator),
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      providerSlug: string;
      model: string;
      dimensions: number;
      recommended: boolean;
    }>
  > => {
    // Same gate as the embedding config itself (`knowledge/actions.ts`):
    // the listing only serves the surface that writes the config.
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    if (defineAbilityFor(auth.member.role).cannot('write', 'orgSettings')) {
      throw new ConvexError({
        code: 'ORG_FORBIDDEN',
        message: `Role "${auth.member.role}" cannot manage the knowledge embedding configuration.`,
      });
    }

    const credentials = await ctx.runQuery(
      api.provider_credentials.queries.listCredentials,
      { organizationId: args.organizationId },
    );
    // Embedding calls need a directly usable secret; subscription credentials
    // are bound to vendor harnesses and cannot answer an embeddings endpoint.
    const directProviders = new Set(
      credentials
        .filter(
          (credential) =>
            credential.status === 'active' &&
            (credential.authMethod === 'api-key' ||
              credential.authMethod === 'env'),
        )
        .map((credential) => credential.providerSlug),
    );
    if (directProviders.size === 0) return [];

    const connectors = await resolveProvidersForOrgId(ctx, args.organizationId);
    const catalogs: Array<{
      providerSlug: string;
      entries: Awaited<ReturnType<typeof getProviderCatalog>>;
    }> = [];
    for (const connector of connectors) {
      if (!directProviders.has(connector.name)) continue;
      try {
        catalogs.push({
          providerSlug: connector.name,
          entries: await getProviderCatalog(connector),
        });
      } catch (error) {
        // One unreachable catalog must not blank the recommendations.
        console.warn(
          `[knowledge] could not resolve catalog for "${connector.name}" while listing embedding recommendations:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    return pickEmbeddingRecommendations(
      catalogs.map((catalog) => ({
        providerSlug: catalog.providerSlug,
        entries: [...catalog.entries],
      })),
    );
  },
});
