/**
 * The EU/EEA processing rule at the moment a model call is resolved
 * (GOV-R17).
 *
 * With `euProcessing.enabled` on the organization's model-access policy, a
 * model call goes only to an endpoint known to process in the EU/EEA: a
 * vendor's EU endpoint, or a host an admin attested (`euProcessingVerdict`
 * in `lib/chat/serving.ts`). Every surface that resolves a model asks here
 * once it knows the endpoint it will call and before it builds a request, so
 * a refused call sends nothing anywhere. A refusal is audited
 * (`model_access.denied`) and thrown as {@link ModelEndpointRefusal}, whose
 * message says why.
 *
 * The guardrails' moderation provider receives the text under review, so
 * the rule holds its endpoint too ({@link moderationEndpointRefusal},
 * GOV-R23); the moderation step asks before it sends anything.
 *
 * The policy is read strictly, the way the model endpoints' door reads it: a
 * residency rule cannot read as "off" because the file that turns it on
 * cannot be read. A missing file is off; an unreadable one refuses every
 * call until an admin restores it.
 */

import {
  euProcessingHostsOf,
  type ModelAccessConfig,
} from '@tale/shared/schemas/governance';
import { z } from 'zod';

import {
  euProcessingVerdict,
  type EuProcessingRefusal,
  vendorEuEndpoint,
} from '../../../lib/chat/serving.ts';
import { AppError } from '../../../lib/shared/errors/app-error.ts';
import type { ActionCtx } from '../lib/ctx.ts';
import { internal } from '../lib/handler_names.ts';

/** Where the organization lets a model call go: anywhere, only to an
 * endpoint that processes in the EU/EEA (or a host an admin attested), or
 * nowhere while its policy cannot be read. */
export type ModelEndpointPolicy =
  | { readonly kind: 'open' }
  | { readonly kind: 'eu'; readonly attestedHosts: readonly string[] }
  | { readonly kind: 'unreadable' };

/** The rule a model-access policy sets — open when no file exists. */
export function modelEndpointPolicyOf(
  config: ModelAccessConfig | null,
): ModelEndpointPolicy {
  const attestedHosts = euProcessingHostsOf(config);
  return attestedHosts === null
    ? { kind: 'open' }
    : { kind: 'eu', attestedHosts };
}

const modelEndpointPolicySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('open') }),
  z.object({ kind: z.literal('eu'), attestedHosts: z.array(z.string()) }),
  z.object({ kind: z.literal('unreadable') }),
]);

/** The organization's rule, as the governance seam answers it. An answer
 * the gate does not recognize refuses, like an unreadable policy. */
export async function readModelEndpointPolicy(
  ctx: ActionCtx,
  organizationId: string,
): Promise<ModelEndpointPolicy> {
  const parsed = modelEndpointPolicySchema.safeParse(
    await ctx.runQuery(
      internal.governance.internal_queries.getModelEndpointPolicyInternal,
      { organizationId },
    ),
  );
  return parsed.success ? parsed.data : { kind: 'unreadable' };
}

/** What made the model call — the audit entry names it. */
export type ModelEndpointSurface =
  | 'chat'
  | 'task'
  | 'chat-title'
  | 'prompt-improvement'
  | 'automation'
  | 'model-api'
  | 'embedding'
  | 'image-generation'
  | 'transcription'
  | 'speech'
  /** The guardrails' moderation provider, which receives the text under
   * review (GOV-R23). */
  | 'moderation';

/** Who a model call is made for; absent, the platform itself. */
export interface ModelEndpointActor {
  readonly id: string;
  readonly type: 'user' | 'api' | 'workflow' | 'system';
}

export interface ModelEndpointCall {
  readonly organizationId: string;
  readonly surface: ModelEndpointSurface;
  /** The provider connector's name. */
  readonly providerName: string;
  readonly modelId?: string;
  /** Where the request would go: the credential's own endpoint, else the
   * provider's base URL. Undefined when neither names one. */
  readonly baseUrl: string | undefined;
  readonly actor?: ModelEndpointActor;
}

export const MODEL_ENDPOINT_REFUSAL_CODES = [
  'MODEL_ENDPOINT_OUTSIDE_EU',
  'MODEL_ENDPOINT_POLICY_UNREADABLE',
] as const;

export type ModelEndpointRefusalCode =
  (typeof MODEL_ENDPOINT_REFUSAL_CODES)[number];

export function isModelEndpointRefusalCode(
  value: unknown,
): value is ModelEndpointRefusalCode {
  return (
    typeof value === 'string' &&
    (MODEL_ENDPOINT_REFUSAL_CODES as readonly string[]).includes(value)
  );
}

/** Why the rule refused a call: its endpoint's verdict, or `gateway-builtin`
 * for a call through the model gateway's built-in connection to a vendor,
 * which goes to the vendor's own endpoint whatever endpoint the provider
 * names. */
