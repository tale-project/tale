'use node';

/**
 * Which lane serves one task-agent turn, and on which provider: the GATEWAY
 * lane (a direct api-key/env credential behind the session virtual key — the
 * default), or the SUBSCRIPTION lane (a vendor subscription credential that
 * authenticates the harness's own CLI directly, e.g. a brokered Claude OAuth
 * pool driving Claude Code).
 *
 * The subscription lane exists only behind an explicit provider pin
 * (`projectAgents.modelProvider`): a pinned provider whose DEFAULT credential
 * is subscription-flavored serves the turn on the redeemed subscription
 * token, provided the shared sanction (`sanctionSubscriptionHarnessTurn`)
 * approves the pair — the credential's forced harness must be exactly the
 * agent's harness, and that harness must both accept bring-your-own
 * credentials and declare a `subscription` delivery in its yml. Every refusal
 * throws with the actionable reason; a pin NEVER falls back to another
 * provider (the silent-swap billing surprise is the defect this module exists
 * to close).
 *
 * Unpinned agents (rows saved before the picker carried providers) keep the
 * legacy direct-only connector walk byte-for-byte via
 * {@link resolveServingTarget}.
 */

import {
  modelAllowlistPermits,
  modelIdsEquivalent,
} from '../../lib/shared/utils/model-ref';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { resolveServingTarget } from '../automations/llm_call';
import {
  readAgentDefaultCredentialRow,
  sanctionSubscriptionHarnessTurn,
  subscriptionApiBaseUrl,
  type AgentTurnServing,
} from '../lib/providers/agent_serving';
import { getProviderCatalog } from '../lib/providers/catalog_fetch';
import { resolveProvidersForOrgId } from '../lib/providers/org_providers';

export type TaskServing = AgentTurnServing;

/**
 * Resolve one task-agent turn's serving lane. Throws — failing the run with
 * the reason — whenever a PINNED provider cannot serve the model on its
 * default credential; unpinned resolution keeps the legacy walk's errors.
 */
export async function resolveTaskServing(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    model: string;
    modelProvider?: string;
    harness: string;
  },
): Promise<TaskServing> {
  const pinned = args.modelProvider;
  if (pinned === undefined) {
    const target = await resolveServingTarget(
      ctx,
      args.organizationId,
      args.model,
    );
    return { lane: 'gateway', ...target };
  }

  const connectors = await resolveProvidersForOrgId(ctx, args.organizationId);
  const connector = connectors.find((entry) => entry.name === pinned);
  if (connector === undefined) {
    throw new Error(
      `the agent pins provider "${pinned}", which is not configured for this organization — edit the agent's model or reconnect the provider`,
    );
  }

  // The lane split reads the pinned provider's DEFAULT credential shape —
  // picking a non-default credential is a user act the agent dialog does not
  // offer yet, so resolution deliberately never reaches past the default.
  const row = readAgentDefaultCredentialRow(
    await ctx.runQuery(
      internal.provider_credentials.queries.getDefaultCredentialInternal,
      { organizationId: args.organizationId, providerSlug: pinned },
    ),
  );
  if (row === null || row.status !== 'active') {
    throw new Error(
      `provider "${pinned}" has no active default credential — add or enable one in Settings → AI providers, or edit the agent's model`,
    );
  }

  if (row.authMethod === 'api-key' || row.authMethod === 'env') {
    const target = await resolveServingTarget(
      ctx,
      args.organizationId,
      args.model,
      { pinnedProvider: pinned },
    );
    return { lane: 'gateway', ...target };
  }

  // Subscription lane. The provider's own auth declaration carries the
  // forced-harness constraints; the shared sanction owns the case split.
  const sanction = sanctionSubscriptionHarnessTurn({
    provider: connector,
    authMethod: row.authMethod,
    model: args.model,
    harness: args.harness,
  });
  if (!sanction.ok) {
    throw new Error(sanction.reason);
  }

  if (!modelAllowlistPermits(row.modelAllowlist, args.model)) {
    throw new Error(
      `provider "${pinned}"'s default credential does not permit model "${args.model}" — its allowlist excludes it`,
    );
  }
  const catalog = await getProviderCatalog(connector);
  const entry =
    catalog.find((candidate) => candidate.id === args.model) ??
    catalog.find((candidate) => modelIdsEquivalent(candidate.id, args.model));
  if (entry === undefined) {
    throw new Error(
      `provider "${pinned}" does not list model "${args.model}" in its catalog — edit the agent's model`,
    );
  }
  if (!entry.supportsVision) {
    // The vision polyfill needs a gateway key this lane does not mint; a
    // text-only subscription model would 400 on image reads. Every shipped
    // subscription pair is vision-capable today, so this only warns.
    console.warn(
      `[task-serving] subscription model "${entry.id}" is text-only — image inputs will fail this turn (no vision polyfill on the subscription lane)`,
    );
  }

  const apiBaseUrl = subscriptionApiBaseUrl(connector, row.authMethod);
  if (apiBaseUrl === undefined) {
    throw new Error(
      `provider "${pinned}" declares no API base URL — a subscription turn cannot point the vendor CLI anywhere; declare "baseUrl" in the provider config`,
    );
  }

  return {
    lane: 'subscription',
    providerSlug: pinned,
    modelId: entry.id,
    apiBaseUrl,
  };
}
