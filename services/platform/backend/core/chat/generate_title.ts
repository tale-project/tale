'use node';

import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import { modelAllowlistPermits } from '@tale/shared/utils/model-ref';

import { deriveFallbackTitle } from '../../../lib/chat/derive-fallback-title';
import { estimateTokens } from '../../../lib/chat/types';
import { EmptyReplyError } from '../automations_builder/chat_wire';
import { createBuilderModel } from '../automations_builder/model_call';
import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import { directActiveCredential } from '../lib/providers/direct_credential';
import { resolveProvidersForOrgId } from '../lib/providers/org_providers';
import { getServableCatalog } from '../lib/providers/servable_catalog';

/** The whole naming attempt shares one wall-clock budget; past it the
 * fallback title wins and the model call is ABORTED — a reply that can no
 * longer be used must not keep the provider working (and billing) for the
 * client's full request timeout. */
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

export interface DirectModelTarget {
  readonly providerSlug: string;
  readonly modelId: string;
}

/** The thread owner's sticky chat pick, as the preferences shim answers it:
 * the model id and, when the pick carried one, the connector serving it. */
export interface PreferredChatModel {
  readonly modelId: string;
  readonly providerSlug?: string;
}

/**
 * A catalog entry the wire can run WITHOUT thinking: no reasoning knob at
 * all, or an effort knob with a declared off literal the wire spells. A
 * thinking-by-default model with no off literal spends the title's whole
 * 48-token budget reasoning and answers nothing — a paid miss.
 */
/** The accessible models the governance read answered, off the untyped
 * ctx seam; none when it answered something else. */
function accessibleModelRefsOf(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  const refs: unknown = Reflect.get(value, 'accessibleModelRefs');
  return Array.isArray(refs)
    ? refs.filter((ref): ref is string => typeof ref === 'string')
    : [];
}

function runsWithoutThinking(entry: ModelCatalogEntry): boolean {
  return entry.reasoning === undefined || entry.reasoning.off !== undefined;
}

/**
 * The model a small direct call runs on — the title lane's pick, shared with
 * the Inbox rewrite (`domains/conversations/improve.ts`), which needs the
 * same "whatever a direct credential can serve" answer.
 *
 * A model the wire can run without
 * thinking is preferred throughout (see {@link runsWithoutThinking}): the
 * thread owner's sticky chat pick wins whenever a direct-credentialed
 * connector serves it (the connector the pick names, when it names one)
 * and it needs no thinking — the conversation is then
 * named by the same model its owner chats with, which is also the model
 * most likely to actually answer (an aggregator catalog is full of models a
 * given key or region cannot call); else the first connector (shipped
 * order, then org-defined) whose default credential is active and
 * direct-capable, taking its alphabetically first allowlist-permitted
 * thinking-free catalog model. Only when nothing runs without thinking does
 * the same walk take a thinking model (the pick, then the first permitted).
 * Null when the org has nothing a direct call could use; the caller falls
 * back to the derived title.
 */
