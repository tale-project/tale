'use node';

/**
 * Which lane serves one agent HARNESS turn, and on which provider — the
 * shared core under the task lane's pinned split (`tasks/task_serving.ts`)
 * and the automation agent node's unpinned walk. Two lanes exist:
 *
 *  - GATEWAY: a direct api-key/env credential behind a session virtual key —
 *    the default, and the only lane a plain `llm` node can use.
 *  - SUBSCRIPTION: a vendor subscription credential (static key or brokered
 *    token pool) that authenticates the harness's own CLI directly. It only
 *    works inside the vendor's sanctioned harness, so serving it requires
 *    the provider's declared constraints to match the turn's harness AND
 *    that harness to declare a `subscription` delivery in its yml.
 *
 * {@link resolveWorkflowAgentServing} is an automation `agent` node's door.
 * Unpinned, it walks: the DIRECT pass first — byte-for-byte the llm node's
 * connector walk, so an org that serves the model directly today keeps that
 * serving (and its billing lane) unchanged — then the subscription pass over
 * the connectors the direct pass had to skip. First match wins in shipped
 * connector order; nothing serving is a clean, reasoned failure, never a
 * silent switch to a different model.
 *
 * {@link resolvePinnedAgentServing} is the pinned split both agent lanes
 * share — a task agent's `projectAgents.modelProvider` and an automation
 * node's `modelProvider` field: the pinned provider's DEFAULT credential
 * shape decides the lane, and a pin that cannot serve throws rather than
 * falling back to another provider.
 */

import {
  buildHarnessTable,
  resolveExecution,
} from '../../../../lib/shared/providers/resolve_execution';
import type {
  ModelCatalogEntry,
  ProviderDefinition,
} from '../../../../lib/shared/schemas/providers';
import {
  modelAllowlistPermits,
  modelIdsEquivalent,
} from '../../../../lib/shared/utils/model-ref';
import { isRecord } from '../../../../lib/utils/type-utils';
import type { ActionCtx } from '../ctx';
import { internal } from '../handler_names';
import { getProviderCatalog } from './catalog_fetch';
import { credentialAuthFor } from './credential_auth';
import { directActiveCredential } from './direct_credential';
import { loadHarnesses } from './load_system_config';
import { resolveProvidersForOrgId } from './org_providers';

/** One resolved serving: the lane, the connector, and the model id in that
 * connector's own catalog spelling (what the wire — or the vendor CLI —
 * accepts). */
export type AgentTurnServing =
  | { lane: 'gateway'; providerSlug: string; modelId: string }
  | {
      lane: 'subscription';
      providerSlug: string;
      modelId: string;
      /** The vendor API base the CLI authenticates against — the auth
       * entry's own coding endpoint when declared, else the provider's
       * `baseUrl`. Never the broker's token endpoint. */
      apiBaseUrl: string;
    };

export const AGENT_CREDENTIAL_AUTH_METHODS = [
  'api-key',
  'env',
  'subscription-key',
  'subscription-broker',
] as const;
export type AgentCredentialAuthMethodName =
  (typeof AGENT_CREDENTIAL_AUTH_METHODS)[number];

/** The default-credential row fields lane resolution reads, resolver-shaped. */
export interface AgentDefaultCredentialRow {
  status: string;
  authMethod: AgentCredentialAuthMethodName;
  modelAllowlist?: string[];
}

function isAuthMethodName(
  value: unknown,
): value is AgentCredentialAuthMethodName {
  return (
    typeof value === 'string' &&
    (AGENT_CREDENTIAL_AUTH_METHODS as readonly string[]).includes(value)
  );
}

/** Narrow an internal credential query's row to the fields read here —
 * constructed field by field, never asserted, so a shape drift surfaces as
 * `null` (→ "no active default credential") instead of an unsound read. */
