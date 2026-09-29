'use node';

/**
 * Which model generates images for an agent — the `generate_image`
 * workspace tool a project agent working a task, or an automation's agent
 * step, calls. Chat never generates images.
 *
 * Governed by the `image_generation` policy, and OFF until an admin turns
 * it on: a missing file, `enabled: false`, or an unreadable policy all leave
 * the tool out of every turn. When it is on, two sources, in order:
 *
 *  1. **Pinned** — the policy names a provider and model. The admin's
 *     choice wins outright, but it still has to be servable (the same
 *     admission as below). A pin that stopped being servable makes image
 *     generation unavailable; it never falls back to another model, which
 *     would spend on something nobody chose.
 *  2. **Preferred** — the first {@link PREFERRED_IMAGE_MODELS} entry the
 *     organization can reach through a provider whose image API the
 *     platform speaks natively (OpenRouter, OpenAI). Nothing else: image
 *     models bill per image, so a live catalog's price column says nothing
 *     about which one is fit to pick unattended.
 *
 * A provider is admitted when it speaks the OpenAI format and its DEFAULT
 * credential is active and API-servable (`api-key`/`env` — a subscription
 * flavor is bound to its own harness); its models are the servable catalog
 * entries tagged `image-generation` that the credential's allowlist admits
 * — the same admission the transcription lane applies.
 *
 * The wire follows the provider: OpenRouter's dedicated Image API for an
 * OpenRouter connector, the OpenAI images API for every other. The latter
 * is what OpenAI-compatible servers implement, so an admin may PIN such a
 * provider's image model; automatic selection only uses the two providers
 * whose image APIs were verified against their documentation.
 */

import { imageGenerationConfigSchema } from '@tale/shared/schemas/governance';
import type {
  ModelCatalogEntry,
  ProviderDefinition,
} from '@tale/shared/schemas/providers';
import {
  modelAllowlistPermits,
  modelIdsEquivalent,
} from '@tale/shared/utils/model-ref';

import { checkProviderHostPolicy } from '../../../../lib/net/host-policy';
import { AppError } from '../../../../lib/shared/errors/app-error';
import {
  isOpenRouterProvider,
  providerAttributionHeaders,
} from '../../../../lib/shared/providers/attribution';
import { IMAGE_GENERATION_TAG } from '../../../../lib/shared/providers/catalog_normalize';
import {
  isTerminalCredentialRefusal,
  resolveProviderCredential,
} from '../../provider_credentials/resolve_credential';
import { ConfigurationError } from '../config_store/precondition';
import type { ActionCtx } from '../ctx';
import { internal } from '../handler_names';
import { directActiveCredential } from './direct_credential';
import type { ImageGenerationWire } from './image_wire';
import { resolveProvidersForOrgId } from './org_providers';
import { getServableCatalog } from './servable_catalog';

/**
 * Curated image models, best first. Matched with {@link modelIdsEquivalent},
 * so one entry covers every provider's spelling of the same model
 * (`gpt-image-1` on OpenAI is `openai/gpt-image-1` on OpenRouter).
 *
 * Gemini 2.5 Flash Image leads: fast, cheap per image and good at edits from
 * reference images. The GPT image models follow for an organization that
 * only holds an OpenAI key (the mini first, at a fifth of the price), and
 * FLUX.2 Pro closes the list as a strong text-to-image model.
 */
const PREFERRED_IMAGE_MODELS: readonly string[] = [
  'google/gemini-2.5-flash-image',
  'gpt-image-1-mini',
  'gpt-image-1',
  'black-forest-labs/flux.2-pro',
];

export interface ImageModelOption {
  providerSlug: string;
  providerDisplayName: string;
  modelId: string;
}

export interface ImageModelPick {
  providerSlug: string;
  modelId: string;
  /** Why this model: the admin's pin, or the curated list. */
  source: 'pinned' | 'preferred';
}

/** Everything one generation call needs. Carries the credential secret, so
 * it never leaves the server: settings surfaces read {@link ImageModelPick}. */
export interface ResolvedImageModel extends ImageModelPick {
  providerDisplayName: string;
  wire: ImageGenerationWire;
  baseUrl: string;
  apiKey: string;
  /** App-attribution headers the provider reads (OpenRouter). */
  attribution: Record<string, string>;
  /** The model takes reference images (an edit, a variation). */
  acceptsImageInput: boolean;
  /** Catalog prices, for a provider that reports no cost of its own. */
  pricing?: ModelCatalogEntry['pricing'];
}

