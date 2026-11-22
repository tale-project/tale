'use node';

/**
 * A turn's model key — the bridge from an organization's provider
 * credentials to the in-process model relay (tale-project/tale#4942).
 * Session-create paths and the model endpoints for API keys call ONE entry
 * point (`issueRelayKey`), which:
 *
 *  1. holds every model the key may call to the organization's EU/EEA
 *     processing rule (GOV-R17), judged by the upstream the relay really
 *     calls, before any credential resolves — a refused one throws the
 *     gate's audited `ModelEndpointRefusal`;
 *  2. resolves each involved provider's credential (explicit id, else the
 *     org default) to one the relay can serve — fail-CLOSED: a credential
 *     that does not resolve refuses the turn;
 *  3. mints a key the relay serves, naming those credentials, so the key
 *     serves its turn with the credential it was minted under.
 *
 * Only `api-key` and `env` credentials ride the relay. A subscription
 * credential never does: its execution constraint forces a specific harness,
 * which authenticates with the subscription directly.
 *
 * A refusal says which side it came from — `gatewayProvisioningFailureStage`
 * — so the caller can tell the person whether the credential needs an
 * admin's attention or a later retry is the remedy.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import { AppError } from '../../../../lib/shared/errors/app-error';
import type { AllowedModelRef } from '../../../../lib/shared/providers/gateway_routing';
import { isRecord } from '../../../../lib/utils/type-utils';
import { traceSandboxPhase } from '../../../tracing';
import {
  relayModelRefusal,
  readModelEndpointPolicy,
  refuseModelEndpoint,
  type ModelEndpointActor,
  type ModelEndpointPolicy,
  type ModelEndpointSurface,
} from '../../governance/model_endpoint_gate';
import type { ActionCtx } from '../../lib/ctx';
import { resolveProvidersForOrgId } from '../../lib/providers/org_providers';
import type { Id } from '../../lib/rows';
import { resolveProviderCredential } from '../../provider_credentials/resolve_credential';
import { hashVirtualKey } from './llm_gateway_admin';
import { RELAY_KEY_PREFIX } from './relay_keys';

/**
 * One connector with the credential it was resolved with: what a relay key
 * names its credential from (`issueRelayKey`), and what the relay serves a
 * call to that connector with (`domains/llm_relay/deps.ts`).
 */
export interface ProviderProvision {
  /** The connector's name. */
  name: string;
  baseUrl?: string;
  /** The connector's wire format. Absent ⇒ 'openai'. */
  apiFormat?: 'openai' | 'anthropic';
  apiKey: string;
  /** The connector's native Anthropic harness endpoint, which an
   * anthropic-wire harness rides (see `GatewayRoutingOpts.anthropicHarnessLane`
   * in `lib/shared/providers/gateway_routing.ts`). */
  harnessEndpoint?: { baseUrl: string; apiFormat: 'openai' | 'anthropic' };
  /** The credential the provision resolved, which a model relay key serves
   * its turn with (`issueRelayKey`). */
  credentialId?: string;
}

/**
 * Which side of the key's mint a refusal came from — what the person who
 * hit it can do about it:
 *
 *  - `credential`: the provider's credential could not be resolved or used —
 *    an unknown provider, a disabled or deleted credential, a secret that
 *    could not be read, a credential the relay cannot serve. An admin fixes
 *    it in the provider's settings.
 *  - `gateway`: anything else, after the credential resolved or around it.
 *    A later retry is the remedy.
 */
export type GatewayProvisioningFailureStage = 'credential' | 'gateway';

/** A refusal this module raises, tagged with its stage. Its `message` is the
 * sentence the hosts post as the reason a turn could not start, and its
 * `cause` the failure underneath. */
class GatewayProvisioningError extends Error {
  readonly stage: GatewayProvisioningFailureStage;

  constructor(
    stage: GatewayProvisioningFailureStage,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GatewayProvisioningError';
    this.stage = stage;
  }
}

/**
 * The stage of whatever `issueRelayKey` threw. Its own refusals carry
 * theirs; anything else counts as `gateway`, for which a retry is the
 * remedy.
 */
export function gatewayProvisioningFailureStage(
  error: unknown,
): GatewayProvisioningFailureStage {
  return error instanceof GatewayProvisioningError ? error.stage : 'gateway';
}

/**
 * Build the provision for one provider from its resolved credential.
 * Returns null for a subscription credential, which only its vendor's own
 * harness may use, and for a connector whose endpoint is the credential's.
 *
 */
export async function buildProviderProvision(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    providerSlug: string;
    credentialId?: Id<'providerCredentials'>;
  },
): Promise<ProviderProvision | null> {
  const connector = (
    await resolveProvidersForOrgId(ctx, args.organizationId)
  ).find((entry) => entry.name === args.providerSlug);
  if (!connector) {
    throw new AppError({
      code: 'PROVIDER_UNKNOWN',
      message: `Unknown provider "${args.providerSlug}" — no shipped or org-defined connector by that name.`,
    });
  }

  const resolved = await resolveProviderCredential(ctx, {
    organizationId: args.organizationId,
    providerSlug: args.providerSlug,
    ...(args.credentialId !== undefined && {
      credentialId: args.credentialId,
    }),
  });
  // Every subscription flavor authenticates its forced harness directly —
  // there is no upstream API key to serve a call with.
  if (
    resolved.authMethod === 'subscription-broker' ||
    resolved.authMethod === 'subscription-key'
  ) {
    return null;
  }
  // Per-credential-endpoint providers (Azure) keep their endpoint on the
  // credential, which the relay does not serve yet — their credentials serve
  // direct calls; a managed sandbox run on one is refused at its mint.
  if (connector.endpointMode === 'per-credential') {
    console.warn(
      `[gateway-provisioning] provider '${connector.name}' uses per-credential endpoints; the model relay does not serve it (direct execution unaffected)`,
    );
    return null;
  }

  return {
    name: connector.name,
    baseUrl: connector.baseUrl,
    apiFormat: connector.apiFormat,
    apiKey: resolved.secret,
    // Carried so an anthropic-wire harness (Claude Code) rides the
    // connector's native Anthropic endpoint.
    ...(connector.harnessEndpoint
      ? { harnessEndpoint: connector.harnessEndpoint }
      : {}),
    credentialId: resolved.credentialId,
  };
}