export function readAgentDefaultCredentialRow(
  row: unknown,
): AgentDefaultCredentialRow | null {
  if (!isRecord(row)) return null;
  if (typeof row.status !== 'string' || !isAuthMethodName(row.authMethod)) {
    return null;
  }
  const shaped: AgentDefaultCredentialRow = {
    status: row.status,
    authMethod: row.authMethod,
  };
  if (
    Array.isArray(row.modelAllowlist) &&
    row.modelAllowlist.every((entry) => typeof entry === 'string')
  ) {
    shaped.modelAllowlist = row.modelAllowlist;
  }
  return shaped;
}

/** The resolver only reads a model's identity; neutral values fill the
 * catalog fields it ignores (same convention as the composer's affordance
 * probe and the harness status derivation). */
export function neutralModelEntry(
  id: string,
  provider: string,
): ModelCatalogEntry {
  return {
    id,
    provider,
    tags: ['chat'],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 1,
  };
}

/**
 * Whether a subscription-flavored default credential may drive this turn's
 * harness: the provider must still declare the auth method, `resolveExecution`
 * must sanction the (credential, sandbox, harness) triple — the credential's
 * forced harness is exactly the turn's — and that harness must declare a
 * `subscription` delivery in its yml (a harness with no `subscription`
 * section has no way to receive the token). Pure policy — the caller decides
 * whether a refusal throws (a pinned provider) or skips (a connector walk).
 */
export function sanctionSubscriptionHarnessTurn(args: {
  provider: ProviderDefinition;
  authMethod: 'subscription-key' | 'subscription-broker';
  /** The model id as the caller names it — identity only, for messages. */
  model: string;
  harness: string;
}): { ok: true } | { ok: false; reason: string } {
  const { provider, authMethod, model, harness } = args;
  const credentialAuth = credentialAuthFor(provider, authMethod);
  if (credentialAuth === null) {
    return {
      ok: false,
      reason: `provider "${provider.name}" no longer declares the "${authMethod}" auth method its default credential uses — recreate the credential in Settings → AI providers`,
    };
  }
  const resolution = resolveExecution(
    {
      model: neutralModelEntry(model, provider.name),
      credential: credentialAuth,
      mode: 'sandbox',
      harness,
    },
    buildHarnessTable(loadHarnesses()),
  );
  if (resolution.mode !== 'sandbox') {
    return {
      ok: false,
      reason:
        resolution.mode === 'refused'
          ? resolution.reason
          : `provider "${provider.name}"'s subscription credential cannot serve a sandbox turn`,
    };
  }
  // The delivery channel is harness yml, not the resolver's case split: a
  // harness with no `subscription` section has no way to receive the token.
  if (resolution.harness.subscription === undefined) {
    return {
      ok: false,
      reason: `harness "${harness}" has no subscription delivery — the "${provider.name}" subscription credential cannot drive it; pick a directly-served model for this agent`,
    };
  }
  return { ok: true };
}

/**
 * The vendor API base a subscription turn points the CLI at: the auth
 * entry's dedicated coding endpoint when declared (subscription-key
 * providers often do), else the provider's `baseUrl`. A broker's
 * `endpointUrl` is its TOKEN endpoint and never the API base. `undefined`
 * when the provider declares neither — the turn has nowhere to point the CLI.
 */
