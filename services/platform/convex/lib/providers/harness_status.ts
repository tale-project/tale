'use node';

/**
 * The per-harness status the AI-providers settings page shows: how each
 * managed-capable shipped harness would run for THIS organization — the
 * managed lane's verdict with its model pool, and any vendor subscription
 * credentials bound to it.
 *
 * Bring-your-own-only harnesses (Cursor today) are omitted: they cannot use
 * platform-managed keys, have no vendor credential setup in Providers, and
 * cannot be selected for agents — listing them only misleads.
 *
 * READ-ONLY aggregation: the configuration truth stays in the org's provider
 * credentials and the shipped harness facts. Every verdict is asked of
 * `resolveExecution` — never re-derived here — and the direct-served model
 * pool comes from the composer's own listing, so the count and default shown
 * can never drift from what a harness turn's kick falls back to.
 * Unavailability reasons travel as enum codes; the client renders the
 * localized sentence.
 *
 * `'use node'` by necessity — the harness facts and org providers are files.
 */

import {
  buildHarnessTable,
  resolveExecution,
  type CredentialAuth,
} from '../../../lib/shared/providers/resolve_execution';
import type {
  HarnessDefinition,
  ModelCatalogEntry,
} from '../../../lib/shared/schemas/providers';

export type HarnessManagedStatus =
  | {
      available: true;
      /** How many directly-served models the managed lane offers this harness. */
      modelCount: number;
      /** The model a turn runs when the composer sends no explicit pick. */
      defaultModelId: string;
    }
  | {
      available: false;
      reason: 'no-direct-credential';
    };

export interface HarnessStatusEntry {
  slug: string;
  label: string;
  managed: HarnessManagedStatus;
  /** Vendor subscriptions bound to this harness; `usable: false` marks an
   * inert binding (the harness cannot accept bring-your-own credentials). */
  subscriptions: { providerSlug: string; usable: boolean }[];
}

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
 * one status row per managed-capable harness, sorted by label.
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
    .filter((harness) => harness.credentialPolicy.managed)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((harness) => {
      const managed: HarnessStatusEntry['managed'] =
        firstDirect === undefined
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