type ImageGenerationErrorCode =
  | 'NO_IMAGE_GENERATION_MODEL'
  | 'IMAGE_GENERATION_POLICY_INVALID'
  | 'IMAGE_GENERATION_POLICY_UNAVAILABLE'
  | 'IMAGE_GENERATION_MODEL_UNAVAILABLE'
  | 'IMAGE_GENERATION_RESOLUTION_FAILED';

/** Only fixed, non-secret sentences cross the tool and settings boundary:
 * each is written for the agent relaying it and the admin reading it. */
const IMAGE_GENERATION_ERROR_MESSAGES: Record<
  ImageGenerationErrorCode,
  string
> = {
  NO_IMAGE_GENERATION_MODEL:
    'No image model is available to this organization. An administrator connects a provider that serves one, or picks a model under Settings > Governance > Models.',
  IMAGE_GENERATION_POLICY_INVALID:
    'The image generation policy is invalid. An administrator saves it again under Settings > Governance > Models.',
  IMAGE_GENERATION_POLICY_UNAVAILABLE:
    'The image generation policy could not be read. An administrator restores the configuration before retrying.',
  IMAGE_GENERATION_MODEL_UNAVAILABLE:
    "The image model the organization's policy names is unavailable. An administrator restores its provider access or picks another model under Settings > Governance > Models.",
  IMAGE_GENERATION_RESOLUTION_FAILED:
    'The image model could not be resolved. Check the provider configuration and retry.',
};

export class ImageGenerationError extends AppError<{
  code: ImageGenerationErrorCode;
  message: string;
}> {
  constructor(readonly code: ImageGenerationErrorCode) {
    super({ code, message: IMAGE_GENERATION_ERROR_MESSAGES[code] });
    this.name = 'ImageGenerationError';
  }
}

/** What the settings surface shows: whether the policy is on, every model
 * a pin may name, and what a turn would resolve right now. */
export interface ImageGenerationStatus {
  enabled: boolean;
  models: ImageModelOption[];
  pick: ImageModelPick | null;
  error?: { code: ImageGenerationErrorCode };
}

type ImageModelPin = { providerSlug: string; modelId: string } | null;

interface ImageGenerationPolicy {
  enabled: boolean;
  pin: ImageModelPin;
}

interface Candidate extends ImageModelOption {
  /** Whether automatic selection may use this candidate's provider. */
  verifiedWire: boolean;
  resolved: Omit<ResolvedImageModel, 'source'>;
}

/** The provider's image wire, and whether the platform verified it against
 * the provider's documentation (only those may serve automatic selection).
 * `baseUrl` is the endpoint the call goes to — absent before the credential
 * is read, for a provider whose endpoint lives on its credential. */
function imageWireFor(
  provider: ProviderDefinition,
  baseUrl: string | undefined,
): {
  wire: ImageGenerationWire;
  verified: boolean;
} {
  if (
    provider.catalog.source === 'openrouter-api' ||
    (baseUrl !== undefined &&
      isOpenRouterProvider({ providerName: provider.name, baseUrl })) ||
    provider.name.toLowerCase() === 'openrouter'
  ) {
    return { wire: 'openrouter-images', verified: true };
  }
  let host = '';
  if (baseUrl !== undefined) {
    try {
      host = new URL(baseUrl).host.toLowerCase();
    } catch (error) {
      console.warn(
        `[image-model] unparseable base URL for provider ${provider.name}:`,
        error,
      );
    }
  }
  return { wire: 'openai-images', verified: host === 'api.openai.com' };
}

/** A catalog entry this provider can generate images with. */
function isImageEntry(
  entry: ModelCatalogEntry,
  wire: ImageGenerationWire,
  allowlist: readonly string[] | undefined,
): boolean {
  if (!entry.tags.includes(IMAGE_GENERATION_TAG)) return false;
  // OpenRouter's routers (`openrouter/auto`) list image output because the
  // model they route to may write images, but its Image API serves only
  // concrete models.
  if (wire === 'openrouter-images' && entry.id.startsWith('openrouter/')) {
    return false;
  }
  return modelAllowlistPermits(allowlist, entry.id);
}

/** The policy as it is on disk. Throws a coded error when it cannot be read
 * or parsed — never a silent "off" the settings surface could not explain,
 * and never a silent "on". */
