'use node';

/**
 * Backing action for the inline `generate_image` chat tool.
 *
 * Generates a single image from a text prompt using the org's image model and
 * persists it to Convex storage, returning a downloadable file reference the
 * tool turns into an inline image card. Unlike `runImageGeneration` (direct
 * image-agent mode) this does NOT save its own assistant message — the image
 * is appended to the calling agent's reply — so cost is recorded with
 * `skipMetadata` to avoid overwriting the chat message's own metadata.
 */

import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import { roundCents } from '../../governance/cost_estimation';
import { onAgentComplete } from '../../lib/agent_completion';
import { generateImageBlobs, persistImageBlob } from './generate_image_blobs';

export const generateImageForTool = internalAction({
  args: {
    /** Natural-language description of the image to create. */
    prompt: v.string(),
    /**
     * Model reference in `provider:model-id` form, or bare `model-id`. Empty
     * string falls back to the org's `image-generation` tag default.
     */
    modelRef: v.optional(v.string()),
    organizationId: v.string(),
    threadId: v.string(),
    userId: v.optional(v.string()),
    /** Calling agent slug, for cost attribution. */
    agentSlug: v.optional(v.string()),
  },
  returns: v.object({
    downloadUrl: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
  }),
  handler: async (ctx, args) => {
    const startedAt = Date.now();

    const { imageBlobs, usage, providerCostUsd, resolved } =
      await generateImageBlobs(ctx, {
        modelRef: args.modelRef ?? '',
        textPrompt: args.prompt,
        organizationId: args.organizationId,
      });

    const firstImage = imageBlobs[0];
    if (!firstImage) {
      throw new Error('Image generation returned no image.');
    }
    const persisted = await persistImageBlob(
      ctx,
      firstImage,
      args.agentSlug ?? 'generate-image',
      0,
    );

    // Cost accounting — ledger + audit only (skipMetadata), so the chat
    // message's own metadata (written by the agent turn) is left untouched.
    const perImageCost = resolved.modelData.imageCentsPerImage;
    const imageCostCents =
      providerCostUsd != null
        ? roundCents(providerCostUsd * 100)
        : perImageCost != null
          ? perImageCost
          : undefined;

    try {
      await onAgentComplete(ctx, {
        threadId: args.threadId,
        agentType: 'image-generation',
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
        userId: args.userId,
        result: {
          threadId: args.threadId,
          model: resolved.modelData.modelId,
          provider: resolved.modelData.providerName,
          usage: usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          durationMs: Date.now() - startedAt,
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
        options: { skipMetadata: true },
      });
    } catch (telemetryErr) {
      console.warn('[generateImageForTool] telemetry failed:', telemetryErr);
    }

    return {
      downloadUrl: persisted.downloadUrl,
      fileName: persisted.fileName,
      mimeType: persisted.mimeType,
    };
  },
});
