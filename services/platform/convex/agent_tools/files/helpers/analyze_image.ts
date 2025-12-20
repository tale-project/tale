'use node';

/**
 * Helper for analyzing images using the vision model.
 * Extracts detailed content from images (text, data, etc.)
 */

import { getFile } from '@convex-dev/agent';
import { components } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import type { ActionCtx } from '../../../_generated/server';
import type { Id } from '../../../_generated/dataModel';
import { getVisionModel, createVisionAgent } from './vision_agent';

const debugLog = createDebugLog('DEBUG_IMAGE_ANALYSIS', '[ImageAnalysis]');

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
 * Extracts detailed content from the image.
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

    // Compute SHA-256 hash for file registration
    const arrayBuffer = await imageBlob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Register the image file with the agent component
    const { fileId: agentFileId } = await ctx.runMutation(
      components.agent.files.addFile,
      {
        storageId: fileId as string,
        hash,
        mimeType,
        filename: fileName || 'image-to-analyze',
      },
    );

    // Get the proper image part from the agent component
    const { imagePart } = await getFile(ctx, components.agent, agentFileId);

    if (!imagePart) {
      throw new Error('Failed to get image part from agent component');
    }

    debugLog('analyzeImage got imagePart', { agentFileId });

    // Create a vision agent
    const visionAgent = createVisionAgent();

    // Create a temporary thread for this analysis
    const thread = await ctx.runMutation(
      components.agent.threads.createThread,
      { title: 'image-analysis' },
    );
    const threadId = thread._id as string;

    debugLog('analyzeImage calling vision agent', { threadId });

    // Use the agent's generateText with multi-modal content
    const prompt = question || 'Describe this image in detail, extracting all visible text and information.';
    const result = await visionAgent.generateText(
      ctx,
      { threadId },
      {
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              imagePart,
            ],
          },
        ],
      },
    );

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
