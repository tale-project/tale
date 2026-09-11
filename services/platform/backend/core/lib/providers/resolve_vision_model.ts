'use node';

/**
 * Which model reads images for a text-only harness — the vision polyfill
 * (`tale-vision` transcribing a screenshot the serving model cannot see).
 * This is NOT a user model picker: the user never chooses this model, so
 * per-user model-access rules don't apply; what matters is that the org can
 * actually pay for and reach the model.
 *
 * Three sources, in order:
 *
 *  1. **Pinned** — the `vision_model` governance policy names a provider and
 *     model. An admin pinning one is the escape hatch from auto-selection
 *     drift, so it wins outright; it still has to be servable (same
 *     eligibility as below). A pin that stopped being servable refuses the
 *     turn instead of sending images to an unselected provider or model.
 *  2. **Preferred** — the first {@link PREFERRED_VISION_MODELS} entry the org
 *     can reach. A curated known-good vision model beats an unknown model
 *     that merely prices lower.
 *  3. **Cheapest** — the reachable vision-capable chat model with the lowest
 *     input price (the lane bulk-transcribes screenshots; cheap is correct),
 *     unpriced entries last, with a stable (price, provider, id) tie-break so
 *     the pick is deterministic across runs.
 *
 * A provider participates when its DEFAULT credential is active and
 * gateway-servable (`api-key`/`env` — a subscription-flavored default
 * authenticates a specific harness directly and cannot back a gateway lane).
 * Auto-selection deliberately reads only defaults: picking a non-default
 * credential is a user act, never something a background capability does.
 *
 * "Vision-capable chat model" is stricter here than the catalog tags: media
 * generators (image in, audio/image/video out) and free-tier lanes are
 * excluded — both list a token price of 0 and would otherwise always win the
 * sort, and both refuse the actual transcription call (provider 400s /
 * free-tier 401 storms, each observed live).
 */

import { visionModelConfigSchema } from '../../../../lib/shared/schemas/governance';
import type { ModelCatalogEntry } from '../../../../lib/shared/schemas/providers';
import {
  modelAllowlistPermits,
  modelIdsEquivalent,
} from '../../../../lib/shared/utils/model-ref';
import type { ActionCtx } from '../ctx';
import { internal } from '../handler_names';
import { getProviderCatalog } from './catalog_fetch';
import { resolveProvidersForOrgId } from './org_providers';

/**
 * Curated vision models, best first — tried before the price sort.
 *
 * The price sort reads a LIVE catalog, so "cheapest reachable" tracks
 * whatever a provider listed most recently and says nothing about whether the
 * model transcribes a screenshot well. A short curated head keeps the common
 * case on a known-good model while the sort stays as the universal fallback.
 * Matched with {@link modelIdsEquivalent}, so one entry covers every
 * provider's spelling of the same model.
 */
export const PREFERRED_VISION_MODELS: readonly string[] = [
  'qwen/qwen3-vl-32b-instruct',
];

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
  /** Which of the three sources produced this pick — the only honest way for
   * a settings surface or a log line to explain itself. */
  source: 'pinned' | 'preferred' | 'cheapest';
}

type VisionModelPolicyCode =
  | 'VISION_MODEL_POLICY_INVALID'
  | 'VISION_MODEL_POLICY_UNAVAILABLE'
  | 'VISION_MODEL_UNAVAILABLE'
  | 'VISION_MODEL_RESOLUTION_FAILED';

/** Safe to carry into a failed agent node: no provider response or credentials. */
export class VisionModelPolicyError extends Error {
  constructor(
    readonly code: VisionModelPolicyCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'VisionModelPolicyError';
  }
}

type VisionModelPin = { providerSlug: string; modelId: string } | null;

function pinnedResolutionFailure(error: unknown): VisionModelPolicyError {
  return error instanceof VisionModelPolicyError
    ? error
    : new VisionModelPolicyError(
        'VISION_MODEL_RESOLUTION_FAILED',
        'The pinned vision model could not be resolved. Restore its provider or credential and retry the run.',
      );
}

/**
 * The vision-polyfill pick for one MANAGED turn: `null` when the serving
 * model itself reads images (arming the polyfill would needlessly downgrade
 * them to text descriptions), else the org's auto-selected vision model.
 * Auto remains best-effort. When native vision cannot be established, an
 * explicit policy must resolve its required polyfill before inference.
 */