export type ModelEndpointRefusalReason =
  | EuProcessingRefusal
  | 'gateway-builtin';

export interface ModelEndpointRefusalData {
  readonly code: ModelEndpointRefusalCode;
  readonly message: string;
  readonly provider: string;
  readonly host?: string;
  readonly reason?: ModelEndpointRefusalReason;
}

/** A model call the organization's EU/EEA rule refused before it was sent. */
export class ModelEndpointRefusal extends AppError<ModelEndpointRefusalData> {}

const EU_RULE = 'This organization processes prompts only in the EU/EEA';
const POLICY_PLACE = 'Settings → Governance → Models → Model access';

function outsideEuMessage(
  provider: string,
  host: string | undefined,
  reason: EuProcessingRefusal,
): string {
  if (host === undefined || reason === 'unknown-endpoint') {
    return `${EU_RULE}, and the provider "${provider}" names no endpoint known to process there, so the call was not sent. An admin can give the provider an endpoint that does.`;
  }
  if (reason === 'not-attested') {
    return `${EU_RULE}, and ${host} is not an endpoint known to process there, so the call was not sent. If it does process in the EU/EEA, an admin can list it under ${POLICY_PLACE}.`;
  }
  const euHost = vendorEuEndpoint(host);
  const endpoint =
    euHost === undefined ? 'processes in the EU/EEA' : `is ${euHost}`;
  return `${EU_RULE}, and ${host} may process prompts outside it, so the call was not sent. An admin can serve the model through a provider whose endpoint ${endpoint} instead.`;
}

const UNREADABLE_MESSAGE =
  'The model access policy cannot be read, so whether prompts must stay in the EU/EEA is unknown and the call was not sent. An admin must restore a valid model access policy.';

function unreadableRefusal(
  provider: string,
  message = UNREADABLE_MESSAGE,
): ModelEndpointRefusalData {
  return {
    code: 'MODEL_ENDPOINT_POLICY_UNREADABLE',
    message,
    provider,
  };
}

/** How a refusal is told: a model call's words, or another surface's. */
interface RefusalWords {
  outsideEu(
    provider: string,
    host: string | undefined,
    reason: EuProcessingRefusal,
  ): string;
  readonly unreadable: string;
}

function endpointRefusal(
  policy: ModelEndpointPolicy,
  providerName: string,
  baseUrl: string | undefined,
  words: RefusalWords,
): ModelEndpointRefusalData | undefined {
  if (policy.kind === 'open') return undefined;
  if (policy.kind === 'unreadable') {
    return unreadableRefusal(providerName, words.unreadable);
  }
  const verdict = euProcessingVerdict(baseUrl, policy.attestedHosts);
  if (verdict.allowed) return undefined;
  return {
    code: 'MODEL_ENDPOINT_OUTSIDE_EU',
    message: words.outsideEu(providerName, verdict.host, verdict.reason),
    provider: providerName,
    ...(verdict.host !== undefined ? { host: verdict.host } : {}),
    reason: verdict.reason,
  };
}

/** Whether `policy` lets `call` through: undefined when it does, else the
 * refusal to throw. Pure — a caller walking several candidates asks it per
 * candidate and skips the refused ones without a word. */
export function modelEndpointRefusal(
  policy: ModelEndpointPolicy,
  call: Pick<ModelEndpointCall, 'providerName' | 'baseUrl'>,
): ModelEndpointRefusalData | undefined {
  return endpointRefusal(policy, call.providerName, call.baseUrl, {
    outsideEu: outsideEuMessage,
    unreadable: UNREADABLE_MESSAGE,
  });
}

/** The provider name a moderation refusal carries — its audit entry's. */
const MODERATION_PROVIDER = 'moderation_provider';

const MODERATION_NOT_SENT =
  'so the text was not sent to the moderation provider';

const MODERATION_UNREADABLE_MESSAGE =
  'The model access policy cannot be read, so whether prompts must stay in the EU/EEA is unknown and the text was not sent to the moderation provider. An admin must restore a valid model access policy.';

function moderationOutsideEuMessage(
  _provider: string,
  host: string | undefined,
  reason: EuProcessingRefusal,
): string {
  if (host === undefined || reason === 'unknown-endpoint') {
    return `${EU_RULE}, and the moderation provider names no endpoint known to process there, ${MODERATION_NOT_SENT}. An admin can point it at an endpoint that does.`;
  }
  if (reason === 'not-attested') {
    return `${EU_RULE}, and ${host} is not an endpoint known to process there, ${MODERATION_NOT_SENT}. If it does process in the EU/EEA, an admin can list it under ${POLICY_PLACE}.`;
  }
  const euHost = vendorEuEndpoint(host);
  return `${EU_RULE}, and ${host} may process prompts outside it, ${MODERATION_NOT_SENT}. An admin can point the moderation provider at ${euHost ?? 'an endpoint that processes in the EU/EEA'} instead.`;
}

