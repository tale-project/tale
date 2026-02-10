/**
 * Helper for analyzing images using the vision model.
 * Extracts detailed content from images (text, data, etc.)
 *
 * NOTE: We use binary data instead of the SDK's getFile() approach because:
 * - getFile() returns URLs like https://tale.local/... which are internal URLs
 * - External vision APIs (OpenRouter, etc.) cannot access these internal URLs
 * - Binary data embeds the image directly, bypassing URL accessibility issues
 *
 * This file runs in V8 runtime (no 'use node' directive) for better compatibility.
 */

import type { Id } from '../../../_generated/dataModel';
import type { ActionCtx } from '../../../_generated/server';

import { components } from '../../../_generated/api';
import { imageAnalysisCache } from '../../../lib/action_cache';
import { createDebugLog } from '../../../lib/debug_log';
import { getVisionModel, createVisionAgent } from './vision_agent';

const debugLog = createDebugLog('DEBUG_IMAGE_ANALYSIS', '[ImageAnalysis]');

// Max image size for analysis (1MB to stay within 64MB action limit)
const MAX_IMAGE_BYTES = 1 * 1024 * 1024;

export interface AnalyzeImageParams {
  /** Convex storage file ID */
  fileId: Id<'_storage'>;
  /** The question or instruction for analyzing the image */
  question?: string;
  /** Original file name (for display purposes) */
  fileName?: string;
}

export interface AnalyzeImageResult {
  success: boolean;
  analysis: string;
  model: string;
  fileName?: string;
  error?: string;
}

/**
 * Analyze an image using the vision model.
 * Uses binary data to ensure the image is accessible by external APIs.
 */
export async function analyzeImage(
  ctx: ActionCtx,
  params: AnalyzeImageParams,
): Promise<AnalyzeImageResult> {
  const { fileId, question, fileName } = params;
  const visionModelId = getVisionModel();

  debugLog('analyzeImage starting', { fileId, question, fileName });

  try {
    // Get the image blob from storage
    const imageBlob = await ctx.storage.get(fileId);
    if (!imageBlob) {
      throw new Error(`Image not found in storage: ${fileId}`);
    }

    const mimeType = imageBlob.type || 'image/png';

    debugLog('analyzeImage got blob', {
      size: imageBlob.size,
      mimeType,
    });

    // Check if image is too large
    if (imageBlob.size > MAX_IMAGE_BYTES) {
      const sizeMB = (imageBlob.size / (1024 * 1024)).toFixed(2);
      const maxMB = (MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0);
      return {
        success: false,
        analysis: '',
        model: visionModelId,
        error: `Image is too large (${sizeMB}MB). Please upload an image smaller than ${maxMB}MB for analysis.`,
        fileName,
      };
    }

    // Convert blob to Uint8Array (AI SDK handles encoding internally)
    const imageData = new Uint8Array(await imageBlob.arrayBuffer());

    debugLog('analyzeImage prepared', {
      byteLength: imageData.byteLength,
      mimeType,
    });

    const visionAgent = createVisionAgent();

    // Create a temporary thread for this analysis
    const thread = await ctx.runMutation(
      components.agent.threads.createThread,
      { title: 'image-analysis' },
    );
    const threadId = thread._id;

    debugLog('analyzeImage calling vision agent', { threadId });

    const prompt =
      question ||
      'Describe this image in detail, extracting all visible text and information.';

    let result;
    try {
      result = await visionAgent.generateText(
        ctx,
        { threadId },
        {
          prompt: [
            {
              role: 'user',
              content: [
                {
                  type: 'image' as const,
                  image: imageData,
                  mediaType: mimeType,
                },
                { type: 'text', text: prompt },
              ],
            },
          ],
        },
      );
    } catch (err) {
      debugLog('generateText error', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const analysis = result.text || '';

    debugLog('analyzeImage success', {
      model: visionModelId,
      analysisLength: analysis.length,
    });

    // Clean up the temporary thread by archiving it
    try {
      await ctx.runMutation(components.agent.threads.updateThread, {
        threadId,
        patch: { status: 'archived' },
      });
    } catch {
      // Non-fatal: thread cleanup failure shouldn't affect the result
    }

    return {
      success: true,
      analysis,
      model: visionModelId,
      fileName,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debugLog('analyzeImage error', { fileId, error: errorMessage });

    return {
      success: false,
      analysis: '',
      model: visionModelId,
      error: errorMessage,
      fileName,
    };
  }
}

/**
 * Cached version of analyzeImage.
 * Use this when calling from actions to benefit from caching.
 * Same image + question will return cached analysis.
 */
export async function analyzeImageCached(
  ctx: ActionCtx,
  params: AnalyzeImageParams,
): Promise<AnalyzeImageResult> {
  return await imageAnalysisCache.fetch(ctx, {
    fileId: params.fileId,
    question: params.question,
    fileName: params.fileName,
  });
}