export async function pickDirectModel(
  ctx: ActionCtx,
  organizationId: string,
  preferred: PreferredChatModel | null,
  /** Whose call it is: only a model the organization's model access rules
   * let them use is picked, as for their chat turns. */
  userId: string,
): Promise<DirectModelTarget | null> {
  const connectors = await resolveProvidersForOrgId(ctx, organizationId);

  /** The connectors a direct call could use, catalogs resolved. */
  const candidates: Array<{
    providerSlug: string;
    allowlist: readonly string[] | undefined;
    catalog: readonly ModelCatalogEntry[];
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
      catalog = await getServableCatalog(connector, credential.modelAllowlist);
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
      catalog,
    });
  }

  // The models the member may use, under the organization's model access
  // rules — one read for every candidate, as the composer's picker filters.
  const governance: unknown = await ctx.runQuery(
    internal.governance.internal_queries.resolveModelGovernanceInternal,
    {
      organizationId,
      userId,
      supportedModels: [
        ...new Set(
          candidates.flatMap((candidate) =>
            candidate.catalog.map((entry) => entry.id),
          ),
        ),
      ],
    },
  );
  const accessible = new Set(accessibleModelRefsOf(governance));

  // The shared allowlist predicate (dialect-equivalent ids admit) — the
  // one the picker, the serving checks and the voice resolvers apply.
  const permits = (
    candidate: (typeof candidates)[number],
    modelId: string,
  ): boolean =>
    accessible.has(modelId) &&
    modelAllowlistPermits(candidate.allowlist, modelId);

  const walk = (
    admits: (entry: ModelCatalogEntry) => boolean,
  ): DirectModelTarget | null => {
    if (preferred !== null) {
      const serves = (candidate: (typeof candidates)[number]): boolean =>
        candidate.catalog.some(
          (entry) =>
            entry.id === preferred.modelId &&
            admits(entry) &&
            permits(candidate, entry.id),
        );
      // The copy the user picked when the pick named its provider — two
      // connectors listing one id are different wires with different keys —
      // else whichever connector serves the id.
      const named =
        preferred.providerSlug === undefined
          ? undefined
          : candidates.find(
              (candidate) =>
                candidate.providerSlug === preferred.providerSlug &&
                serves(candidate),
            );
      const serving = named ?? candidates.find(serves);
      if (serving) {
        return {
          providerSlug: serving.providerSlug,
          modelId: preferred.modelId,
        };
      }
    }
    for (const candidate of candidates) {
      const modelId = candidate.catalog
        .filter((entry) => admits(entry) && permits(candidate, entry.id))
        .map((entry) => entry.id)
        .sort((a, b) => a.localeCompare(b))[0];
      if (modelId !== undefined) {
        return { providerSlug: candidate.providerSlug, modelId };
      }
    }
    return null;
  };

  return walk(runsWithoutThinking) ?? walk(() => true);
}

/** The agent slug the title call books its tokens under. Distinct from the
 *  turn's, so analytics can tell "what the conversation cost" from "what
 *  naming it cost" instead of blending them. */
export const TITLE_AGENT_SLUG = 'thread-title';

/** Where a naming attempt's call is held and booked. Injected rather than
 *  reached for, the way the connector bridge takes its dispatch: this body
 *  runs on a ctx shim that has no ledger of its own. Naming a thread is a
 *  model call the organization pays for — small, but held against the
 *  member's limits while it runs and booked after it, whether or not its
 *  reply makes a usable title. */
export interface TitleMeter {
  /** Hold the call's worst case; `null` when a limit refuses it. */
  open(call: {
    provider: string;
    model: string;
    promptTokens: number;
    maxOutputTokens: number;
  }): Promise<{ lease: unknown } | null>;
  /** Book what the call reported in its hold's place. */
  settle(
    lease: unknown,
    usage: {
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
    },
  ): Promise<void>;
  /** Release the hold of a call that reported nothing. */
  release(lease: unknown): Promise<void>;
}

/** One model attempt at a title. Never throws — every miss (no model, a
 * reached limit, provider failure, empty reply) means "use the fallback",
 * so errors are logged here rather than escaping past the fallback write. */
