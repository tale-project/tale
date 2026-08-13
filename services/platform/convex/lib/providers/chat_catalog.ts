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
 * model allowlist, and warn-skips a connector whose catalog is unreachable —
 * exactly the composer's original loop. It deliberately does NOT dedupe and
 * does NOT filter by tag: the composer derives voice availability from
 * non-chat entries in the same pass, and each caller keys its own dedupe.
 *
 * Credentials are walked in the order given — callers sort direct-capable
 * (api-key/env) first so a first-wins dedupe favors the directly-usable
 * serving of a model over a sandbox-forcing subscription one.
 */

import type { ModelCatalogEntry } from '../../../lib/shared/schemas/providers';
import type { ActionCtx } from '../../_generated/server';
import { getProviderCatalog } from './catalog_fetch';
import { credentialAuthFor } from './credential_auth';
import { resolveProvidersForOrgId } from './org_providers';

type OrgConnector = Awaited<
  ReturnType<typeof resolveProvidersForOrgId>
>[number];

/** The credential facts the walk reads — a projection both the public
 * masked listing and `listActiveCredentialFactsInternal` can supply. */
export interface ChatCatalogCredential {
  readonly providerSlug: string;
  readonly authMethod: Parameters<typeof credentialAuthFor>[1];
  readonly modelAllowlist?: readonly string[];
}

export interface ChatCatalogHit {
  readonly connector: OrgConnector;
  readonly credential: ChatCatalogCredential;
  readonly credentialAuth: NonNullable<ReturnType<typeof credentialAuthFor>>;
  readonly entry: ModelCatalogEntry;
}

export async function walkChatCatalog(
  ctx: ActionCtx,
  organizationId: string,
  credentials: readonly ChatCatalogCredential[],
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
      catalog = await getProviderCatalog(connector);
    } catch (error) {
      // One connector's unreachable /models endpoint must not blank the
      // whole listing; skip it loudly and offer the rest.
      console.warn(
        `[chat-catalog] could not resolve catalog for "${connector.name}"`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }

    const allowlist = credential.modelAllowlist;
    for (const entry of catalog) {
      if (allowlist && !allowlist.includes(entry.id)) continue;
      hits.push({ connector, credential, credentialAuth, entry });
    }
  }
  return hits;
}