export async function resolveTurnVisionModel(
  ctx: ActionCtx,
  organizationId: string,
  target: { providerSlug: string; modelId: string },
): Promise<VisionModelPick | null> {
  let discovery:
    | { providers: Awaited<ReturnType<typeof resolveProvidersForOrgId>> }
    | { error: unknown };
  try {
    const providers = await resolveProvidersForOrgId(ctx, organizationId);
    const provider = providers.find(
      (entry) => entry.name === target.providerSlug,
    );
    if (provider) {
      const entry = (await getProviderCatalog(provider)).find(
        (candidate) => candidate.id === target.modelId,
      );
      if (entry?.supportsVision) return null;
    }
    discovery = { providers };
  } catch (error) {
    discovery = { error };
  }

  // A failed target lookup must not bypass an explicit routing policy.
  // Only the proven native-vision return above can avoid this fresh read.
  const pinned = await readPinnedVisionModel(ctx, organizationId);
  try {
    if ('error' in discovery) throw discovery.error;
    return await resolveVisionModel(
      ctx,
      organizationId,
      discovery.providers,
      pinned,
    );
  } catch (err) {
    if (pinned !== null) throw pinnedResolutionFailure(err);
    console.warn(
      '[vision-model] turn vision resolution failed (turn proceeds text-only):',
      err,
    );
    return null;
  }
}

/**
 * Is this catalog entry usable as a transcription model at all? The tag says
 * "sees images"; these exclusions say "and answers a text question about
 * one", which is a narrower claim the tags do not make.
 */
function isEligibleVisionEntry(
  entry: ModelCatalogEntry,
  allowlist: readonly string[] | undefined,
): boolean {
  if (!entry.supportsVision || !entry.tags.includes('chat')) return false;
  // A media GENERATOR (Lyria music, image/video models) is not a
  // transcription model, however its listing reads: it may take image input
  // and emit some text, but an image→text chat call to it is a provider 400
  // (observed live: every Read of a task run refused), and its 0 token price
  // is a per-artifact-billing artifact, not "cheap".
  if (entry.outputsMedia === true) return false;
  // Free-tier lanes are unfit for a background capability: they sit behind
  // per-account data-policy gates and hard rate caps, so the "cheapest" pick
  // turns into a turn-long 401 storm (observed live). The `:free` suffix
  // marks OpenRouter's free variants; an all-zero token price marks the rest
  // of the class (e.g. the `openrouter/free` router). Real, priced models
  // start fractions of a cent per million — skipping the free shapes costs
  // nothing.
  if (entry.id.endsWith(':free')) return false;
  if (
    entry.pricing !== undefined &&
    entry.pricing.inputCentsPerMillion === 0 &&
    entry.pricing.outputCentsPerMillion === 0
  ) {
    return false;
  }
  // The shared allowlist predicate (dialect-equivalent ids admit), as every
  // other lane applies it; an EMPTY allowlist stays "unrestricted" here.
  if (
    allowlist !== undefined &&
    allowlist.length > 0 &&
    !modelAllowlistPermits(allowlist, entry.id)
  ) {
    return false;
  }
  return true;
}

/** One provider's eligible vision entries, or `null` when the provider itself
 * is out (no gateway-servable active default credential, or a dead catalog). */
async function eligibleEntriesFor(
  ctx: ActionCtx,
  organizationId: string,
  provider: Awaited<ReturnType<typeof resolveProvidersForOrgId>>[number],
  pinned = false,
): Promise<readonly ModelCatalogEntry[] | null> {
  const row: DefaultCredentialFacts | null = await ctx.runQuery(
    internal.provider_credentials.queries.getDefaultCredentialInternal,
    { organizationId, providerSlug: provider.name },
  );
  // Only api-key/env credentials can back the gateway lane — every
  // subscription flavor is bound to its own harness.
  if (
    !row ||
    row.status !== 'active' ||
    (row.authMethod !== 'api-key' && row.authMethod !== 'env')
  ) {
    return null;
  }
  let entries: readonly ModelCatalogEntry[];
  try {
    entries = await getProviderCatalog(provider);
  } catch (err) {
    if (pinned) throw err;
    console.warn(
      `[vision-model] catalog for ${provider.name} unavailable (skipping provider):`,
      err,
    );
    return null;
  }
  return entries.filter((entry) =>
    isEligibleVisionEntry(entry, row.modelAllowlist),
  );
}

