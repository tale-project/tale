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
import { getProviderCatalog } from './catalog_fetch';
import { resolveProvidersForOrgId } from './org_providers';

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

/**
 * The vision-polyfill pick for one MANAGED turn: `null` when the serving
 * model itself reads images (arming the polyfill would needlessly downgrade
 * them to text descriptions), else the org's auto-selected vision model.
 * Best-effort by design: any resolution failure logs and reads as "no
 * vision" — the turn proceeds text-only rather than failing to start.
 */
export async function resolveTurnVisionModel(
  ctx: ActionCtx,
  organizationId: string,
  target: { providerSlug: string; modelId: string },
): Promise<VisionModelPick | null> {
  try {
    const provider = (await resolveProvidersForOrgId(ctx, organizationId)).find(
      (entry) => entry.name === target.providerSlug,
    );
    if (provider) {
      const entry = (await getProviderCatalog(provider)).find(
        (candidate) => candidate.id === target.modelId,
      );
      if (entry?.supportsVision) return null;
    }
    return await resolveOrgVisionModel(ctx, organizationId);
  } catch (err) {
    console.warn(
      '[vision-model] turn vision resolution failed (turn proceeds text-only):',
      err,
    );
    return null;
  }
}

export async function resolveOrgVisionModel(
  ctx: ActionCtx,
  organizationId: string,
): Promise<VisionModelPick | null> {
  let best: {
    pick: VisionModelPick;
    price: number;
  } | null = null;

  for (const provider of await resolveProvidersForOrgId(ctx, organizationId)) {
    const row = (await ctx.runQuery(
      internal.provider_credentials.queries.getDefaultCredentialInternal,
      { organizationId, providerSlug: provider.name },
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
      entries = await getProviderCatalog(provider);
    } catch (err) {
      console.warn(
        `[vision-model] catalog for ${provider.name} unavailable (skipping provider):`,
        err,
      );
      continue;
    }

    for (const entry of entries) {
      if (!entry.supportsVision || !entry.tags.includes('chat')) continue;
      // Free-tier variants (OpenRouter `:free`) are unfit for a background
      // capability: they sit behind per-account data-policy gates and hard
      // rate caps, so the "cheapest" pick turns into a turn-long 401 storm
      // (observed live: every vision call of a task run refused). They only
      // ever win the price sort at 0, so skipping them costs nothing.
      if (entry.id.endsWith(':free')) continue;
      if (
        row.modelAllowlist !== undefined &&
        row.modelAllowlist.length > 0 &&
        !row.modelAllowlist.includes(entry.id)
      ) {
        continue;
      }
      const price =
        entry.pricing?.inputCentsPerMillion ?? Number.POSITIVE_INFINITY;
      const pick = { providerSlug: provider.name, modelId: entry.id };
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
