'use node';

/**
 * Direct-mode image generation runtime.
 *
 * Called for agents with `primaryBehavior === 'image-generation'`. Bypasses
 * the chat-loop generate_response pipeline entirely — the user's latest
 * message (text + any attached images) is sent straight to an image model
 * via AI SDK, and the resulting image(s) are saved as an assistant message.
 */

import { saveMessage } from '@convex-dev/agent';
import { generateImage } from 'ai';
import { v } from 'convex/values';

import { parseModelRef } from '../../../lib/shared/utils/model-ref';
import { components, internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { internalAction } from '../../_generated/server';
import { onAgentComplete } from '../../lib/agent_completion';
import { createDebugLog } from '../../lib/debug_log';
import { buildDownloadUrl } from '../../lib/helpers/public_storage_url';
import {
  buildCallProviderOptions,
  stripDenyListed,
} from '../../lib/provider_options';
import {
  resolveImageModelById,
  resolveImageModelByTag,
  type ResolvedImageModel,
} from '../../providers/resolve_model';

const debugLog = createDebugLog(
  'DEBUG_IMAGE_GENERATION',
  '[runImageGeneration]',
);

/** Input: an image attachment from the user's turn. */
const attachmentImageValidator = v.object({
  fileId: v.string(),
  fileName: v.string(),
  mimeType: v.string(),
});

export const runImageGeneration = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    /**
     * Model reference in `provider:model-id` form, or bare `model-id`.
     * Empty string falls back to the org's `image-generation` tag default.
     */
    modelRef: v.string(),
    /** Raw user text prompt (without attachment markdown). */
    rawPrompt: v.string(),
    /** Optional style/constraint prefix from the agent config. */
    systemInstructions: v.optional(v.string()),
    /** Image attachments on the user message. Used for edit mode. */
    attachmentImages: v.optional(v.array(attachmentImageValidator)),
    /** Persistent stream id created at startAgentChat time. */
    streamId: v.optional(v.string()),
    /** Agent slug for telemetry/audit. */
    agentSlug: v.optional(v.string()),
    /** Org slug for provider resolution. */
    orgSlug: v.optional(v.string()),
    /** For usage ledger. */
    organizationId: v.optional(v.string()),
    userId: v.optional(v.string()),
    teamIds: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const agentSlug = args.agentSlug ?? 'image-creator';

    try {
      // Resolve model (by qualified ref if provided, else by image-generation tag)
      let resolved: ResolvedImageModel;
      if (args.modelRef && args.modelRef !== 'default') {
        const { providerName, modelId } = parseModelRef(args.modelRef);
        resolved = await resolveImageModelById(ctx, {
          modelId,
          providerName,
          orgSlug: args.orgSlug,
        });
      } else {
        resolved = await resolveImageModelByTag(ctx, {
          orgSlug: args.orgSlug,
        });
      }

      // Resolve bytes for any attached images (edit mode). We read the raw
      // bytes from Convex storage and pass them as Uint8Array to the AI SDK —
      // passing a URL would fail because the gateway cannot reach our dev
      // localhost, and even in prod there are auth/proxy complications that
      // sending bytes sidesteps entirely.
      const attachmentImages = args.attachmentImages ?? [];
      const attachmentBytes: Array<{ bytes: Uint8Array; mediaType: string }> =
        [];
      for (const att of attachmentImages) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- storage ids round-trip through v.string(); Id<'_storage'> is the branded string ctx.storage.get expects.
        const blob = await ctx.storage.get(att.fileId as Id<'_storage'>);
        if (!blob) continue;
        const buf = new Uint8Array(await blob.arrayBuffer());
        attachmentBytes.push({
          bytes: buf,
          mediaType: att.mimeType || blob.type || 'image/png',
        });
      }
      const hasAttachments = attachmentBytes.length > 0;

      // Edit-mode guard — text-only models cannot consume reference images.
      if (hasAttachments && !resolved.modelData.tags.includes('image-edit')) {
        throw new Error(
          `Model "${resolved.modelData.modelId}" does not support image editing. ` +
            'Switch to FLUX Kontext or Nano Banana to use attached images as references.',
        );
      }

      // Build prompt: optional systemInstructions prefix + user message text
      const textPrompt = args.systemInstructions
        ? `${args.systemInstructions}\n\n${args.rawPrompt}`
        : args.rawPrompt;

      debugLog('generating', {
        threadId: args.threadId,
        modelId: resolved.modelData.modelId,
        mode: resolved.kind,
        hasAttachments,
        attachmentCount: attachmentBytes.length,
      });

      // Call the appropriate AI SDK function.
      const imageBlobs: Array<{
        bytes: Uint8Array;
        mediaType: string;
      }> = [];
      let usage:
        | { inputTokens: number; outputTokens: number; totalTokens: number }
        | undefined;
      let providerCostUsd: number | undefined;

      if (resolved.kind === 'images-api') {
        // `prompt.images` at the AI SDK level routes to the standard OpenAI
        // `/v1/images/edits` multipart endpoint — supported by LocalAI,
        // LiteLLM, self-hosted gateways, and OpenAI itself. Gateways that
        // don't expose `/v1/images/edits` (e.g. Vercel AI Gateway) will fail
        // here; remove the `image-edit` tag from those models so the UI
        // never sends edit requests to them.
        const promptArg: string | { text: string; images: Uint8Array[] } =
          hasAttachments
            ? {
                text: textPrompt,
                images: attachmentBytes.map((a) => a.bytes),
              }
            : textPrompt;

        const imageProviderOptions = buildCallProviderOptions(
          resolved.modelData,
        );
        const result = await generateImage({
          model: resolved.imageModel,
          prompt: promptArg,
          n: 1,
          ...(imageProviderOptions
            ? { providerOptions: imageProviderOptions }
            : {}),
        });
        for (const img of result.images) {
          imageBlobs.push({
            bytes: img.uint8Array,
            mediaType: img.mediaType || 'image/png',
          });
        }
      } else {
        // chat-multimodal — Nano Banana / GPT-Image / OpenRouter FLUX / etc.
        //
        // We do NOT go through @ai-sdk/openai-compatible here: its chat
        // response parser reads only `choices[0].message.content` and
        // `.tool_calls`, silently dropping `choices[0].message.images[]`
        // — which is exactly where gateways (OpenRouter, Vercel Gateway,
        // plus the OpenAI gpt-image-in-chat spec) put generated images.
        // `generateText` would therefore always see `result.files === []`.
        //
        // The wire shape is well-defined, so we issue the /chat/completions
        // call directly and parse the images out ourselves.
        const {
          images: extractedImages,
          usage: extractedUsage,
          providerCostUsd: extractedCostUsd,
        } = await fetchChatCompletionImages({
          baseUrl: resolved.modelData.baseUrl,
          apiKey: resolved.modelData.apiKey,
          modelId: resolved.modelData.modelId,
          textPrompt,
          attachmentImages: attachmentBytes,
          providerOptions: stripDenyListed(resolved.modelData.providerOptions),
        });
        for (const img of extractedImages) imageBlobs.push(img);
        usage = extractedUsage;
        providerCostUsd = extractedCostUsd;
      }

      if (imageBlobs.length === 0) {
        throw new Error(
          `Model "${resolved.modelData.modelId}" returned no image.`,
        );
      }

      // Persist image blobs to Convex storage and build downloadable file parts.
      // Use buildDownloadUrl so the URL is (a) browser-accessible via the
      // public HTTP API proxy and (b) carries ?id=<storageId>, which the
      // frontend's EditingBanner depends on to round-trip the image as a
      // reference attachment for edit-mode requests.
      const fileParts = await Promise.all(
        imageBlobs.map(async (img, idx) => {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Uint8Array<ArrayBufferLike> ↔ BlobPart mismatch is a TS strictness quirk; runtime is fine.
          const blob = new Blob([img.bytes as BlobPart], {
            type: img.mediaType,
          });
          const storageId = await ctx.storage.store(blob);
          const extension = img.mediaType.split('/')[1] ?? 'png';
          const fileName = `${agentSlug}-${Date.now()}-${idx + 1}.${extension}`;
          const downloadUrl = buildDownloadUrl(storageId, fileName);
          return {
            type: 'file' as const,
            mimeType: img.mediaType,
            data: downloadUrl,
            filename: fileName,
          };
        }),
      );

      // Save assistant message with image file parts. Do NOT pass
      // promptMessageId: that's for attaching an extra file part to an existing
      // assistant message at the same `order` as the prompt. For a brand-new
      // assistant reply we let the SDK allocate the next `order` naturally —
      // otherwise the image ends up collocated with the user turn and the
      // next user message renders directly under it as if this one never
      // responded.
      const { messageId } = await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        message: {
          role: 'assistant',
          content: fileParts,
        },
      });

      const durationMs = Date.now() - startedAt;

      // Cost accounting. Prefer the gateway's billed USD amount
      // (`usage.cost` from OpenRouter-compatible responses) — it accounts
      // for resolution-dependent pricing that a flat per-image rate cannot
      // express (FLUX.2 charges per megapixel). Fall back to the model's
      // `imageCentsPerImage` when no provider cost was reported, and to
      // token-derived math (computed in onAgentComplete) otherwise.
      const perImageCost = resolved.modelData.imageCentsPerImage;
      const imageCostCents =
        providerCostUsd != null
          ? providerCostUsd * 100
          : perImageCost != null
            ? imageBlobs.length * perImageCost
            : undefined;

      // Usage ledger + audit (best effort — don't fail the turn on telemetry)
      try {
        await onAgentComplete(ctx, {
          threadId: args.threadId,
          agentType: 'image-generation',
          agentSlug,
          organizationId: args.organizationId,
          userId: args.userId,
          teamIds: args.teamIds,
          result: {
            threadId: args.threadId,
            messageId,
            model: resolved.modelData.modelId,
            provider: resolved.modelData.providerName,
            usage: usage ?? {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            },
            durationMs,
          },
          providerCost:
            resolved.modelData.inputCentsPerMillion != null
              ? {
                  inputCentsPerMillion: resolved.modelData.inputCentsPerMillion,
                  outputCentsPerMillion:
                    resolved.modelData.outputCentsPerMillion ?? 0,
                }
              : undefined,
          costCentsOverride: imageCostCents,
        });
      } catch (telemetryErr) {
        console.warn('[runImageGeneration] telemetry failed:', telemetryErr);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[runImageGeneration] failed:', {
        threadId: args.threadId,
        modelRef: args.modelRef,
        error: message,
      });

      // Surface a failed assistant message so the UI has something to render.
      // Same ordering rule as the success path above — no promptMessageId.
      try {
        await saveMessage(ctx, components.agent, {
          threadId: args.threadId,
          message: {
            role: 'assistant',
            content: `Image generation failed: ${message}`,
          },
          metadata: {
            status: 'failed',
            error: message,
          },
        });
      } catch (saveErr) {
        console.error(
          '[runImageGeneration] also failed to save error message:',
          saveErr,
        );
      }
    } finally {
      // Always clear the generation status so the UI stops showing "Thinking..."
      if (args.streamId) {
        try {
          await ctx.runMutation(
            internal.threads.internal_mutations.clearGenerationStatus,
            { threadId: args.threadId, streamId: args.streamId },
          );
        } catch (clearErr) {
          console.error(
            '[runImageGeneration] failed to clear generation status:',
            clearErr,
          );
        }
      }
    }

    return null;
  },
});