/** The admin's pin, or `null` only when the policy is absent or explicitly Auto. */
async function readPinnedVisionModel(
  ctx: ActionCtx,
  organizationId: string,
): Promise<VisionModelPin> {
  let raw: unknown;
  try {
    raw = await ctx.runQuery(
      internal.governance.internal_queries.getPolicyConfigInternal,
      { organizationId, policyType: 'vision_model' },
    );
  } catch {
    throw new VisionModelPolicyError(
      'VISION_MODEL_POLICY_UNAVAILABLE',
      'The vision policy could not be read. Restore valid governance configuration and retry the run.',
    );
  }
  if (raw === null || raw === undefined) return null;
  const parsed = visionModelConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new VisionModelPolicyError(
      'VISION_MODEL_POLICY_INVALID',
      'The vision policy is invalid. Set both provider and model, or explicitly choose Auto, before retrying the run.',
    );
  }
  const { providerSlug, modelId } = parsed.data;
  if (providerSlug === undefined || modelId === undefined) return null;
  return { providerSlug, modelId };
}

export async function resolveOrgVisionModel(
  ctx: ActionCtx,
  organizationId: string,
): Promise<VisionModelPick | null> {
  const pinned = await readPinnedVisionModel(ctx, organizationId);
  try {
    const providers = await resolveProvidersForOrgId(ctx, organizationId);
    return await resolveVisionModel(ctx, organizationId, providers, pinned);
  } catch (error) {
    if (pinned !== null) throw pinnedResolutionFailure(error);
    throw error;
  }
}

async function resolveVisionModel(
  ctx: ActionCtx,
  organizationId: string,
  providers: Awaited<ReturnType<typeof resolveProvidersForOrgId>>,
  pinned: VisionModelPin,
): Promise<VisionModelPick | null> {
  if (pinned !== null) {
    const provider = providers.find(
      (candidate) => candidate.name === pinned.providerSlug,
    );
    const entries =
      provider === undefined
        ? null
        : await eligibleEntriesFor(ctx, organizationId, provider, true);
    if (entries?.some((entry) => entry.id === pinned.modelId)) {
      return { ...pinned, source: 'pinned' };
    }
    throw new VisionModelPolicyError(
      'VISION_MODEL_UNAVAILABLE',
      'The pinned vision model is not servable. Check its provider, active default credential, model allowlist and vision capability before retrying the run.',
    );
  }

  let preferred: { pick: VisionModelPick; rank: number } | null = null;
  let cheapest: { pick: VisionModelPick; price: number } | null = null;

  for (const provider of providers) {
    const entries = await eligibleEntriesFor(ctx, organizationId, provider);
    if (entries === null) continue;

    for (const entry of entries) {
      const rank = PREFERRED_VISION_MODELS.findIndex((candidate) =>
        modelIdsEquivalent(candidate, entry.id),
      );
      if (rank !== -1 && (preferred === null || rank < preferred.rank)) {
        preferred = {
          pick: {
            providerSlug: provider.name,
            modelId: entry.id,
            source: 'preferred',
          },
          rank,
        };
      }

      const price =
        entry.pricing?.inputCentsPerMillion ?? Number.POSITIVE_INFINITY;
      const pick: VisionModelPick = {
        providerSlug: provider.name,
        modelId: entry.id,
        source: 'cheapest',
      };
      if (
        !cheapest ||
        price < cheapest.price ||
        (price === cheapest.price &&
          (pick.providerSlug < cheapest.pick.providerSlug ||
            (pick.providerSlug === cheapest.pick.providerSlug &&
              pick.modelId < cheapest.pick.modelId)))
      ) {
        cheapest = { pick, price };
      }
    }
  }

  const resolved = preferred?.pick ?? cheapest?.pick ?? null;
  if (resolved !== null) {
    // The one place every lane's pick is logged — the task, automation, and
    // run_code lanes all land here, so a wrong pick is greppable without a
    // gateway request log (how the Lyria misroute had to be found).
    console.log(
      `[vision-model] resolved ${resolved.providerSlug}/${resolved.modelId} for ${organizationId} (${resolved.source})`,
    );
  } else {
    console.warn(
      `[vision-model] no vision-capable model is reachable for ${organizationId} — image reading stays unavailable`,
    );
  }
  return resolved;
}