async function readImageGenerationPolicy(
  ctx: ActionCtx,
  organizationId: string,
): Promise<ImageGenerationPolicy> {
  let raw: unknown;
  try {
    raw = await ctx.runQuery(
      internal.governance.internal_queries.getPolicyConfigInternal,
      { organizationId, policyType: 'image_generation' },
    );
  } catch (error) {
    throw new ImageGenerationError(
      error instanceof ConfigurationError &&
        error.code === 'GOVERNANCE_POLICY_INVALID'
        ? 'IMAGE_GENERATION_POLICY_INVALID'
        : 'IMAGE_GENERATION_POLICY_UNAVAILABLE',
    );
  }
  if (raw == null) return { enabled: false, pin: null };
  const parsed = imageGenerationConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ImageGenerationError('IMAGE_GENERATION_POLICY_INVALID');
  }
  const { enabled, providerSlug, modelId } = parsed.data;
  return {
    enabled,
    pin:
      providerSlug !== undefined && modelId !== undefined
        ? { providerSlug, modelId }
        : null,
  };
}

/** Every image model the organization's providers can serve right now, and
 * the providers whose discovery failed (a failure must not hide healthy
 * alternatives, nor read as "no model"). */
async function imageCandidates(
  ctx: ActionCtx,
  organizationId: string,
  providerSlug?: string,
): Promise<{ candidates: Candidate[]; failures: Set<string> }> {
  const providers = await resolveProvidersForOrgId(ctx, organizationId);
  const candidates: Candidate[] = [];
  const failures = new Set<string>();
  for (const provider of providers) {
    if (providerSlug !== undefined && provider.name !== providerSlug) continue;
    if (provider.apiFormat !== 'openai') continue;
    try {
      // The default credential decides what this provider may serve — read
      // first, so a credential-less provider costs no catalog fetch.
      const direct = directActiveCredential(
        await ctx.runQuery(
          internal.provider_credentials.queries.getDefaultCredentialInternal,
          { organizationId, providerSlug: provider.name },
        ),
      );
      if (direct === null) continue;
      const catalog = await getServableCatalog(provider, direct.modelAllowlist);
      // Narrow before the credential is decrypted: a provider without an
      // image model costs no secret read.
      const declaredWire = imageWireFor(provider, provider.baseUrl).wire;
      const entries = catalog.filter((entry) =>
        isImageEntry(entry, declaredWire, direct.modelAllowlist),
      );
      if (entries.length === 0) continue;
      const credential = await resolveProviderCredential(ctx, {
        organizationId,
        providerSlug: provider.name,
      });
      if (
        credential.authMethod !== 'api-key' &&
        credential.authMethod !== 'env'
      ) {
        continue;
      }
      const baseUrl = credential.endpointUrl ?? provider.baseUrl;
      if (!baseUrl) continue;
      checkProviderHostPolicy(baseUrl);
      const { wire, verified } = imageWireFor(provider, baseUrl);
      const attribution = providerAttributionHeaders({
        providerName: provider.name,
        baseUrl,
      });
      for (const entry of entries) {
        if (!isImageEntry(entry, wire, direct.modelAllowlist)) continue;
        candidates.push({
          providerSlug: provider.name,
          providerDisplayName: provider.displayName,
          modelId: entry.id,
          verifiedWire: verified,
          resolved: {
            providerSlug: provider.name,
            providerDisplayName: provider.displayName,
            modelId: entry.id,
            wire,
            baseUrl,
            apiKey: credential.secret,
            attribution,
            acceptsImageInput: entry.supportsVision,
            ...(entry.pricing !== undefined ? { pricing: entry.pricing } : {}),
          },
        });
      }
    } catch (error) {
      // A credential the resolver refuses until an admin acts serves
      // nothing, like a provider with no default credential: skipped, not a
      // failure that would read as "temporarily unavailable".
      if (isTerminalCredentialRefusal(error)) continue;
      console.warn(
        `[image-model] provider ${provider.name} unavailable for image generation:`,
        error instanceof Error ? error.message : error,
      );
      failures.add(provider.name);
    }
  }
  // Catalog order changes with a refresh; a stable order keeps the picker
  // and the automatic tie-break explainable.
  candidates.sort(
    (a, b) =>
      a.providerSlug.localeCompare(b.providerSlug) ||
      a.modelId.localeCompare(b.modelId),
  );
  return { candidates, failures };
}

/** The candidate a policy selects, or the coded reason there is none. */
function selectCandidate(
  discovery: Awaited<ReturnType<typeof imageCandidates>>,
  pin: ImageModelPin,
): { candidate: Candidate; source: ImageModelPick['source'] } {
  if (pin !== null) {
    const pinned = discovery.candidates.find(
      (candidate) =>
        candidate.providerSlug === pin.providerSlug &&
        candidate.modelId === pin.modelId,
    );
    if (pinned !== undefined) return { candidate: pinned, source: 'pinned' };
    throw new ImageGenerationError(
      discovery.failures.has(pin.providerSlug)
        ? 'IMAGE_GENERATION_RESOLUTION_FAILED'
        : 'IMAGE_GENERATION_MODEL_UNAVAILABLE',
    );
  }
  let best: { candidate: Candidate; rank: number } | null = null;
  for (const candidate of discovery.candidates) {
    if (!candidate.verifiedWire) continue;
    const rank = PREFERRED_IMAGE_MODELS.findIndex((preferred) =>
      modelIdsEquivalent(preferred, candidate.modelId),
    );
    if (rank !== -1 && (best === null || rank < best.rank)) {
      best = { candidate, rank };
    }
  }
  if (best !== null) return { candidate: best.candidate, source: 'preferred' };
  throw new ImageGenerationError(
    discovery.failures.size > 0
      ? 'IMAGE_GENERATION_RESOLUTION_FAILED'
      : 'NO_IMAGE_GENERATION_MODEL',
  );
}

