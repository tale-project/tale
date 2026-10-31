'use node';

/**
 * Organization-wide audio routing shared by settings, composer capabilities,
 * server dictation and file/video transcription. Missing/empty policy is Automatic;
 * an explicit pin must resolve or fail without choosing another model.
 *
 * Only `openai`-format connectors qualify: the transcription wire is the
 * OpenAI `/audio/transcriptions` shape, and the Anthropic Messages format
 * has no transcription endpoint at all.
 *
 * With the organization's EU/EEA processing rule on (GOV-R17), Automatic
 * passes over a model whose endpoint the rule refuses; a pin it refuses, or
 * an Automatic choice left with nothing else, is refused with the rule's
 * sentence before any audio is sent.
 */

import { transcriptionModelConfigSchema } from '@tale/shared/schemas/governance';
import { modelAllowlistPermits } from '@tale/shared/utils/model-ref';

import { checkProviderHostPolicy } from '../../../../lib/net/host-policy';
import { AppError } from '../../../../lib/shared/errors/app-error';
import { isOpenRouterProvider } from '../../../../lib/shared/providers/attribution';
import {
  type HiddenModelsRule,
  type ModelEndpointActor,
  type ModelEndpointPolicy,
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
import { resolveProvidersForOrgId } from './org_providers';
import { getServableCatalog } from './servable_catalog';

export interface ResolvedTranscriptionModel {
  readonly modelId: string;
  readonly providerName: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  /** OpenRouter STT models share JSON support; verbose output varies by model. */
  readonly responseFormat?: 'json' | 'verbose_json';
  /** The catalog's price per minute of audio, when it names one. */
  readonly centsPerAudioMinute?: number;
}

export interface TranscriptionModelOption {
  providerSlug: string;
  providerDisplayName: string;
  modelId: string;
}

export interface TranscriptionModelPick {
  providerSlug: string;
  modelId: string;
  source: 'automatic' | 'pinned';
}

type TranscriptionModelErrorCode =
  | 'NO_TRANSCRIPTION_MODEL'
  | 'TRANSCRIPTION_MODEL_POLICY_INVALID'
  | 'TRANSCRIPTION_MODEL_POLICY_UNAVAILABLE'
  | 'TRANSCRIPTION_MODEL_UNAVAILABLE'
  | 'TRANSCRIPTION_MODEL_RESOLUTION_FAILED';

/** Only fixed, non-secret messages cross the capability/worker boundary. */
export class TranscriptionModelError extends AppError<{
  code: TranscriptionModelErrorCode;
  message: string;
}> {
  constructor(readonly code: TranscriptionModelErrorCode) {
    const messages: Record<TranscriptionModelErrorCode, string> = {
      NO_TRANSCRIPTION_MODEL:
        'No transcription model is configured for this organization.',
      TRANSCRIPTION_MODEL_POLICY_INVALID:
        'The transcription model policy is invalid. Choose Automatic or a provider and model in Settings.',
      TRANSCRIPTION_MODEL_POLICY_UNAVAILABLE:
        'The transcription model policy could not be read. Restore the configuration before retrying.',
      TRANSCRIPTION_MODEL_UNAVAILABLE:
        'The selected transcription model is unavailable. Restore its provider access or choose another model in Settings.',
      TRANSCRIPTION_MODEL_RESOLUTION_FAILED:
        'The transcription model could not be resolved. Check the provider configuration and retry.',
    };
    super({ code, message: messages[code] });
  }
}

/** A model the organization's EU/EEA rule refuses is not offered, and
 * `modelsHiddenBy` says the rule left some out (GOV-R22). */
export interface TranscriptionModelStatus {
  models: TranscriptionModelOption[];
  modelsHiddenBy?: HiddenModelsRule;
  pick: TranscriptionModelPick | null;
  error?: { code: TranscriptionModelErrorCode | ModelEndpointRefusalCode };
}

type TranscriptionModelPin = { providerSlug: string; modelId: string } | null;
interface Candidate extends TranscriptionModelOption {
  resolved: ResolvedTranscriptionModel;
}

/** The candidate a policy selects, and the refusal the EU/EEA rule gives
 * it when it gives one. */
interface TranscriptionSelection {
  candidate: Candidate;
  refusal?: ModelEndpointRefusalData;
}

async function readPin(
  ctx: ActionCtx,
  organizationId: string,
): Promise<TranscriptionModelPin> {
  let raw: unknown;
  try {
    raw = await ctx.runQuery(
      internal.governance.internal_queries.getPolicyConfigInternal,
      { organizationId, policyType: 'transcription_model' },
    );
  } catch (error) {
    throw new TranscriptionModelError(
      error instanceof ConfigurationError &&
        error.code === 'GOVERNANCE_POLICY_INVALID'
        ? 'TRANSCRIPTION_MODEL_POLICY_INVALID'
        : 'TRANSCRIPTION_MODEL_POLICY_UNAVAILABLE',
    );
  }
  if (raw == null) return null;
  const parsed = transcriptionModelConfigSchema.safeParse(raw);
  if (!parsed.success)
    throw new TranscriptionModelError('TRANSCRIPTION_MODEL_POLICY_INVALID');
  const { providerSlug, modelId } = parsed.data;
  return providerSlug !== undefined && modelId !== undefined
    ? { providerSlug, modelId }
    : null;
}

async function candidatesFor(
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
    // The default credential decides what this provider may serve — read
    // it first so a credential-less provider costs no catalog fetch and an
    // allowlisted one is narrowed the way the composer's flag is.
    try {
      const direct = directActiveCredential(
        await ctx.runQuery(
          internal.provider_credentials.queries.getDefaultCredentialInternal,
          { organizationId, providerSlug: provider.name },
        ),
      );
      if (direct === null) continue;
      const catalog = await getServableCatalog(
        provider,
        direct.modelAllowlist,
        {
          requiredCapability: 'transcription',
        },
      );
      const entries = catalog.filter(
        (candidate) =>
          candidate.tags.includes('transcription') &&
          modelAllowlistPermits(direct.modelAllowlist, candidate.id),
      );
      if (entries.length === 0) continue;
      const credential = await resolveProviderCredential(ctx, {
        organizationId,
        providerSlug: provider.name,
      });
      if (
        credential.authMethod !== 'api-key' &&
        credential.authMethod !== 'env'
      )
        continue;
      const baseUrl = credential.endpointUrl ?? provider.baseUrl;
      if (!baseUrl) continue;
      checkProviderHostPolicy(baseUrl);
      for (const entry of entries) {
        candidates.push({
          providerSlug: provider.name,
          providerDisplayName: provider.displayName,
          modelId: entry.id,
          resolved: {
            modelId: entry.id,
            providerName: provider.name,
            baseUrl,
            apiKey: credential.secret,
            ...(entry.transcription?.centsPerAudioMinute !== undefined
              ? {
                  centsPerAudioMinute: entry.transcription.centsPerAudioMinute,
                }
              : {}),
            ...(provider.catalog.source === 'openrouter-api' ||
            isOpenRouterProvider({ providerName: provider.name, baseUrl })
              ? { responseFormat: 'json' as const }
              : {}),
          },
        });
      }
    } catch (error) {
      // A credential the resolver refuses until an admin acts (disabled, a
      // rotated key, an unset env var) serves nothing, like a provider with
      // no default credential: skipped, never a failure — which reads as
      // "temporarily unavailable" and is retried with the same refusal.
      if (isTerminalCredentialRefusal(error)) continue;
      // A failed provider cannot hide healthy alternatives in Automatic.
      // Do not reflect catalog responses, endpoints or credential material.
      failures.add(provider.name);
    }
  }
  // Catalog order can change after a refresh. A stable order keeps automatic
  // routing explainable without inventing token prices for audio-minute work.
  candidates.sort(
    (a, b) =>
      a.providerSlug.localeCompare(b.providerSlug) ||
      a.modelId.localeCompare(b.modelId),
  );
  return { candidates, failures };
}

