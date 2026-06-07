'use node';

/**
 * Dev-only "direct HTTP" TTFT probe.
 *
 * Streams a message straight to the org's chat model through the SAME wrapped
 * model the chat pipeline uses (`createLanguageModel` via `resolveLanguageModel*`)
 * — but WITHOUT the @convex-dev/agent persistence / delta / scheduler layers.
 * It times the raw model response so a developer can compare:
 *
 *   pipeline `timeFromSendMs` / `timeToFirstReasoningMs`  (from message metadata)
 *   vs  direct  ttfb / first-reasoning / first-content     (from this probe)
 *
 * The delta is our backend overhead. Honesty caveat: this measures the model's
 * floor for a MINIMAL prompt (the given message, reasoning via base provider
 * options, NO tools / RAG / history / system prompt), so it is the
 * lower-bound model floor — it does NOT reproduce the pipeline's full prefill.
 *
 * Cost: this issues a REAL (billed) provider call and bypasses usageLedger /
 * budget enforcement. It aborts the moment first content arrives so it never
 * pays for a full completion, but it is not free — hence the dev/admin gate.
 */

import { streamText } from 'ai';
import { ConvexError, v } from 'convex/values';

import { action, type ActionCtx } from '../_generated/server';
import { isDeploymentEditor } from '../deployment/editors';
import { buildCallProviderOptions } from '../lib/provider_options';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { resolveLanguageModelWithFallback } from '../providers/failover';
import { resolveLanguageModelById } from '../providers/resolve_model';

/** Hard ceiling so a hung provider can't pin a node-action slot. */
const PROBE_TIMEOUT_MS = 30_000;
/** Don't send unbounded prompts to the provider. */
const MAX_PROMPT_CHARS = 8_000;

/**
 * Resolve a chat model for the probe, tolerant of the fact that `metadata.model`
 * is the provider's *response* id — which can carry a date/version suffix (e.g.
 * `deepseek/deepseek-v4-flash-20260423`) that the provider config does NOT
 * register (it lists the undated `deepseek/deepseek-v4-flash`). Tries the exact
 * id, then the undated form, then falls back to the org's chat-tagged model so a
 * dev probe never dead-ends on an unresolvable recorded id. The returned
 * `modelData.modelId` reflects what was actually measured.
 */
async function resolveProbeModel(
  ctx: ActionCtx,
  organizationId: string,
  modelId?: string,
) {
  if (modelId) {
    const candidates = [modelId, modelId.replace(/-\d{6,8}$/, '')].filter(
      (id, i, arr) => id.length > 0 && arr.indexOf(id) === i,
    );
    for (const id of candidates) {
      try {
        return await resolveLanguageModelById(ctx, {
          modelId: id,
          organizationId,
        });
      } catch (err) {
        console.warn(
          `[direct_ttft] model "${id}" not resolvable; trying next candidate`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
  return resolveLanguageModelWithFallback(ctx, { tag: 'chat', organizationId });
}

export const measureDirectTtft = action({
  args: {
    organizationId: v.string(),
    message: v.string(),
    // Measure the SAME model a given message used (pass `metadata.model`).
    // Falls back to the org's chat-tagged model when omitted.
    modelId: v.optional(v.string()),
  },
  returns: v.object({
    modelId: v.string(),
    provider: v.string(),
    ttfbMs: v.optional(v.number()),
    firstReasoningMs: v.optional(v.number()),
    firstContentMs: v.optional(v.number()),
    totalMs: v.number(),
    promptChars: v.number(),
    aborted: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Fail-closed dev/admin gate. Reuses the deployment-editor allowlist
    // (`TALE_DEPLOYMENT_CONFIG_ADMINS`); an empty/unset allowlist => nobody.
    // Enforced HERE (the UI button's visibility query is advisory only).
    const user = await getAuthUserIdentity(ctx);
    if (!isDeploymentEditor(user?.email)) {
      throw new ConvexError({ code: 'FORBIDDEN' });
    }

    const prompt = args.message.slice(0, MAX_PROMPT_CHARS);

    const { languageModel, modelData } = await resolveProbeModel(
      ctx,
      args.organizationId,
      args.modelId,
    );

    const providerOptions = buildCallProviderOptions(modelData);
    const abort = new AbortController();
    const t0 = Date.now();
    let ttfbMs: number | undefined;
    let firstReasoningMs: number | undefined;
    let firstContentMs: number | undefined;
    let aborted = false;

    const timeout = setTimeout(() => {
      aborted = true;
      abort.abort();
    }, PROBE_TIMEOUT_MS);

    try {
      const result = streamText({
        model: languageModel,
        prompt,
        abortSignal: abort.signal,
        ...(providerOptions ? { providerOptions } : {}),
      });

      // Drive the stream just until first content (which always follows
      // reasoning), then abort so we don't pay for the whole completion.
      for await (const part of result.fullStream) {
        const now = Date.now();
        if (ttfbMs === undefined) ttfbMs = now - t0;
        if (part.type === 'reasoning-delta' && firstReasoningMs === undefined) {
          firstReasoningMs = now - t0;
        }
        if (part.type === 'text-delta' && firstContentMs === undefined) {
          firstContentMs = now - t0;
          aborted = true;
          abort.abort();
          break;
        }
        if (part.type === 'error') {
          // Surface provider/stream errors — but never echo the raw provider
          // body (it can carry the apiKey); cap to a short sanitized string.
          const msg =
            part.error instanceof Error
              ? part.error.message
              : String(part.error);
          throw new ConvexError({
            code: 'PROBE_FAILED',
            message: msg.slice(0, 200),
          });
        }
      }
    } catch (err) {
      // Aborting after we captured timings surfaces as an AbortError — expected.
      // Anything else is a real failure; re-throw sanitized (no apiKey leak).
      if (!aborted) {
        if (err instanceof ConvexError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        throw new ConvexError({
          code: 'PROBE_FAILED',
          message: msg.slice(0, 200),
        });
      }
    } finally {
      clearTimeout(timeout);
    }

    return {
      modelId: modelData.modelId,
      provider: modelData.providerName,
      ttfbMs,
      firstReasoningMs,
      firstContentMs,
      totalMs: Date.now() - t0,
      promptChars: prompt.length,
      aborted,
    };
  },
});
