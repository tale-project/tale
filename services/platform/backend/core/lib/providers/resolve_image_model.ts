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
 * — the same admission the transcription lane applies — and that return
 * raster images: the platform stores no SVG, so a vector model could serve
 * no call.
 *
 * The wire follows the provider: OpenRouter's dedicated Image API for an
 * OpenRouter connector, the OpenAI images API for every other. The latter
 * is what OpenAI-compatible servers implement, so an admin may PIN such a
 * provider's image model; automatic selection only uses the two providers
 * whose image APIs were verified against their documentation.
 *
 * With the organization's EU/EEA processing rule on (GOV-R17), a model
 * whose endpoint the rule refuses is passed over by automatic selection; a
 * pin it refuses, or an automatic selection left with nothing else, is
 * refused with the rule's sentence before any prompt is sent.
 */

import { imageGenerationConfigSchema } from '@tale/shared/schemas/governance';
import {
  IMAGE_GENERATION_TAG,
  type ModelCatalogEntry,
  type ProviderDefinition,
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
import {
  type HiddenModelsRule,
  type ModelEndpointActor,
  type ModelEndpointPolicy,
  ModelEndpointRefusal,
  type ModelEndpointRefusalCode,
  type ModelEndpointRefusalData,
  modelEndpointRefusal,
  readModelEndpointPolicy,
  refuseModelEndpoint,
  withoutRefusedModels,
} from '../../governance/model_endpoint_gate';
import {
  isTerminalCredentialRefusal,
  resolveProviderCredential,
} from '../../provider_credentials/resolve_credential';
import { ConfigurationError } from '../config_store/precondition';
import type { ActionCtx } from '../ctx';
import { internal } from '../handler_names';
import { directActiveCredential } from './direct_credential';
import { RASTER_MEDIA_TYPES, type ImageGenerationWire } from './image_wire';
import { resolveProvidersForOrgId } from './org_providers';
import { getServableCatalog } from './servable_catalog';

/**
 * Curated image models, best first. Matched with {@link modelIdsEquivalent},
 * so one entry covers every provider's spelling of the same model
 * (`gpt-image-2.5-flare` on OpenAI is `openai/gpt-image-2.5-flare` on
 * OpenRouter).
 *
 * Gemini 2.5 Flash Image leads: fast, cheap per image and good at edits from
 * reference images. GPT Image 2.5 Flare follows for an organization that
 * only holds an OpenAI key — OpenAI's fast everyday image model, and the
 * successor it names for GPT Image 1, shut down on 2026-10-23, and for GPT
 * Image 1 Mini. The Mini stays behind it for a credential whose allowlist
 * admits only the Mini, until OpenAI shuts it down on 2026-12-01: remove it
 * here and from the OpenAI catalog then. FLUX.2 Pro closes the list as a
 * strong text-to-image model. No edit model is curated: it cannot draw from
 * a description alone.
 */
const PREFERRED_IMAGE_MODELS: readonly string[] = [
  'google/gemini-2.5-flash-image',
  'gpt-image-2.5-flare',
  'gpt-image-1-mini',
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
  /** The fewest reference images one request may carry, when the catalog
   * entry says: above 0, an edit model that cannot draw from a prompt
   * alone. */
  minReferenceImages?: number;
  /** The most reference images one request may carry, when the catalog
   * entry says. */
  maxReferenceImages?: number;
  /** The aspect ratios the model draws, when the catalog entry lists them:
   * a request asks for the one closest to the shape the agent wants. */
  aspectRatios?: readonly string[];
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
 * a pin may name, and what a turn would resolve right now. A model the
 * organization's EU/EEA rule refuses is not offered, and `modelsHiddenBy`
 * says the rule left some out (GOV-R22). */
export interface ImageGenerationStatus {
  enabled: boolean;
  models: ImageModelOption[];
  modelsHiddenBy?: HiddenModelsRule;
  pick: ImageModelPick | null;
  error?: { code: ImageGenerationErrorCode | ModelEndpointRefusalCode };
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

/** The candidate a policy selects, and the refusal the EU/EEA rule gives
 * it when it gives one. */
interface ImageSelection {
  candidate: Candidate;
  source: ImageModelPick['source'];
  refusal?: ModelEndpointRefusalData;
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

/** The output formats, as image APIs name them, of the raster images the
 * platform stores (`image_wire.ts`): `png`, `jpeg`, `webp`, `gif`. */
const RASTER_OUTPUT_FORMATS = new Set<string>(
  RASTER_MEDIA_TYPES.map((mediaType) => mediaType.slice('image/'.length)),
);

/** Whether the entry returns an image the platform stores, as far as its
 * catalog facts say: a vector model returns only SVG, which is refused
 * (Recraft's vector models). Unknown facts admit. */
function returnsRaster(entry: ModelCatalogEntry): boolean {
  const formats = entry.imageGeneration?.outputFormats;
  return (
    formats === undefined ||
    formats.some((format) => {
      const name = format.toLowerCase();
      return RASTER_OUTPUT_FORMATS.has(name === 'jpg' ? 'jpeg' : name);
    })
  );
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
  if (!returnsRaster(entry)) return false;
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
        const references = entry.imageGeneration?.referenceImages;
        const minReferenceImages =
          references !== undefined && references.min > 0
            ? references.min
            : undefined;
        const maxReferenceImages = references?.max;
        const aspectRatios = entry.imageGeneration?.aspectRatios;
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
            acceptsImageInput: entry.supportsVision && maxReferenceImages !== 0,
            ...(minReferenceImages !== undefined ? { minReferenceImages } : {}),
            ...(maxReferenceImages !== undefined ? { maxReferenceImages } : {}),
            ...(aspectRatios !== undefined ? { aspectRatios } : {}),
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

/** The organization's EU/EEA rule on the endpoint `candidate` calls. */
function candidateRefusal(
  endpointPolicy: ModelEndpointPolicy,
  candidate: Candidate,
): ModelEndpointRefusalData | undefined {
  return modelEndpointRefusal(endpointPolicy, {
    providerName: candidate.providerSlug,
    baseUrl: candidate.resolved.baseUrl,
  });
}

/** The candidate a policy selects, or the coded reason there is none.
 * Automatic selection passes over a candidate the organization's EU/EEA
 * rule refuses. A pin the rule refuses comes back with its refusal, and so
 * does the best refused candidate when nothing else can serve and no
 * provider failed (a failed one might have served from the region). */
function selectCandidate(
  discovery: Awaited<ReturnType<typeof imageCandidates>>,
  pin: ImageModelPin,
  endpointPolicy: ModelEndpointPolicy,
): ImageSelection {
  const refusalOf = (candidate: Candidate) =>
    candidateRefusal(endpointPolicy, candidate);
  if (pin !== null) {
    const pinned = discovery.candidates.find(
      (candidate) =>
        candidate.providerSlug === pin.providerSlug &&
        candidate.modelId === pin.modelId,
    );
    if (pinned !== undefined) {
      const refusal = refusalOf(pinned);
      return {
        candidate: pinned,
        source: 'pinned',
        ...(refusal !== undefined ? { refusal } : {}),
      };
    }
    throw new ImageGenerationError(
      discovery.failures.has(pin.providerSlug)
        ? 'IMAGE_GENERATION_RESOLUTION_FAILED'
        : 'IMAGE_GENERATION_MODEL_UNAVAILABLE',
    );
  }
  let best: { candidate: Candidate; rank: number } | null = null;
  let refused: {
    candidate: Candidate;
    rank: number;
    refusal: ModelEndpointRefusalData;
  } | null = null;
  for (const candidate of discovery.candidates) {
    if (!candidate.verifiedWire) continue;
    const rank = PREFERRED_IMAGE_MODELS.findIndex((preferred) =>
      modelIdsEquivalent(preferred, candidate.modelId),
    );
    if (rank === -1) continue;
    const refusal = refusalOf(candidate);
    if (refusal === undefined) {
      if (best === null || rank < best.rank) best = { candidate, rank };
    } else if (refused === null || rank < refused.rank) {
      refused = { candidate, rank, refusal };
    }
  }
  if (best !== null) return { candidate: best.candidate, source: 'preferred' };
  if (refused !== null && discovery.failures.size === 0) {
    return {
      candidate: refused.candidate,
      source: 'preferred',
      refusal: refused.refusal,
    };
  }
  throw new ImageGenerationError(
    discovery.failures.size > 0
      ? 'IMAGE_GENERATION_RESOLUTION_FAILED'
      : 'NO_IMAGE_GENERATION_MODEL',
  );
}

/**
 * The model one generation call runs on: `null` while the policy is off,
 * the resolved model while it is on, a coded {@link ImageGenerationError}
 * when it is on and nothing can serve it, and a {@link ModelEndpointRefusal}
 * when the organization's EU/EEA rule refuses the model it would use. A
 * call's refusal is audited; a turn only being offered the tool (`offer`)
 * has asked for no image, so its refusal is thrown without an entry.
 */
export async function resolveImageGenerationModel(
  ctx: ActionCtx,
  organizationId: string,
  opts: { readonly offer?: boolean; readonly actor?: ModelEndpointActor } = {},
): Promise<ResolvedImageModel | null> {
  const policy = await readImageGenerationPolicy(ctx, organizationId);
  if (!policy.enabled) return null;
  let discovery: Awaited<ReturnType<typeof imageCandidates>>;
  let endpointPolicy: ModelEndpointPolicy;
  try {
    discovery = await imageCandidates(
      ctx,
      organizationId,
      policy.pin?.providerSlug,
    );
    endpointPolicy = await readModelEndpointPolicy(ctx, organizationId);
  } catch (error) {
    console.warn('[image-model] resolution failed:', error);
    throw new ImageGenerationError('IMAGE_GENERATION_RESOLUTION_FAILED');
  }
  const { candidate, source, refusal } = selectCandidate(
    discovery,
    policy.pin,
    endpointPolicy,
  );
  if (refusal !== undefined) {
    if (opts.offer === true) throw new ModelEndpointRefusal(refusal);
    await refuseModelEndpoint(
      ctx,
      {
        organizationId,
        surface: 'image-generation',
        providerName: candidate.providerSlug,
        modelId: candidate.modelId,
        ...(opts.actor !== undefined ? { actor: opts.actor } : {}),
      },
      refusal,
    );
  }
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
    const resolved = await resolveImageGenerationModel(ctx, organizationId, {
      offer: true,
    });
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
      error instanceof ImageGenerationError
        ? error.code
        : error instanceof ModelEndpointRefusal
          ? error.data.code
          : error,
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
  let endpointPolicy: ModelEndpointPolicy;
  try {
    discovery = await imageCandidates(ctx, organizationId);
    endpointPolicy = await readModelEndpointPolicy(ctx, organizationId);
  } catch (caught) {
    console.warn('[image-model] model discovery failed:', caught);
    return {
      enabled: policy.enabled,
      models: [],
      pick: null,
      error: { code: error?.code ?? 'IMAGE_GENERATION_RESOLUTION_FAILED' },
    };
  }
  // A model whose endpoint the EU/EEA rule refuses is not offered: a pin on
  // it would be refused at every call (GOV-R22).
  const offered = withoutRefusedModels(
    endpointPolicy,
    discovery.candidates,
    (candidate) => candidateRefusal(endpointPolicy, candidate),
  );
  const models = offered.kept.map(
    ({ providerSlug, providerDisplayName, modelId }) => ({
      providerSlug,
      providerDisplayName,
      modelId,
    }),
  );
  const hidden =
    offered.hiddenBy !== undefined ? { modelsHiddenBy: offered.hiddenBy } : {};
  if (error !== undefined) {
    return {
      enabled: false,
      models,
      ...hidden,
      pick: null,
      error: { code: error.code },
    };
  }
  try {
    const { candidate, source, refusal } = selectCandidate(
      discovery,
      policy.pin,
      endpointPolicy,
    );
    if (refusal !== undefined) {
      return {
        enabled: policy.enabled,
        models,
        ...hidden,
        pick: null,
        error: { code: refusal.code },
      };
    }
    return {
      enabled: policy.enabled,
      models,
      ...hidden,
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
      ...hidden,
      pick: null,
      error: { code: caught.code },
    };
  }
}
