'use node';

/**
 * Direct-mode image generation runtime.
 *
 * Called for agents with `primaryBehavior === 'image-generation'`. Bypasses
 * the chat-loop generate_response pipeline entirely — the user's latest
 * message (text + any attached images) is sent straight to an image model
 * via AI SDK, and the resulting image(s) are saved as an assistant message.
 *
 * The model call itself is shared with the inline `generate_image` chat tool
 * via `generateImageBlobs` (see `./generate_image_blobs`); this module owns the
 * direct-mode framing (read attachments, save a fresh assistant message,
 * telemetry, stream cleanup).
 */

import { saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components, internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { roundCents } from '../../governance/cost_estimation';
import { onAgentComplete } from '../../lib/agent_completion';
import { createDebugLog } from '../../lib/debug_log';
import { fetchBlobArrayBuffer } from '../../lib/storage/blob_read_any';
import {
  type GeneratedImageBlob,
  generateImageBlobs,
  persistImageBlob,
} from './generate_image_blobs';

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
    /** Better Auth org doc id — drives provider resolution and usage ledger. */
    organizationId: v.string(),
    userId: v.optional(v.string()),
    teamIds: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const agentSlug = args.agentSlug ?? 'image-creator';

    try {
      // Resolve bytes for any attached images (edit mode). We read the raw
      // bytes from Convex storage and pass them as Uint8Array to the AI SDK —
      // passing a URL would fail because the gateway cannot reach our dev
      // localhost, and even in prod there are auth/proxy complications that
      // sending bytes sidesteps entirely.
      const attachmentImages = args.attachmentImages ?? [];
      const attachmentBytes: GeneratedImageBlob[] = [];
      for (const att of attachmentImages) {
        // Backend-aware read: `att.fileId` is a blob REFERENCE (`_storage` id
        // or `s3:` ref) — a BYO-bucket org's edit-mode input reads from its
        // own bucket. Missing blobs are skipped, as before.
        const read = await fetchBlobArrayBuffer(
          ctx,
          args.organizationId,
          att.fileId,
        );
        if (!read) continue;
        attachmentBytes.push({
          bytes: new Uint8Array(read.bytes),
          mediaType: att.mimeType || read.contentType || 'image/png',
        });
      }

      // Build prompt: optional systemInstructions prefix + user message text.
      const textPrompt = args.systemInstructions
        ? `${args.systemInstructions}\n\n${args.rawPrompt}`
        : args.rawPrompt;

      const { imageBlobs, usage, providerCostUsd, resolved } =
        await generateImageBlobs(ctx, {
          modelRef: args.modelRef,
          textPrompt,
          attachmentBytes,
          organizationId: args.organizationId,
        });

      debugLog('generated', {
        threadId: args.threadId,
        modelId: resolved.modelData.modelId,
        mode: resolved.kind,
        hasAttachments: attachmentBytes.length > 0,
        attachmentCount: attachmentBytes.length,
        imageCount: imageBlobs.length,
      });

      // Persist image blobs to Convex storage and build downloadable file parts.
      const fileParts = await Promise.all(
        imageBlobs.map(async (img, idx) => {
          const { downloadUrl, fileName } = await persistImageBlob(
            ctx,
            img,
            agentSlug,
            idx,
          );
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
      // otherwise the image ends up collocated with the user turn and the next
      // user message renders directly under it as if this one never responded.
      const { messageId } = await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        message: {
          role: 'assistant',
          content: fileParts,
        },
      });

      const durationMs = Date.now() - startedAt;

      // Cost accounting. Prefer the gateway's billed USD amount
      // (`usage.cost` from OpenRouter-compatible responses) — it accounts for
      // resolution-dependent pricing that a flat per-image rate cannot express
      // (FLUX.2 charges per megapixel). Fall back to the model's
      // `imageCentsPerImage` when no provider cost was reported, and to
      // token-derived math (computed in onAgentComplete) otherwise.
      const perImageCost = resolved.modelData.imageCentsPerImage;
      const imageCostCents =
        providerCostUsd != null
          ? roundCents(providerCostUsd * 100)
          : perImageCost != null
            ? imageBlobs.length * perImageCost
            : undefined;

      // Usage ledger + audit (best effort — don't fail the turn on telemetry).
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