/** Automatic passes over a candidate the organization's EU/EEA rule
 * refuses. A pin the rule refuses comes back with its refusal, and so does
 * Automatic's first candidate when every one is refused and no provider
 * failed (a failed one might have served from the region). */
function selectCandidate(
  discovery: Awaited<ReturnType<typeof candidatesFor>>,
  pin: TranscriptionModelPin,
  endpointPolicy: ModelEndpointPolicy,
): TranscriptionSelection {
  const refusalOf = (candidate: Candidate) =>
    modelEndpointRefusal(endpointPolicy, candidate.resolved);
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
        ...(refusal !== undefined ? { refusal } : {}),
      };
    }
  } else {
    const allowed = discovery.candidates.find(
      (candidate) => refusalOf(candidate) === undefined,
    );
    if (allowed !== undefined) return { candidate: allowed };
    const first = discovery.candidates[0];
    const refusal = first === undefined ? undefined : refusalOf(first);
    if (
      first !== undefined &&
      refusal !== undefined &&
      discovery.failures.size === 0
    ) {
      return { candidate: first, refusal };
    }
  }
  if (
    pin === null
      ? discovery.failures.size > 0
      : discovery.failures.has(pin.providerSlug)
  )
    throw new TranscriptionModelError('TRANSCRIPTION_MODEL_RESOLUTION_FAILED');
  throw new TranscriptionModelError(
    pin === null ? 'NO_TRANSCRIPTION_MODEL' : 'TRANSCRIPTION_MODEL_UNAVAILABLE',
  );
}

