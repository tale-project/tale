'use node';

/**
 * Fire-and-forget AI naming of a thread from its first user message.
 *
 * Scheduled by `appendMessageInternal` exactly once per thread — when the
 * first user message lands on a thread that has no title yet. The generation
 * is best-effort with a hard budget: one small model call raced against a
 * timeout, and on ANY miss (no usable model, provider failure, empty reply,
 * timeout) the title falls back to a trimmed slice of the user's own words —
 * a wall of identically-named conversations is exactly what this exists to
 * prevent. A thread is never left waiting on its name: the write is guarded
 * (`setThreadTitleInternal` only fills an absent title) and failures are
 * logged, never surfaced into the turn.
 *
 * The model is resolved independently of the turn's lane: the first connector
 * whose DEFAULT credential is direct-capable (api-key/env) serves the call,
 * through the same one-shot wire the automations builder uses. An external
 * (harness) turn thus still gets a title, even though its own model only
 * answers inside the sandbox.
 *
 * `'use node'` by necessity — connector resolution reads the org's config
 * files, and the model call is an outbound fetch.
 */

import { v } from 'convex/values';

import { deriveFallbackTitle } from '../../lib/chat/derive-fallback-title';
import type { ModelCatalogEntry } from '../../lib/shared/schemas/providers';
import { internal } from '../_generated/api';
import { internalAction, type ActionCtx } from '../_generated/server';
import { createBuilderModel } from '../automations_builder/model_call';
import { getProviderCatalog } from '../lib/providers/catalog_fetch';
import { directActiveCredential } from '../lib/providers/direct_credential';
import { resolveProvidersForOrgId } from '../lib/providers/org_providers';

/** The whole naming attempt shares one wall-clock budget; past it the
 * fallback title wins and the reply, if it ever arrives, is discarded. */
const TITLE_TIMEOUT_MS = 10_000;
/** A title is a handful of words; anything longer is the model rambling. */
const TITLE_MAX_OUTPUT_TOKENS = 48;
/** Enough of the first message to name it; never the whole document. */
const FIRST_MESSAGE_MAX_CHARS = 4000;
/** Ceiling on the stored title, matching the summary column the list shows. */
const TITLE_MAX_LEN = 120;
/** Naming is mechanical — keep the sampling tight. */
const TITLE_TEMPERATURE = 0.3;

const TITLE_INSTRUCTIONS = `You are a title generator for chat conversations.

Given the user's first message below, produce a concise, descriptive title (3-6 words).
- Capture the core topic or intent
- Write the title in the language of the message
- Use title case when the language has one
- Do not wrap in quotes
- Do not add punctuation at the end
- Return ONLY the title text, nothing else`;

interface TitleModelTarget {
  readonly providerSlug: string;
  readonly modelId: string;
}

/**
 * The model the title call runs on. The thread owner's sticky chat pick wins
 * whenever a direct-credentialed connector serves it — the conversation is
 * then named by the same model its owner chats with, which is also the model
 * most likely to actually answer (an aggregator catalog is full of models a
 * given key or region cannot call). Only without a usable pick does the
 * fallback scan take over: the first connector (shipped order, then
 * org-defined) whose default credential is active and direct-capable, taking
 * its alphabetically first allowlist-permitted catalog model. Null when the
 * org has nothing a direct call could use; the caller falls back to the
 * derived title.
 */
