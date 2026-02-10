'use node';

/**
 * Helper for analyzing images by URL using the vision model.
 */

import type { ActionCtx } from '../../../_generated/server';
import type { AnalyzeImageResult } from './analyze_image';

import { components } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { getVisionModel, createVisionAgent } from './vision_agent';

const debugLog = createDebugLog('DEBUG_IMAGE_ANALYSIS', '[ImageAnalysis]');

export interface AnalyzeImageByUrlParams {
  /** Public image URL */
  imageUrl: string;
  /** The question or instruction for analyzing the image */
  question?: string;
}

/**
 * Analyze an image by URL using the vision model.
 * Passes the URL directly to the AI - works for publicly accessible external URLs.
 * NOTE: This may not work for internal/localhost URLs that the AI cannot access.
 */
export async function analyzeImageByUrl(
  ctx: ActionCtx,
  params: AnalyzeImageByUrlParams,
): Promise<AnalyzeImageResult> {
  const { imageUrl, question } = params;
  const visionModelId = getVisionModel();

  debugLog('analyzeImageByUrl starting', {
    imageUrl: imageUrl.slice(0, 100),
    question,
  });

  try {
    // Create a vision agent
    const visionAgent = createVisionAgent();

    // Create a temporary thread for this analysis
    const thread = await ctx.runMutation(
      components.agent.threads.createThread,
      { title: 'image-analysis-url' },
    );
    const threadId = thread._id;

    debugLog('analyzeImageByUrl calling vision agent', { threadId });

    // Use the agent's generateText with the image URL directly
    const prompt =
      question ||
      'Describe this image in detail, extracting all visible text and information.';
    const result = await visionAgent.generateText(
      ctx,
      { threadId },
      {
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image', image: imageUrl },
            ],
          },
        ],
      },
    );

    const analysis = result.text || '';

    debugLog('analyzeImageByUrl success', {
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
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debugLog('analyzeImageByUrl error', {
      imageUrl: imageUrl.slice(0, 100),
      error: errorMessage,
    });

    return {
      success: false,
      analysis: '',
      model: visionModelId,
      error: errorMessage,
    };
  }
}