async function generateWithModel(
  ctx: ActionCtx,
  organizationId: string,
  userId: string,
  firstMessage: string,
  signal: AbortSignal,
  meter: TitleMeter | undefined,
): Promise<string | null> {
  let target: DirectModelTarget | null = null;
  let lease: unknown;
  const book = async (usage: { prompt: number; completion: number }) => {
    if (meter === undefined || target === null) return;
    await meter
      .settle(lease, {
        provider: target.providerSlug,
        model: target.modelId,
        inputTokens: usage.prompt,
        outputTokens: usage.completion,
      })
      .catch((error: unknown) => {
        // Best-effort: a ledger failure must not cost the title.
        console.warn('[generateThreadTitle] usage write failed:', error);
      });
  };
  const release = async () => {
    if (meter === undefined) return;
    await meter.release(lease).catch((error: unknown) => {
      console.warn(
        "[generateThreadTitle] releasing the call's hold failed; it lapses at its deadline:",
        error,
      );
    });
  };
  try {
    const preferred: PreferredChatModel | null = await ctx.runQuery(
      internal.user_preferences.queries.getChatModelInternal,
      { userId, organizationId },
    );
    target = await pickDirectModel(ctx, organizationId, preferred, userId);
    if (target === null) return null;
    const messages = [
      { role: 'system', content: TITLE_INSTRUCTIONS } as const,
      {
        role: 'user',
        content: firstMessage.slice(0, FIRST_MESSAGE_MAX_CHARS),
      } as const,
    ];
    if (meter !== undefined) {
      const admitted = await meter.open({
        provider: target.providerSlug,
        model: target.modelId,
        promptTokens: estimateTokens(
          messages.map((message) => message.content).join('\n'),
        ),
        maxOutputTokens: TITLE_MAX_OUTPUT_TOKENS,
      });
      if (admitted === null) {
        // A limit the member reached binds the title too: no call.
        console.warn(
          '[generateThreadTitle] a usage limit refused the naming call; fallback title used',
        );
        return null;
      }
      lease = admitted.lease;
    }
    const model = createBuilderModel(ctx, {
      organizationId,
      target,
      maxTokens: TITLE_MAX_OUTPUT_TOKENS,
      signal,
    });
    const reply = await model({
      messages,
      temperature: TITLE_TEMPERATURE,
      turn: 1,
    });
    // The call happened whether or not the reply was usable — a ledger
    // that counted only good titles would under-report the bill.
    if (reply.usage !== undefined) await book(reply.usage);
    else await release();
    const title = reply.content.replace(/\s+/g, ' ').trim();
    return title.length > 0 ? title.slice(0, TITLE_MAX_LEN) : null;
  } catch (error) {
    if (error instanceof EmptyReplyError && target !== null) {
      // The call happened — a thinking-by-default model spent the reply
      // budget reasoning and said nothing. A miss, not a fault: one line,
      // no stack, and the tokens it cost are booked with the fallback.
      console.warn(
        `[generateThreadTitle] ${target.providerSlug}/${target.modelId} returned no text (${error.usage.prompt} in, ${error.usage.completion} out); fallback title used`,
      );
      await book(error.usage);
      return null;
    }
    await release();
    if (signal.aborted) {
      // The race was lost and the call torn down on purpose — the fallback
      // title is already on its way; this is the expected shape, not a fault.
      console.warn(
        `[generateThreadTitle] model call aborted after ${TITLE_TIMEOUT_MS}ms; fallback title used`,
      );
      return null;
    }
    console.warn('[generateThreadTitle] model generation failed:', error);
    return null;
  }
}

/** The naming attempt as a PLAIN exported function — the internalAction
 * above wraps it, and the 0.5 backend's `chat.generate_title` job runs it
 * on the ctx shim (same pattern as the turn engine). */
export async function generateThreadTitleImpl(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    threadId: string;
    userId: string;
    firstMessage: string;
    /** A guardrail refused the message: it is never sent to a model, so
     * the thread is named from its own words. */
    nameWithoutModel?: boolean;
  },
  meter?: TitleMeter,
): Promise<null> {
  {
    // Cleared once the race settles — a won race must not leave a
    // ten-second timer holding the action's environment open.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // Losing the race aborts the model call: its reply could no longer be
    // used, so letting it run on would be unbilled, unusable provider work.
    const deadline = new AbortController();
    try {
      const attempt =
        args.nameWithoutModel === true
          ? null
          : await Promise.race([
              generateWithModel(
                ctx,
                args.organizationId,
                args.userId,
                args.firstMessage,
                deadline.signal,
                meter,
              ),
              new Promise<string | null>((resolve) => {
                timeout = setTimeout(() => {
                  deadline.abort();
                  resolve(null);
                }, TITLE_TIMEOUT_MS);
              }),
            ]);
      const title = attempt ?? deriveFallbackTitle(args.firstMessage);
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
  }
}