async function pickTitleModel(
  ctx: ActionCtx,
  organizationId: string,
  preferredModelId: string | null,
): Promise<TitleModelTarget | null> {
  const connectors = await resolveProvidersForOrgId(ctx, organizationId);

  /** The connectors a direct call could use, catalogs resolved. */
  const candidates: Array<{
    providerSlug: string;
    allowlist: readonly string[] | undefined;
    catalogIds: readonly string[];
  }> = [];
  for (const connector of connectors) {
    const row: unknown = await ctx.runQuery(
      internal.provider_credentials.queries.getDefaultCredentialInternal,
      { organizationId, providerSlug: connector.name },
    );
    const credential = directActiveCredential(row);
    if (credential === null) continue;

    let catalog: readonly ModelCatalogEntry[];
    try {
      catalog = await getProviderCatalog(connector);
    } catch (error) {
      // One connector's unreachable /models endpoint must not cost the title;
      // skip it loudly and try the next.
      console.warn(
        `[generateThreadTitle] could not resolve catalog for "${connector.name}"`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }

    candidates.push({
      providerSlug: connector.name,
      allowlist: credential.modelAllowlist,
      catalogIds: catalog.map((entry) => entry.id),
    });
  }

  const permits = (
    candidate: (typeof candidates)[number],
    modelId: string,
  ): boolean =>
    candidate.allowlist === undefined || candidate.allowlist.includes(modelId);

  if (preferredModelId !== null) {
    const serving = candidates.find(
      (candidate) =>
        candidate.catalogIds.includes(preferredModelId) &&
        permits(candidate, preferredModelId),
    );
    if (serving) {
      return { providerSlug: serving.providerSlug, modelId: preferredModelId };
    }
  }

  for (const candidate of candidates) {
    const modelId = candidate.catalogIds
      .filter((id) => permits(candidate, id))
      .sort((a, b) => a.localeCompare(b))[0];
    if (modelId !== undefined) {
      return { providerSlug: candidate.providerSlug, modelId };
    }
  }
  return null;
}

/** One model attempt at a title, or null. Never throws — every miss (no
 * model, provider failure, empty reply) means "use the fallback", so errors
 * are logged here rather than escaping past the fallback write. */
async function generateWithModel(
  ctx: ActionCtx,
  organizationId: string,
  userId: string,
  firstMessage: string,
): Promise<string | null> {
  try {
    const preferredModelId: string | null = await ctx.runQuery(
      internal.user_preferences.queries.getChatModelInternal,
      { userId, organizationId },
    );
    const target = await pickTitleModel(ctx, organizationId, preferredModelId);
    if (target === null) return null;
    const model = createBuilderModel(ctx, {
      organizationId,
      target,
      maxTokens: TITLE_MAX_OUTPUT_TOKENS,
    });
    const reply = await model({
      messages: [
        { role: 'system', content: TITLE_INSTRUCTIONS },
        {
          role: 'user',
          content: firstMessage.slice(0, FIRST_MESSAGE_MAX_CHARS),
        },
      ],
      temperature: TITLE_TEMPERATURE,
      turn: 1,
    });
    const title = reply.content.replace(/\s+/g, ' ').trim();
    return title.length > 0 ? title.slice(0, TITLE_MAX_LEN) : null;
  } catch (error) {
    console.warn('[generateThreadTitle] model generation failed:', error);
    return null;
  }
}

/**
 * Name the thread from its first user message: the AI title when one arrives
 * inside the budget, else the derived fallback. The mutation behind the write
 * fills only an absent title, so a rename or branch copy racing this is never
 * clobbered.
 */
export const generateThreadTitle = internalAction({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    /** The thread owner — whose sticky model pick names the conversation. */
    userId: v.string(),
    firstMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // Cleared once the race settles — a won race must not leave a
    // ten-second timer holding the action's environment open.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const aiTitle = await Promise.race([
        generateWithModel(
          ctx,
          args.organizationId,
          args.userId,
          args.firstMessage,
        ),
        new Promise<null>((resolve) => {
          timeout = setTimeout(() => resolve(null), TITLE_TIMEOUT_MS);
        }),
      ]);
      const title = aiTitle ?? deriveFallbackTitle(args.firstMessage);
      if (title !== null) {
        await ctx.runMutation(internal.chat.threads.setThreadTitleInternal, {
          organizationId: args.organizationId,
          threadId: args.threadId,
          title,
        });
      }
    } catch (error) {
      console.warn(
        `[generateThreadTitle] failed for thread ${args.threadId}:`,
        error,
      );
    } finally {
      clearTimeout(timeout);
    }
    return null;
  },
});
