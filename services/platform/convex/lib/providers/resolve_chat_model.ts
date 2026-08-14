'use node';

/**
 * The chat Auto pick: which concrete model answers this message when the
 * composer is on Auto. This is a USER-FACING model choice (unlike the vision
 * polyfill), so per-user governance applies in full.
 *
 * Sources, in order:
 *
 *  1. **Pinned** — the org's `default_models` governance rule for this user
 *     (team > role > default), already access-checked by
 *     `resolveDefaultModel`. An admin naming a model is the escape hatch
 *     from auto-selection entirely; it still has to be servable and — when
 *     the message carries images — able to see them, else it falls through
 *     with a warning rather than breaking the turn.
 *  2. **Preferred** — the curated per-band list in `lib/chat/model-choice`,
 *     the band read from the message text and attachment facts by
 *     `lib/chat/model-band` (document attachments floor it at `standard`).
 *  3. **Cheapest** — lowest output price among the eligible pool.
 *
 * The candidate world is the SAME walk the composer's picker uses
 * ({@link walkChatCatalog}), narrowed to direct-capable credentials
 * (api-key/env): a subscription credential forces a sandbox harness and
 * cannot back the chat wire, so Auto must never pick a model only a
 * subscription serves — the picker may list it, but as a pinnable option,
 * not a route target. Governance filtering runs server-side on the same
 * candidate ids the picker would show, so Auto and the picker can never
 * disagree about what the user may run.
 *
 * Every pick logs one line — (org, provider, model, source, band) — so a
 * surprising route is greppable without a gateway request log (the lesson
 * the vision lane paid for once already).
 */

import {
  assessPromptBand,
  chooseChatModel,
  eligibleChatCandidates,
  type ChatAutoRefusal,
  type ModelBand,
} from '../../../lib/chat';
import type { ModelCatalogEntry } from '../../../lib/shared/schemas/providers';
import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { walkChatCatalog } from './chat_catalog';

/** Why an Auto turn refused instead of resolving: the pure screens'
 * reasons, plus the governance-empty case only this layer can see. */
export type ChatAutoResolutionRefusal = ChatAutoRefusal | 'no-accessible-model';

export interface ChatModelPick {
  providerSlug: string;
  modelId: string;
  source: 'pinned' | 'preferred' | 'cheapest';
  band: ModelBand;
  highStakes: boolean;
  documentWork: boolean;
}

export type ChatModelResolution =
  | { ok: true; pick: ChatModelPick }
  | { ok: false; refusal: ChatAutoResolutionRefusal };

export interface ResolveChatModelArgs {
  organizationId: string;
  userId: string;
  /** Identity fallbacks for member resolution (email-provisioned rows). */
  userEmail?: string;
  userName?: string;
  /** The user text of THIS message — the band is per-message on purpose. */
  promptText: string;
  /** The message carries images, so only vision models may answer. */
  requiresVision: boolean;
  /** The message carries document attachments (non-image, non-audio/video),
   * so the band never lands below `standard`. */
  hasDocumentAttachments: boolean;
}

export async function resolveChatModel(
  ctx: ActionCtx,
  args: ResolveChatModelArgs,
): Promise<ChatModelResolution> {
  const credentials = (
    await ctx.runQuery(
      internal.provider_credentials.queries.listActiveCredentialFactsInternal,
      { organizationId: args.organizationId },
    )
  ).filter(
    (credential) =>
      credential.authMethod === 'api-key' || credential.authMethod === 'env',
  );

  const hits = await walkChatCatalog(ctx, args.organizationId, credentials);
  // First-wins per (connector, id): two direct credentials serving the same
  // catalog produce identical entries, so the duplicate carries nothing.
  const providerByEntry = new Map<ModelCatalogEntry, string>();
  const seen = new Set<string>();
  for (const hit of hits) {
    const key = `${hit.connector.name} ${hit.entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    providerByEntry.set(hit.entry, hit.connector.name);
  }
  const entries = [...providerByEntry.keys()];

  // Per-user governance over the SAME ids the picker would offer, plus the
  // admin's default_models pin, in one identity-explicit round trip.
  const governance = await ctx.runQuery(
    internal.governance.internal_queries.resolveModelGovernanceInternal,
    {
      organizationId: args.organizationId,
      userId: args.userId,
      ...(args.userEmail !== undefined ? { userEmail: args.userEmail } : {}),
      ...(args.userName !== undefined ? { userName: args.userName } : {}),
      supportedModels: [...new Set(entries.map((entry) => entry.id))],
    },
  );
  const accessible = new Set(governance.accessibleModelRefs);
  const allowed = entries.filter((entry) => accessible.has(entry.id));

  const screened = eligibleChatCandidates(allowed, {
    requiresVision: args.requiresVision,
  });
  if ('refusal' in screened) {
    // When the unfiltered walk had chat entries but the governance-allowed
    // subset has none, the truthful reason is the access policy, not an
    // empty catalog.
    const refusal: ChatAutoResolutionRefusal =
      screened.refusal === 'no-chat-model' && allowed.length < entries.length
        ? 'no-accessible-model'
        : screened.refusal;
    console.warn(
      `[chat-model] no auto pick for ${args.organizationId}: ${refusal}`,
    );
    return { ok: false, refusal };
  }
  const pool = screened.pool;

  const { band, highStakes, documentWork } = assessPromptBand(args.promptText, {
    documentAttachments: args.hasDocumentAttachments,
  });

  const pinned = governance.defaultModel;
  if (pinned !== undefined) {
    const entry = pool.find(
      (candidate) =>
        providerByEntry.get(candidate) === pinned.providerName &&
        candidate.id === pinned.modelId,
    );
    if (entry !== undefined) {
      const pick: ChatModelPick = {
        providerSlug: pinned.providerName,
        modelId: pinned.modelId,
        source: 'pinned',
        band,
        highStakes,
        documentWork,
      };
      logPick(args.organizationId, pick);
      return { ok: true, pick };
    }
    // Not in the eligible pool: the credential rotated away, the model left
    // the catalog, or the message needs vision the pin doesn't have. The
    // admin's rule degrades to auto-selection rather than failing the turn.
    console.warn(
      `[chat-model] pinned default ${pinned.providerName}/${pinned.modelId} is not currently servable for this turn (falling back to automatic selection)`,
    );
  }

  const choice = chooseChatModel(pool, band);
  if (choice === null) {
    // Unreachable while eligibleChatCandidates refuses empty pools first;
    // kept as a guard so a future screen change cannot return "no pick"
    // silently.
    console.warn(
      `[chat-model] no auto pick for ${args.organizationId}: empty pool after screening`,
    );
    return { ok: false, refusal: 'no-chat-model' };
  }
  const pick: ChatModelPick = {
    providerSlug: providerByEntry.get(choice.entry) ?? choice.entry.provider,
    modelId: choice.entry.id,
    source: choice.source,
    band,
    highStakes,
    documentWork,
  };
  logPick(args.organizationId, pick);
  return { ok: true, pick };
}

/** The one place every Auto pick is logged. */
function logPick(organizationId: string, pick: ChatModelPick): void {
  console.log(
    `[chat-model] resolved ${pick.providerSlug}/${pick.modelId} for ${organizationId} (${pick.source}, band=${pick.band}${pick.highStakes ? ', high-stakes' : ''}${pick.documentWork ? ', doc-attachments' : ''})`,
  );
}