/** Public metadata uses exactly the serving admission and strips all secrets. */
export async function inspectTranscriptionModels(
  ctx: ActionCtx,
  organizationId: string,
): Promise<TranscriptionModelStatus> {
  let pin: TranscriptionModelPin = null;
  let error: TranscriptionModelError | undefined;
  try {
    pin = await readPin(ctx, organizationId);
  } catch (caught) {
    error =
      caught instanceof TranscriptionModelError
        ? caught
        : new TranscriptionModelError('TRANSCRIPTION_MODEL_POLICY_UNAVAILABLE');
  }
  try {
    const discovery = await candidatesFor(ctx, organizationId);
    const endpointPolicy = await readModelEndpointPolicy(ctx, organizationId);
    // A model whose endpoint the EU/EEA rule refuses is not offered: a pin
    // on it would be refused at every call (GOV-R22).
    const offered = withoutRefusedModels(
      endpointPolicy,
      discovery.candidates,
      (candidate) => modelEndpointRefusal(endpointPolicy, candidate.resolved),
    );
    const models = {
      models: offered.kept.map(
        ({ providerSlug, providerDisplayName, modelId }) => ({
          providerSlug,
          providerDisplayName,
          modelId,
        }),
      ),
      ...(offered.hiddenBy !== undefined
        ? { modelsHiddenBy: offered.hiddenBy }
        : {}),
    };
    if (error !== undefined)
      return { ...models, pick: null, error: { code: error.code } };
    try {
      const { candidate: selected, refusal } = selectCandidate(
        discovery,
        pin,
        endpointPolicy,
      );
      if (refusal !== undefined) {
        return { ...models, pick: null, error: { code: refusal.code } };
      }
      return {
        ...models,
        pick: {
          providerSlug: selected.providerSlug,
          modelId: selected.modelId,
          source: pin === null ? 'automatic' : 'pinned',
        },
      };
    } catch (caught) {
      if (!(caught instanceof TranscriptionModelError)) throw caught;
      return { ...models, pick: null, error: { code: caught.code } };
    }
  } catch {
    return {
      models: [],
      pick: null,
      error: {
        code: error?.code ?? 'TRANSCRIPTION_MODEL_RESOLUTION_FAILED',
      },
    };
  }
}

/** The model the organization transcribes with. A model its EU/EEA rule
 * refuses is audited and thrown as a `ModelEndpointRefusal`, before any
 * audio is sent. */
export async function resolveTranscriptionModel(
  ctx: ActionCtx,
  opts: { organizationId: string; actor?: ModelEndpointActor },
): Promise<ResolvedTranscriptionModel> {
  const pin = await readPin(ctx, opts.organizationId);
  let selection: TranscriptionSelection;
  try {
    const discovery = await candidatesFor(
      ctx,
      opts.organizationId,
      pin?.providerSlug,
    );
    selection = selectCandidate(
      discovery,
      pin,
      await readModelEndpointPolicy(ctx, opts.organizationId),
    );
  } catch (error) {
    if (error instanceof TranscriptionModelError) throw error;
    throw new TranscriptionModelError('TRANSCRIPTION_MODEL_RESOLUTION_FAILED');
  }
  const { candidate, refusal } = selection;
  if (refusal !== undefined) {
    await refuseModelEndpoint(
      ctx,
      {
        organizationId: opts.organizationId,
        surface: 'transcription',
        providerName: candidate.providerSlug,
        modelId: candidate.modelId,
        ...(opts.actor !== undefined ? { actor: opts.actor } : {}),
      },
      refusal,
    );
  }
  return candidate.resolved;
}