/** The human sentence behind a failure — a structured refusal's
 * `data.message` (its `Error.message` is the serialized payload), else the
 * error's own message. */
function describeFailure(err: unknown): string {
  if (err instanceof AppError) {
    const data: unknown = err.data;
    if (isRecord(data) && typeof data.message === 'string') {
      return data.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

export interface RelayKeyArgs {
  organizationId: string;
  /** Models the key may call; their union defines which connectors'
   * credentials resolve. Already filtered by org availability — the only
   * rule this module applies to them is the EU/EEA one. */
  allowedModels: AllowedModelRef[];
  /** What the key serves, and for whom — the audit entry of a call the
   * EU/EEA rule refuses names both. */
  surface: ModelEndpointSurface;
  actor?: ModelEndpointActor;
  /** Explicit credential per provider slug; absent slugs use the org
   * default. */
  credentialIds?: Partial<Record<string, Id<'providerCredentials'>>>;
}

/**
 * The EU/EEA rule (GOV-R17) on every model the key may call, judged by the
 * endpoint the model relay calls it at ({@link relayModelRefusal}) — whether
 * or not this call resolves the model's connector. The first refused model is audited and
 * thrown; a connector nobody defines is left to the credential's
 * resolution, which refuses it.
 */
async function assertRecordsAllowed(
  ctx: ActionCtx,
  args: RelayKeyArgs,
  policy: ModelEndpointPolicy,
): Promise<void> {
  const connectors = await resolveProvidersForOrgId(ctx, args.organizationId);
  for (const ref of args.allowedModels) {
    const connector = connectors.find(
      (entry) => entry.name === ref.providerSlug,
    );
    if (!connector) continue;
    const refusal = relayModelRefusal(
      policy,
      connector,
      ref.anthropicHarnessLane === true,
    );
    if (refusal === undefined) continue;
    await refuseModelEndpoint(
      ctx,
      {
        organizationId: args.organizationId,
        surface: args.surface,
        providerName: ref.providerSlug,
        modelId: ref.modelId,
        ...(args.actor !== undefined ? { actor: args.actor } : {}),
      },
      refusal,
    );
  }
}

/** A turn's key for the in-process model relay (`domains/llm_relay`): the
 * plaintext the harness presents, the id its op and token rows carry, its
 * hash — the only form stored — and what the relay serves the turn: its
 * models with their connectors and lanes, and the credential each
 * connector was resolved with. */
export interface SessionRelayKey {
  /** Plaintext `tale-rt-*` — handed to the harness, never persisted. */
  token: string;
  /** `tr_<uuid>`: the id the turn's op and token rows carry. */
  keyId: string;
  /** sha256 of the token — the only form that may be stored. */
  keyHash: string;
  relayModels: AllowedModelRef[];
  servingCredentials: Record<string, string>;
}

/**
 * Mint a key for the model relay. FAIL-CLOSED: the EU/EEA rule judges every
 * model the key may call, and every connector's credential must resolve NOW
 * to one the relay can serve, or nothing is minted. Nothing is pushed
 * anywhere: the relay resolves a model's connector at each call, with the
 * credential named here, so a key serves its turn with the credential it
 * was minted under.
 */
export function issueRelayKey(
  ctx: ActionCtx,
  args: RelayKeyArgs,
): Promise<SessionRelayKey> {
  return traceSandboxPhase('gateway', () => issueRelayKeyInner(ctx, args));
}

async function issueRelayKeyInner(
  ctx: ActionCtx,
  args: RelayKeyArgs,
): Promise<SessionRelayKey> {
  const policy = await readModelEndpointPolicy(ctx, args.organizationId);
  if (policy.kind !== 'open') await assertRecordsAllowed(ctx, args, policy);

  const servingCredentials: Record<string, string> = {};
  for (const providerSlug of new Set(
    args.allowedModels.map((ref) => ref.providerSlug),
  )) {
    let base: ProviderProvision | null;
    try {
      base = await buildProviderProvision(ctx, {
        organizationId: args.organizationId,
        providerSlug,
        credentialId: args.credentialIds?.[providerSlug],
      });
    } catch (err) {
      // An Error, never an AppError (whose message is its serialized
      // payload): the hosts post `message` on the run as the reason the turn
      // could not start, so it carries the credential's own words.
      throw new GatewayProvisioningError(
        'credential',
        `Provider "${providerSlug}" cannot serve this session: ${describeFailure(err)}`,
        { cause: err },
      );
    }
    if (base === null) {
      throw new GatewayProvisioningError(
        'credential',
        `Provider "${providerSlug}" cannot serve this session: its credential cannot be served through the model relay (a subscription runs only in its vendor's harness, and a per-credential endpoint is not served)`,
      );
    }
    if (base.credentialId !== undefined) {
      servingCredentials[providerSlug] = base.credentialId;
    }
  }

  const token = `tale-rt-${randomBytes(32).toString('base64url')}`;
  return {
    token,
    keyId: `${RELAY_KEY_PREFIX}${randomUUID()}`,
    keyHash: hashVirtualKey(token),
    relayModels: args.allowedModels,
    servingCredentials,
  };
}