/**
 * {@link modelEndpointRefusal} for the guardrails' moderation provider
 * (GOV-R23): it receives the text under review — prompts and replies — so
 * the rule holds its endpoint to the region as it holds a model call's,
 * with the same verdict and codes, told in its own words. Undefined when
 * the rule lets the endpoint through.
 */
export function moderationEndpointRefusal(
  policy: ModelEndpointPolicy,
  endpointUrl: string,
): ModelEndpointRefusalData | undefined {
  return endpointRefusal(policy, MODERATION_PROVIDER, endpointUrl, {
    outsideEu: moderationOutsideEuMessage,
    unreadable: MODERATION_UNREADABLE_MESSAGE,
  });
}

/** {@link modelEndpointRefusal} for a call through the model gateway's
 * built-in connection to a vendor (a standard gateway provider). The gateway
 * owns that connection's endpoint — the vendor's own, never the one the
 * provider names — so the rule cannot tell where it processes and refuses
 * it. */
export function gatewayBuiltinRefusal(
  policy: ModelEndpointPolicy,
  providerName: string,
): ModelEndpointRefusalData | undefined {
  if (policy.kind === 'open') return undefined;
  if (policy.kind === 'unreadable') return unreadableRefusal(providerName);
  return {
    code: 'MODEL_ENDPOINT_OUTSIDE_EU',
    message: `${EU_RULE}, and the model gateway reaches the provider "${providerName}" through its built-in connection, which calls the vendor's own endpoint rather than the one the provider names, so the call was not sent. An admin can serve the model through a custom provider whose endpoint processes in the EU/EEA.`,
    provider: providerName,
    reason: 'gateway-builtin',
  };
}

/** Why a list of models a person picks from left some out (GOV-R22): their
 * endpoints may process outside the EU/EEA (`eu`), or the policy cannot be
 * read, so every model is left out (`unreadable`). The chooser says which. */
export type HiddenModelsRule = 'eu' | 'unreadable';

/**
 * `candidates` without the ones the organization's rule refuses — what a
 * model chooser offers, so no one picks a model only to have the call
 * refused (GOV-R22) — and, when it left any out, why. `refusalOf` asks the
 * gate for one candidate: {@link modelEndpointRefusal} on the endpoint the
 * call would go to, or {@link gatewayBuiltinRefusal} for the model gateway's
 * built-in connection. Open, the list is returned as it was.
 */
export function withoutRefusedModels<T>(
  policy: ModelEndpointPolicy,
  candidates: readonly T[],
  refusalOf: (candidate: T) => ModelEndpointRefusalData | undefined,
): { readonly kept: T[]; readonly hiddenBy?: HiddenModelsRule } {
  if (policy.kind === 'open') return { kept: [...candidates] };
  const kept = candidates.filter(
    (candidate) => refusalOf(candidate) === undefined,
  );
  return kept.length === candidates.length
    ? { kept }
    : { kept, hiddenBy: policy.kind };
}

/** Audit the refusal, then throw it. The entry is best effort: a write that
 * fails is logged and never turns the refusal into a call. */
export async function refuseModelEndpoint(
  ctx: ActionCtx,
  call: ModelEndpointCall,
  refusal: ModelEndpointRefusalData,
): Promise<never> {
  try {
    await ctx.runMutation(
      internal.governance.internal_mutations.recordModelEndpointRefusal,
      {
        organizationId: call.organizationId,
        surface: call.surface,
        provider: call.providerName,
        ...(call.modelId !== undefined ? { model: call.modelId } : {}),
        ...(refusal.host !== undefined ? { host: refusal.host } : {}),
        ...(refusal.reason !== undefined ? { reason: refusal.reason } : {}),
        code: refusal.code,
        message: refusal.message,
        ...(call.actor !== undefined ? { actor: call.actor } : {}),
      },
    );
  } catch (error) {
    console.warn(
      `[governance] ${call.organizationId}: the audit entry for a refused model call could not be written:`,
      error,
    );
  }
  throw new ModelEndpointRefusal(refusal);
}

/** Refuse `call` unless the organization's rule lets it through. The rule is
 * read here, or passed in by a caller that already read it. */
export async function assertModelEndpointAllowed(
  ctx: ActionCtx,
  call: ModelEndpointCall,
  policy?: ModelEndpointPolicy,
): Promise<void> {
  const refusal = modelEndpointRefusal(
    policy ?? (await readModelEndpointPolicy(ctx, call.organizationId)),
    call,
  );
  if (refusal !== undefined) await refuseModelEndpoint(ctx, call, refusal);
}
