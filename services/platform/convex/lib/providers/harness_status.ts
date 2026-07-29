'use node';

/**
 * The per-harness status the AI-providers settings page shows: how each
 * shipped third-party agent (sandbox harness) would run for THIS organization
 * — the managed lane's verdict with its model pool, and any vendor
 * subscription credentials bound to it.
 *
 * READ-ONLY aggregation: the configuration truth stays in the org's provider
 * credentials and the shipped harness facts. Every verdict is asked of
 * `resolveExecution` — never re-derived here — and the direct-served model
 * pool comes from the composer's own listing, so the count and default shown
 * can never drift from what the picker offers and the turn's kick falls back
 * to. Unavailability reasons travel as enum codes; the client renders the
 * localized sentence.
 *
 * `'use node'` by necessity — the harness facts and org providers are files.
 */

import { v, type Infer } from 'convex/values';

import {
  buildHarnessTable,
  resolveExecution,
  type CredentialAuth,
} from '../../../lib/shared/providers/resolve_execution';
import type {
  HarnessDefinition,
  ModelCatalogEntry,
} from '../../../lib/shared/schemas/providers';
import { api } from '../../_generated/api';
import { action } from '../../_generated/server';
import { requireOrgAdminOrDeveloper } from '../auth/require_org_admin_or_developer';
import { credentialAuthFor } from './credential_auth';
import { loadHarnesses } from './load_system_config';
import { resolveProvidersForOrgId } from './org_providers';

const harnessManagedStatusValidator = v.union(
  v.object({
    available: v.literal(true),
    /** How many directly-served models the managed lane offers this harness. */
    modelCount: v.number(),
    /** The model a turn runs when the composer sends no explicit pick. */
    defaultModelId: v.string(),
  }),
  v.object({
    available: v.literal(false),
    reason: v.union(v.literal('byo-only'), v.literal('no-direct-credential')),
  }),
);

const harnessStatusValidator = v.object({
  slug: v.string(),
  label: v.string(),
  managed: harnessManagedStatusValidator,
  /** Vendor subscriptions bound to this harness; `usable: false` marks an
   * inert binding (the harness cannot accept bring-your-own credentials). */
  subscriptions: v.array(
    v.object({ providerSlug: v.string(), usable: v.boolean() }),
  ),
});

export type HarnessStatusEntry = Infer<typeof harnessStatusValidator>;

/** A subscription-flavored credential, resolver-shaped. */
type SubscriptionAuth = Extract<
  CredentialAuth,
  { authMethod: 'subscription-key' | 'subscription-broker' }
>;

export interface SubscriptionCredentialFact {
  providerSlug: string;
  credential: SubscriptionAuth;
}

/** The resolver only reads a model's identity; neutral values fill the
 * catalog fields it ignores (same convention as the composer's affordance
 * probe). */
function neutralModelEntry(id: string): ModelCatalogEntry {
  return {
    id,
    provider: 'status-probe',
    tags: ['chat'],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 1,
  };
}

/**
 * Pure derivation, exported for the unit tests: shipped harness facts ×
 * the org's direct-served model pool × its subscription credentials →
 * one status row per harness, sorted by label.
 */
export function deriveHarnessStatus(inputs: {
  harnesses: readonly HarnessDefinition[];
  /** Direct-served composer models, in the order the picker lists them —
   * the first is the kick's fallback default. */
  directModels: readonly { id: string }[];
  subscriptions: readonly SubscriptionCredentialFact[];
}): HarnessStatusEntry[] {
  const table = buildHarnessTable(inputs.harnesses);
  const firstDirect = inputs.directModels[0];
  const probe = neutralModelEntry(firstDirect?.id ?? 'none');

  return [...inputs.harnesses]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((harness) => {
      const managedVerdict = resolveExecution(
        {
          model: probe,
          credential: { authMethod: 'api-key' },
          mode: 'sandbox',
          harness: harness.slug,
        },
        table,
      );
      const managed: HarnessStatusEntry['managed'] =
        managedVerdict.mode !== 'sandbox'
          ? { available: false, reason: 'byo-only' }
          : firstDirect === undefined
            ? { available: false, reason: 'no-direct-credential' }
            : {
                available: true,
                modelCount: inputs.directModels.length,
                defaultModelId: firstDirect.id,
              };

      // One row per provider: several credentials of one vendor bound to the
      // same harness collapse, usable when any of them is.
      const byProvider = new Map<string, boolean>();
      for (const entry of inputs.subscriptions) {
        if (entry.credential.constraints.harness !== harness.slug) continue;
        const usable =
          resolveExecution(
            { model: probe, credential: entry.credential, mode: 'sandbox' },
            table,
          ).mode === 'sandbox';
        byProvider.set(
          entry.providerSlug,
          (byProvider.get(entry.providerSlug) ?? false) || usable,
        );
      }
      const subscriptions = [...byProvider.entries()]
        .map(([providerSlug, usable]) => ({ providerSlug, usable }))
        .sort((a, b) => a.providerSlug.localeCompare(b.providerSlug));

      return {
        slug: harness.slug,
        label: harness.displayName,
        managed,
        subscriptions,
      };
    });
}

/**
 * The status of every shipped harness for one org. Gated like the rest of
 * the AI-providers settings page; the listing is non-secret capability
 * metadata — credential SHAPES and counts, never secret material.
 */
export const listHarnessStatus = action({
  args: { organizationId: v.string() },
  returns: v.array(harnessStatusValidator),
  handler: async (ctx, args): Promise<HarnessStatusEntry[]> => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);

    const listing = await ctx.runAction(api.chat.composer.listComposerModels, {
      organizationId: args.organizationId,
    });
    const directModels = listing.models.filter(
      (model) =>
        model.credential.authMethod === 'api-key' ||
        model.credential.authMethod === 'env',
    );

    const credentials = await ctx.runQuery(
      api.provider_credentials.queries.listCredentials,
      { organizationId: args.organizationId },
    );
    const providers = await resolveProvidersForOrgId(ctx, args.organizationId);
    const providerByName = new Map(
      providers.map((provider) => [provider.name, provider] as const),
    );
    const subscriptions = credentials
      .filter((credential) => credential.status === 'active')
      .flatMap((credential): SubscriptionCredentialFact[] => {
        const provider = providerByName.get(credential.providerSlug);
        if (!provider) return [];
        const auth = credentialAuthFor(provider, credential.authMethod);
        return auth?.authMethod === 'subscription-key' ||
          auth?.authMethod === 'subscription-broker'
          ? [{ providerSlug: credential.providerSlug, credential: auth }]
          : [];
      });

    return deriveHarnessStatus({
      harnesses: loadHarnesses(),
      directModels,
      subscriptions,
    });
  },
});