export function subscriptionApiBaseUrl(
  provider: ProviderDefinition,
  authMethod: 'subscription-key' | 'subscription-broker',
): string | undefined {
  const authEntry = provider.auth.find(
    (candidate) => candidate.method === authMethod,
  );
  return (
    (authEntry !== undefined &&
    authEntry.method === 'subscription-key' &&
    authEntry.baseUrl !== undefined
      ? authEntry.baseUrl
      : undefined) ?? provider.baseUrl
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What one direct-credential walk found: the serving target, or nothing —
 * plus the connectors whose catalog was unreachable and every default
 * credential row the walk fetched (keyed by connector name), so a follow-up
 * pass never re-queries them. */
export interface DirectServingWalk {
  target: { providerSlug: string; modelId: string } | null;
  unreachable: string[];
  rows: Map<string, unknown>;
}

/**
 * The direct-credential connector walk (the llm node's, the legacy task
 * walk's, and the agent walk's first pass — ONE implementation so they can
 * never drift): the first connector whose default credential is active and
 * direct-capable (api-key/env), whose allowlist permits the model, and whose
 * catalog lists it. Catalog match is exact id first, then
 * {@link modelIdsEquivalent}; the returned `modelId` is the catalog entry's
 * id — the spelling the serving connector accepts on the wire. An
 * unreachable catalog skips the connector and is reported, never thrown.
 */
export async function walkDirectServing(
  ctx: ActionCtx,
  organizationId: string,
  modelId: string,
  connectors: readonly ProviderDefinition[],
): Promise<DirectServingWalk> {
  const unreachable: string[] = [];
  const rows = new Map<string, unknown>();
  for (const connector of connectors) {
    const row: unknown = await ctx.runQuery(
      internal.provider_credentials.queries.getDefaultCredentialInternal,
      { organizationId, providerSlug: connector.name },
    );
    rows.set(connector.name, row);
    const credential = directActiveCredential(row);
    if (credential === null) continue;
    if (!modelAllowlistPermits(credential.modelAllowlist, modelId)) {
      continue;
    }
    let catalog: readonly ModelCatalogEntry[];
    try {
      catalog = await getProviderCatalog(connector);
    } catch (error) {
      console.warn(
        `[automations] could not resolve catalog for "${connector.name}"`,
        describe(error),
      );
      unreachable.push(connector.name);
      continue;
    }
    const entry =
      catalog.find((candidate) => candidate.id === modelId) ??
      catalog.find((candidate) => modelIdsEquivalent(candidate.id, modelId));
    if (entry !== undefined) {
      return {
        target: { providerSlug: connector.name, modelId: entry.id },
        unreachable,
        rows,
      };
    }
  }
  return { target: null, unreachable, rows };
}

/**
 * Resolve one agent turn's serving lane behind an explicit provider PIN —
 * the split the task lane (`projectAgents.modelProvider`) and a pinned
 * automation `agent` node share. The pinned provider's DEFAULT credential
 * shape decides the lane: an api-key/env default serves the gateway lane
 * through the direct walk narrowed to that one connector; a
 * subscription-flavored default serves the subscription lane when the shared
 * sanction approves the harness pair. Every refusal throws with the
 * actionable reason — a pin NEVER falls back to another provider (the
 * silent-swap billing surprise is the defect the pin exists to close).
 */
export async function resolvePinnedAgentServing(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    model: string;
    modelProvider: string;
    harness: string;
  },
): Promise<AgentTurnServing> {
  const pinned = args.modelProvider;
  const connectors = await resolveProvidersForOrgId(ctx, args.organizationId);
  const connector = connectors.find((entry) => entry.name === pinned);
  if (connector === undefined) {
    throw new Error(
      `the agent pins provider "${pinned}", which is not configured for this organization — edit the agent's model or reconnect the provider`,
    );
  }

  // The lane split reads the pinned provider's DEFAULT credential shape —
  // picking a non-default credential is a user act no picker offers yet, so
  // resolution deliberately never reaches past the default.
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
    const walk = await walkDirectServing(ctx, args.organizationId, args.model, [
      connector,
    ]);
    if (walk.target !== null) {
      return { lane: 'gateway', ...walk.target };
    }
    const detail =
      walk.unreachable.length > 0
        ? ` (the catalog for ${walk.unreachable.map((name) => `"${name}"`).join(', ')} was unreachable)`
        : '';
    throw new Error(
      `provider "${pinned}" cannot serve model "${args.model}" — it needs an active default api-key/env credential whose catalog lists the model and whose allowlist permits it${detail}`,
    );
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
      `[agent-serving] subscription model "${entry.id}" is text-only — image inputs will fail this turn (no vision polyfill on the subscription lane)`,
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

/**
 * Resolve one automation agent turn's serving lane. With a `modelProvider`
 * pin (the node editor's saved pick) the resolution is
 * {@link resolvePinnedAgentServing} — fail-closed on that one provider.
 * Unpinned (nodes saved before the picker carried providers, or authored by
 * hand): DIRECT pass first (an org serving the model directly today keeps
 * that serving and its billing lane); then the SUBSCRIPTION pass: the first
 * connector whose default credential is subscription-flavored, sanctioned
 * for THIS harness ({@link sanctionSubscriptionHarnessTurn}), whose
 * allowlist permits the model and whose catalog lists it. Throws — failing
 * the node with the reason — when nothing serves; the error carries every
 * subscription refusal, because "your broker credential exists but cannot
 * drive this harness" is the diagnosis the author needs.
 */
export async function resolveWorkflowAgentServing(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    model: string;
    modelProvider?: string;
    harness: string;
  },
): Promise<AgentTurnServing> {
  if (args.modelProvider !== undefined) {
    return resolvePinnedAgentServing(ctx, {
      organizationId: args.organizationId,
      model: args.model,
      modelProvider: args.modelProvider,
      harness: args.harness,
    });
  }
  const connectors = await resolveProvidersForOrgId(ctx, args.organizationId);
  const direct = await walkDirectServing(
    ctx,
    args.organizationId,
    args.model,
    connectors,
  );
  if (direct.target !== null) {
    return { lane: 'gateway', ...direct.target };
  }

  const unreachable = [...direct.unreachable];
  const refusals: string[] = [];
  for (const connector of connectors) {
    const row = readAgentDefaultCredentialRow(direct.rows.get(connector.name));
    if (row === null || row.status !== 'active') continue;
    if (
      row.authMethod !== 'subscription-key' &&
      row.authMethod !== 'subscription-broker'
    ) {
      continue;
    }
    const sanction = sanctionSubscriptionHarnessTurn({
      provider: connector,
      authMethod: row.authMethod,
      model: args.model,
      harness: args.harness,
    });
    if (!sanction.ok) {
      refusals.push(`"${connector.name}": ${sanction.reason}`);
      continue;
    }
    if (!modelAllowlistPermits(row.modelAllowlist, args.model)) {
      continue;
    }
    let catalog: readonly ModelCatalogEntry[];
    try {
      catalog = await getProviderCatalog(connector);
    } catch (error) {
      console.warn(
        `[automations] could not resolve catalog for "${connector.name}"`,
        describe(error),
      );
      unreachable.push(connector.name);
      continue;
    }
    const entry =
      catalog.find((candidate) => candidate.id === args.model) ??
      catalog.find((candidate) => modelIdsEquivalent(candidate.id, args.model));
    if (entry === undefined) continue;
    const apiBaseUrl = subscriptionApiBaseUrl(connector, row.authMethod);
    if (apiBaseUrl === undefined) {
      refusals.push(
        `"${connector.name}": declares no API base URL — a subscription turn cannot point the vendor CLI anywhere; declare "baseUrl" in the provider config`,
      );
      continue;
    }
    if (!entry.supportsVision) {
      // The vision polyfill needs a gateway key this lane does not mint; a
      // text-only subscription model would 400 on image reads. Every shipped
      // subscription pair is vision-capable today, so this only warns.
      console.warn(
        `[agent-serving] subscription model "${entry.id}" is text-only — image inputs will fail this turn (no vision polyfill on the subscription lane)`,
      );
    }
    return {
      lane: 'subscription',
      providerSlug: connector.name,
      modelId: entry.id,
      apiBaseUrl,
    };
  }

  const unreachableDetail =
    unreachable.length > 0
      ? ` (the catalog for ${unreachable.map((name) => `"${name}"`).join(', ')} was unreachable)`
      : '';
  const refusalDetail =
    refusals.length > 0
      ? `; subscription credentials that could not serve it: ${refusals.join('; ')}`
      : '';
  throw new Error(
    `no configured provider serves model "${args.model}" for this agent turn — the model must be listed in a connected provider's catalog and permitted by its credential: a direct api-key/env credential, or a subscription credential whose forced harness is the turn's ("${args.harness}")${unreachableDetail}${refusalDetail}`,
  );
}
