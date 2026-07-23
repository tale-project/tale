'use node';

/**
 * Org-level vision-model auto-selection for platform capabilities — today
 * the run_code vision lane (`tale-vision` transcribes images for a text-only
 * harness). This is NOT a user model picker: the user never chooses this
 * model, so per-user model-access rules don't apply; what matters is that
 * the org can actually pay for and reach the model.
 *
 * A provider participates when its DEFAULT credential is active and
 * gateway-servable (`api-key`/`env` — a subscription-flavored default
 * authenticates a specific harness directly and cannot back a gateway lane).
 * Auto-selection deliberately reads only defaults: picking a non-default
 * credential is a user act, never something a background capability does.
 *
 * Among the reachable vision-capable chat models the CHEAPEST by input price
 * wins (the lane bulk-transcribes screenshots; cheap is correct), with
 * unpriced entries last and a stable (price, provider, id) tie-break so the
 * pick is deterministic across runs.
 */

import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { getConnectorCatalog } from './catalog_fetch';
import { resolveConnectorsForOrgId } from './org_connectors';

/** The default-credential fields this module reads (the internal query
 * returns the full row as `v.any()`). */
interface DefaultCredentialFacts {
  authMethod: 'api-key' | 'env' | 'subscription-key' | 'subscription-broker';
  status: 'active' | 'disabled';
  modelAllowlist?: string[];
}

export interface VisionModelPick {
  providerSlug: string;
  modelId: string;
}

export async function resolveOrgVisionModel(
  ctx: ActionCtx,
  organizationId: string,
): Promise<VisionModelPick | null> {
  let best: {
    pick: VisionModelPick;
    price: number;
  } | null = null;

  for (const connector of await resolveConnectorsForOrgId(
    ctx,
    organizationId,
  )) {
    const row = (await ctx.runQuery(
      internal.provider_credentials.queries.getDefaultCredentialInternal,
      { organizationId, providerSlug: connector.name },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the internal query returns the full row as v.any(); this names the fields read here
    )) as DefaultCredentialFacts | null;
    // Only api-key/env credentials can back the gateway lane — every
    // subscription flavor is bound to its own harness.
    if (
      !row ||
      row.status !== 'active' ||
      (row.authMethod !== 'api-key' && row.authMethod !== 'env')
    ) {
      continue;
    }

    let entries;
    try {
      entries = await getConnectorCatalog(connector);
    } catch (err) {
      console.warn(
        `[vision-model] catalog for ${connector.name} unavailable (skipping provider):`,
        err,
      );
      continue;
    }

    for (const entry of entries) {
      if (!entry.supportsVision || !entry.tags.includes('chat')) continue;
      if (
        row.modelAllowlist !== undefined &&
        row.modelAllowlist.length > 0 &&
        !row.modelAllowlist.includes(entry.id)
      ) {
        continue;
      }
      const price =
        entry.pricing?.inputCentsPerMillion ?? Number.POSITIVE_INFINITY;
      const pick = { providerSlug: connector.name, modelId: entry.id };
      if (
        !best ||
        price < best.price ||
        (price === best.price &&
          (pick.providerSlug < best.pick.providerSlug ||
            (pick.providerSlug === best.pick.providerSlug &&
              pick.modelId < best.pick.modelId)))
      ) {
        best = { pick, price };
      }
    }
  }
  return best?.pick ?? null;
}
