'use node';

/**
 * Internal actions for file processing operations.
 * These wrap helper functions so they can be cached by ActionCache.
 */

import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import {
  analyzeImage as analyzeImageHelper,
  type AnalyzeImageResult,
} from './helpers/analyze_image';

/**
 * Internal action for analyzing images with vision model.
 * Wrapped for caching - same image + question should return same analysis.
 */
export const analyzeImageUncached = internalAction({
  args: {
    fileId: v.id('_storage'),
    question: v.optional(v.string()),
    fileName: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    analysis: v.string(),
    model: v.string(),
    fileName: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<AnalyzeImageResult> => {
    return await analyzeImageHelper(ctx, {
      fileId: args.fileId,
      question: args.question,
      fileName: args.fileName,
    });
  },
});
