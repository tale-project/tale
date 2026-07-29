'use node';

/**
 * Session gateway provisioning — the bridge from org provider credentials to
 * the sandbox LLM gateway. Session-create paths call ONE entry point
 * (`provisionSessionGatewayKey`) which:
 *
 *  1. resolves each involved provider's credential (explicit id, else the
 *     org default) and pushes its secret + model catalog into the gateway as
 *     the org's upstream key (best-effort per provider — the mint fails
 *     closed on anything that didn't land),
 *  2. hardens the gateway auth posture (fail-CLOSED: a gateway that cannot
 *     enforce virtual keys must not serve the session),
 *  3. mints one session-scoped virtual key bound to this org's upstream
 *     keys, capped by the caller's budget and model allowlist.
 *
 * Only `api-key` and `env` credentials ride the gateway. A
 * `subscription-broker` credential never does: its execution constraint
 * forces a specific harness which authenticates with the brokered
 * subscription token directly, so there is no upstream API key to provision.
 *
 * The gateway holds ONE upstream key per (org, provider) — concurrent
 * sessions of one org that select different credentials of the SAME provider
 * rotate that key last-writer-wins. Isolation between organizations is the
 * invariant the key naming + VK binding enforce; credential choice within an
 * org is a routing preference.
 */

import { ConvexError } from 'convex/values';

import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { getConnectorCatalog } from '../../lib/providers/catalog_fetch';
import { resolveConnectorsForOrgId } from '../../lib/providers/org_connectors';
import { resolveProviderCredential } from '../../provider_credentials/resolve_credential';
import {
  applyGatewayConfig,
  hashVirtualKey,
  isStandardGatewayProvider,
  mintVirtualKey,
  provisionProviders,
  resolveGatewayRouting,
  type AllowedModelRef,
  type ProviderProvision,
} from './llm_gateway_admin';

/** The credential-row fields this module reads back (the internal query
 * returns the full row as `v.any()`). */
interface CredentialRowFacts {
  modelAllowlist?: string[];
}

/**
 * Build the gateway provision for one provider from its resolved credential.
 * Returns null for a subscription-broker credential (never gateway-served).
 *
 * The key's model list is the credential's own allowlist when one is set —
 * the operator's word is authoritative even where the fetched catalog lags —
 * else the connector's full catalog.
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
    await resolveConnectorsForOrgId(ctx, args.organizationId)
  ).find((entry) => entry.name === args.providerSlug);
  if (!connector) {
    throw new ConvexError({
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
  // there is no upstream API key to install in the gateway.
  if (
    resolved.authMethod === 'subscription-broker' ||
    resolved.authMethod === 'subscription-key'
  ) {
    return null;
  }
  // Per-credential-endpoint providers (Azure) need gateway key-level
  // endpoint config that the minimal provisioner doesn't push yet — their
  // credentials serve direct calls; managed sandbox runs fail closed at the
  // mint until that support lands.
  if (connector.endpointMode === 'per-credential') {
    console.warn(
      `[gateway-provisioning] provider '${connector.name}' uses per-credential endpoints; skipping gateway provisioning (direct execution unaffected)`,
    );
    return null;
  }

  const row = (await ctx.runQuery(
    internal.provider_credentials.queries.getCredentialInternal,
    { credentialId: resolved.credentialId },
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the internal query returns the full row as v.any(); this names the fields read here
  )) as CredentialRowFacts | null;
  const allowlist = row?.modelAllowlist;

  const models =
    allowlist !== undefined && allowlist.length > 0
      ? allowlist
      : (await getConnectorCatalog(connector)).map((entry) => entry.id);

  return {
    name: connector.name,
    baseUrl: connector.baseUrl,
    apiFormat: connector.apiFormat,
    apiKey: resolved.secret,
    models,
  };
}

export interface SessionGatewayArgs {
  organizationId: string;
  sessionId: string;
  /** Models the session may call; their union defines which providers get
   * provisioned. Already filtered by org availability — this module adds no
   * governance of its own. */
  allowedModels: AllowedModelRef[];
  /** Explicit credential per provider slug; absent slugs use the org
   * default. */
  credentialIds?: Partial<Record<string, Id<'providerCredentials'>>>;
  /** Hard spend cap for the minted key. */
  budgetCents: number;
}

export interface SessionGatewayKey {
  /** Plaintext `sk-bf-*` — inject into the sandbox, never persist. */
  token: string;
  /** Gateway-side id for revoke + spend reads. */
  keyId: string;
  /** sha256 of the token — the only form that may be stored. */
  keyHash: string;
}

/**
 * Provision + mint for one sandbox session. Provisioning is per-provider
 * best-effort (a broken provider is logged and skipped; the mint fails
 * closed if the turn's provider didn't land); the auth-posture apply is
 * fail-closed by design — swallowing its failure could leave the gateway
 * accepting un-keyed or model-unrestricted inference, defeating the whole
 * per-session key model.
 */
export async function provisionSessionGatewayKey(
  ctx: ActionCtx,
  args: SessionGatewayArgs,
): Promise<SessionGatewayKey> {
  // One provision-build per unique connector (one credential resolve each),
  // then expand into the EXACT gateway records the mint will bind to. A
  // standard gateway provider routes to one shared record (`<slug>/<model>`),
  // so its raw-slug provision matches as-is. A CUSTOM connector routes per
  // model (`<slug>__<model>/<model>`, resolveGatewayRouting), so each of its
  // models needs its own record carrying that name and just that model —
  // otherwise the record the key lands under (`deepseek`) and the one the
  // mint looks up (`deepseek__deepseek-chat`) disagree and the mint fails
  // closed.
  const baseBySlug = new Map<string, ProviderProvision>();
  for (const providerSlug of new Set(
    args.allowedModels.map((ref) => ref.providerSlug),
  )) {
    try {
      const base = await buildProviderProvision(ctx, {
        organizationId: args.organizationId,
        providerSlug,
        credentialId: args.credentialIds?.[providerSlug],
      });
      if (base) baseBySlug.set(providerSlug, base);
    } catch (err) {
      console.warn(
        `[gateway-provisioning] building provision for '${providerSlug}' failed (continuing; mint fails closed if this provider has no key):`,
        err,
      );
    }
  }

  const provisions: ProviderProvision[] = [];
  const provisionedNames = new Set<string>();
  for (const ref of args.allowedModels) {
    const base = baseBySlug.get(ref.providerSlug);
    if (!base) continue;
    const provision = isStandardGatewayProvider(ref.providerSlug)
      ? base
      : {
          ...base,
          name: resolveGatewayRouting(ref.providerSlug, ref.modelId)
            .gatewayProvider,
          models: [ref.modelId],
        };
    if (provisionedNames.has(provision.name)) continue;
    provisionedNames.add(provision.name);
    provisions.push(provision);
  }
  await provisionProviders(args.organizationId, provisions);

  await applyGatewayConfig();

  const minted = await mintVirtualKey({
    budgetCents: args.budgetCents,
    allowedModels: args.allowedModels,
    organizationId: args.organizationId,
    sessionId: args.sessionId,
  });
  return {
    token: minted.key,
    keyId: minted.keyId,
    keyHash: hashVirtualKey(minted.key),
  };
}
