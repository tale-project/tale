'use node';

/**
 * The connector × credential × catalog-entry walk behind BOTH the composer's
 * model picker and the chat Auto pick. One walk on purpose: the picker and
 * the per-turn auto-resolution must read the SAME world, or Auto could pick
 * a model the picker never offered (or miss one it did) the day the two
 * filters drift apart.
 *
 * The walk resolves the org's connectors, gates each credential on the
 * provider actually declaring its auth method, applies the credential's
 * model allowlist (through the shared `modelAllowlistPermits`, the one
 * predicate every serving lane reads), and warn-skips a connector whose
 * catalog is unreachable —
 * exactly the composer's original loop. It deliberately does NOT dedupe and
 * does NOT filter by tag: the composer derives voice availability from
 * non-chat entries in the same pass, and each caller keys its own dedupe.
 *
 * Credentials are walked in the order given — callers sort direct-capable
 * (api-key/env) first so a first-wins dedupe favors the directly-usable
 * serving of a model over a sandbox-forcing subscription one.
 */

import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import { modelAllowlistPermits } from '@tale/shared/utils/model-ref';

import { answersChatTurns } from '../../../../lib/shared/providers/chat_turn_models';
import {
  type HiddenModelsRule,
  type ModelEndpointPolicy,
  modelEndpointRefusal,
  withoutRefusedModels,
} from '../../governance/model_endpoint_gate';
import type { ActionCtx } from '../ctx';
import { credentialAuthFor } from './credential_auth';
import { resolveProvidersForOrgId } from './org_providers';
import { getServableCatalog } from './servable_catalog';

type OrgConnector = Awaited<
  ReturnType<typeof resolveProvidersForOrgId>
>[number];

/** The credential facts the walk reads — a projection both the public
 * masked listing and `listActiveCredentialFactsInternal` can supply. */
export interface ChatCatalogCredential {
  readonly providerSlug: string;
  readonly authMethod: Parameters<typeof credentialAuthFor>[1];
  readonly modelAllowlist?: readonly string[];
  /** The credential's own endpoint, which a call goes to instead of the
   * provider's base URL — absent when it names none. */
  readonly endpointUrl?: string;
}

export interface ChatCatalogHit {
  readonly connector: OrgConnector;
  readonly credential: ChatCatalogCredential;
  readonly credentialAuth: NonNullable<ReturnType<typeof credentialAuthFor>>;
  readonly entry: ModelCatalogEntry;
}

export interface WalkChatCatalogOptions {
  /**
   * The bearer a connector's live model listing is fetched with, when the
   * caller can resolve one — a hosted OpenAI-compatible endpoint (an
   * organization's custom provider) refuses an anonymous `/models`. Absent
   * or `undefined` lists anonymously, as before.
   */
  readonly bearerFor?: (
    connector: OrgConnector,
    credential: ChatCatalogCredential,
  ) => Promise<string | undefined>;
}

export async function walkChatCatalog(
  ctx: ActionCtx,
  organizationId: string,
  credentials: readonly ChatCatalogCredential[],
  options: WalkChatCatalogOptions = {},
): Promise<ChatCatalogHit[]> {
  const connectors = await resolveProvidersForOrgId(ctx, organizationId);
  const connectorByName = new Map(
    connectors.map((connector) => [connector.name, connector] as const),
  );

  const hits: ChatCatalogHit[] = [];
  for (const credential of credentials) {
    const connector = connectorByName.get(credential.providerSlug);
    if (!connector) continue;
    const credentialAuth = credentialAuthFor(connector, credential.authMethod);
    if (!credentialAuth) continue;

    let catalog;
    try {
      // A catalog-less connector serves the credential's allowlist itself.
      const bearerToken =
        options.bearerFor === undefined
          ? undefined
          : await options.bearerFor(connector, credential);
      catalog =
        bearerToken === undefined
          ? await getServableCatalog(connector, credential.modelAllowlist)
          : await getServableCatalog(connector, credential.modelAllowlist, {
              bearerToken,
            });
    } catch (error) {
      // One connector's unreachable /models endpoint must not blank the
      // whole listing; skip it loudly and offer the rest.
      console.warn(
        `[chat-catalog] could not resolve catalog for "${connector.name}"`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }

    // The SAME predicate the voice resolvers and the turn-time serving
    // checks apply (`modelAllowlistPermits`): an allowlist naming
    // `openai/gpt-4o-mini` admits the catalog's bare `gpt-4o-mini` here
    // exactly as it does there, so the picker never disagrees with a turn.
    for (const entry of catalog) {
      if (!modelAllowlistPermits(credential.modelAllowlist, entry.id)) continue;
      // Direct chat calls a model whose tools need the Responses API on that
      // API — an OpenAI surface, so an Anthropic-format connector has no
      // wire for one and must not offer it. A pinned managed agent resolves
      // separately against its harness's wire.
      if (
        entry.toolCallingApi === 'responses' &&
        connector.apiFormat !== 'openai'
      )
        continue;
      hits.push({ connector, credential, credentialAuth, entry });
    }
  }
  return hits;
}

/** Where a call to `hit`'s model goes — the credential's own endpoint, else
 * the provider's base URL — as the EU/EEA gate judges a direct call. */
function chatCatalogEndpoint(hit: {
  readonly connector: { readonly name: string; readonly baseUrl?: string };
  readonly credential: { readonly endpointUrl?: string };
}): { providerName: string; baseUrl: string | undefined } {
  return {
    providerName: hit.connector.name,
    baseUrl: hit.credential.endpointUrl ?? hit.connector.baseUrl,
  };
}

/** Why the organization's EU/EEA rule refuses every chat call through
 * `provider` and its serving credential (GOV-R22), judged on the endpoint
 * {@link chatCatalogEndpoint} names — undefined when it lets them through.
 * The default-models editor leaves such a provider's models out, as the Auto
 * pick does. */
export function chatProviderRefusedBy(
  policy: ModelEndpointPolicy,
  provider: { readonly name: string; readonly baseUrl?: string },
  credential: { readonly endpointUrl?: string } | undefined,
): HiddenModelsRule | undefined {
  if (policy.kind === 'open') return undefined;
  const refusal = modelEndpointRefusal(
    policy,
    chatCatalogEndpoint({ connector: provider, credential: credential ?? {} }),
  );
  return refusal === undefined ? undefined : policy.kind;
}

/**
 * The walk's `hits` without the ones whose endpoint the organization's
 * EU/EEA rule refuses (GOV-R22) — the composer's listing and the Auto pick
 * both read through this, so Auto never picks a model the picker left out.
 * `hiddenBy` says why when a chat model was among them; a refused voice or
 * embedding entry is no model a chat picker lists.
 */
export function withoutRefusedChatHits(
  policy: ModelEndpointPolicy,
  hits: readonly ChatCatalogHit[],
): { readonly kept: ChatCatalogHit[]; readonly hiddenBy?: HiddenModelsRule } {
  const offered = withoutRefusedModels(policy, hits, (hit) =>
    modelEndpointRefusal(policy, chatCatalogEndpoint(hit)),
  );
  if (offered.hiddenBy === undefined) return offered;
  const kept = new Set(offered.kept);
  return hits.some((hit) => !kept.has(hit) && answersChatTurns(hit.entry))
    ? offered
    : { kept: offered.kept };
}