interface ChatCompletionsImageResult {
  images: Array<{ bytes: Uint8Array; mediaType: string }>;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  /**
   * Actual cost in USD reported by the gateway (OpenRouter exposes this via
   * `usage.cost`). Undefined when the gateway doesn't return a cost field,
   * in which case callers fall back to the model's static per-image price.
   */
  providerCostUsd?: number;
}

/**
 * Direct POST to `/chat/completions` with multimodal output, parsing image
 * data URIs out of `choices[0].message.images[].image_url.url`.
 *
 * This is the documented response shape used by OpenRouter and Vercel AI
 * Gateway for image-producing chat models, AND is what OpenAI itself
 * emits for its multimodal GPT-image-in-chat output. `@ai-sdk/openai-
 * compatible`'s chat response parser ignores `message.images`, so we go
 * direct instead of chasing AI SDK abstractions that don't know about it.
 */
async function fetchChatCompletionImages(opts: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  textPrompt: string;
  attachmentImages: Array<{ bytes: Uint8Array; mediaType: string }>;
  providerOptions?: Record<string, unknown>;
}): Promise<ChatCompletionsImageResult> {
  const userContent: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: opts.textPrompt }];
  for (const att of opts.attachmentImages) {
    const b64 = Buffer.from(att.bytes).toString('base64');
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${att.mediaType};base64,${b64}` },
    });
  }

  // Gateways that honor OpenAI's multimodal-output spec read `modalities`
  // as a top-level body field. Unknown-field tolerant gateways ignore it.
  // `usage.include` asks OpenRouter to return the actual USD cost in
  // `usage.cost` — megapixel-priced image models don't fit a flat per-image
  // rate, so we prefer the gateway's billed amount over a static estimate.
  //
  // Per-model `providerOptions` (already deny-list-stripped) spread first so
  // the protected keys below win on collision: `model`/`messages`/`modalities`
  // must never be overridable from config, and `usage` requires a nested
  // merge so callers can extend without dropping `include: true`.
  const incomingUsage =
    opts.providerOptions && typeof opts.providerOptions.usage === 'object'
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- usage is JSON-derived from provider config
        (opts.providerOptions.usage as Record<string, unknown>)
      : {};
  const body = {
    ...(opts.providerOptions ? opts.providerOptions : {}),
    model: opts.modelId,
    messages: [{ role: 'user', content: userContent }],
    modalities: ['image'],
    usage: { ...incomingUsage, include: true },
  };

  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `${opts.modelId} chat/completions failed (${response.status}): ${errText || response.statusText}`,
    );
  }

  const json = (await response.json()) as unknown;
  if (
    !json ||
    typeof json !== 'object' ||
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to object by the checks above
    !Array.isArray((json as { choices?: unknown }).choices)
  ) {
    throw new Error('Unexpected chat/completions response shape');
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by shape check above
  const body_ = json as {
    choices: Array<{
      message?: {
        content?: string | null;
        images?: Array<{
          type?: string;
          image_url?: { url?: string } | string;
        }>;
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    };
  };

  const rawImages = body_.choices[0]?.message?.images ?? [];
  const images: Array<{ bytes: Uint8Array; mediaType: string }> = [];
  for (const entry of rawImages) {
    const entryUrl =
      typeof entry.image_url === 'string'
        ? entry.image_url
        : entry.image_url?.url;
    if (!entryUrl) continue;
    const parsed = parseDataUri(entryUrl);
    if (parsed) images.push(parsed);
  }

  return {
    images,
    usage: {
      inputTokens: body_.usage?.prompt_tokens ?? 0,
      outputTokens: body_.usage?.completion_tokens ?? 0,
      totalTokens: body_.usage?.total_tokens ?? 0,
    },
    providerCostUsd:
      typeof body_.usage?.cost === 'number' ? body_.usage.cost : undefined,
  };
}

function parseDataUri(
  url: string,
): { bytes: Uint8Array; mediaType: string } | null {
  // data:image/png;base64,xxxx
  const match = /^data:([^;,]+)(?:;base64)?,([\s\S]+)$/.exec(url);
  if (!match) return null;
  const mediaType = match[1] || 'image/png';
  const payload = match[2];
  try {
    const bytes = new Uint8Array(Buffer.from(payload, 'base64'));
    return { bytes, mediaType };
  } catch {
    return null;
  }
}