/**
 * The model one generation call runs on: `null` while the policy is off,
 * the resolved model while it is on, a coded {@link ImageGenerationError}
 * when it is on and nothing can serve it.
 */
export async function resolveImageGenerationModel(
  ctx: ActionCtx,
  organizationId: string,
): Promise<ResolvedImageModel | null> {
  const policy = await readImageGenerationPolicy(ctx, organizationId);
  if (!policy.enabled) return null;
  let discovery: Awaited<ReturnType<typeof imageCandidates>>;
  try {
    discovery = await imageCandidates(
      ctx,
      organizationId,
      policy.pin?.providerSlug,
    );
  } catch (error) {
    console.warn('[image-model] resolution failed:', error);
    throw new ImageGenerationError('IMAGE_GENERATION_RESOLUTION_FAILED');
  }
  const { candidate, source } = selectCandidate(discovery, policy.pin);
  return { ...candidate.resolved, source };
}

/**
 * Whether a turn about to start gets the `generate_image` tool: the model
 * it would use, or `null` — policy off, unreadable, or nothing servable.
 * Never throws: a turn must not fail because an optional capability could
 * not be offered, and an absent tool is the honest answer (the agent is
 * never told about a tool it cannot call). One line per turn start names
 * the pick or the reason, so "why has my agent no images" is greppable.
 */
export async function resolveTurnImageGeneration(
  ctx: ActionCtx,
  organizationId: string,
): Promise<ImageModelPick | null> {
  try {
    const resolved = await resolveImageGenerationModel(ctx, organizationId);
    if (resolved === null) return null;
    console.log(
      `[image-model] resolved ${resolved.providerSlug}/${resolved.modelId} for ${organizationId} (${resolved.source})`,
    );
    return {
      providerSlug: resolved.providerSlug,
      modelId: resolved.modelId,
      source: resolved.source,
    };
  } catch (error) {
    console.warn(
      `[image-model] image generation not offered to this turn for ${organizationId}:`,
      error instanceof ImageGenerationError ? error.code : error,
    );
    return null;
  }
}

/** The settings view: the policy, every model a pin may name (the exact
 * admission a turn applies, no secrets), and the current pick. Never
 * throws; a failure is carried as its code. */
export async function inspectImageGenerationModels(
  ctx: ActionCtx,
  organizationId: string,
): Promise<ImageGenerationStatus> {
  let policy: ImageGenerationPolicy = { enabled: false, pin: null };
  let error: ImageGenerationError | undefined;
  try {
    policy = await readImageGenerationPolicy(ctx, organizationId);
  } catch (caught) {
    error =
      caught instanceof ImageGenerationError
        ? caught
        : new ImageGenerationError('IMAGE_GENERATION_POLICY_UNAVAILABLE');
  }
  let discovery: Awaited<ReturnType<typeof imageCandidates>>;
  try {
    discovery = await imageCandidates(ctx, organizationId);
  } catch (caught) {
    console.warn('[image-model] model discovery failed:', caught);
    return {
      enabled: policy.enabled,
      models: [],
      pick: null,
      error: { code: error?.code ?? 'IMAGE_GENERATION_RESOLUTION_FAILED' },
    };
  }
  const models = discovery.candidates.map(
    ({ providerSlug, providerDisplayName, modelId }) => ({
      providerSlug,
      providerDisplayName,
      modelId,
    }),
  );
  if (error !== undefined) {
    return { enabled: false, models, pick: null, error: { code: error.code } };
  }
  try {
    const { candidate, source } = selectCandidate(discovery, policy.pin);
    return {
      enabled: policy.enabled,
      models,
      pick: {
        providerSlug: candidate.providerSlug,
        modelId: candidate.modelId,
        source,
      },
    };
  } catch (caught) {
    if (!(caught instanceof ImageGenerationError)) throw caught;
    return {
      enabled: policy.enabled,
      models,
      pick: null,
      error: { code: caught.code },
    };
  }
}
