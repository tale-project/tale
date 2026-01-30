'use node';

/**
 * Internal actions for file processing operations.
 * These wrap helper functions so they can be cached by ActionCache.
 */

import { internalAction } from '../../_generated/server';
import { v } from 'convex/values';
import { parseFile as parseFileHelper, type ParseFileResult } from './helpers/parse_file';
import { analyzeImage as analyzeImageHelper, type AnalyzeImageResult } from './helpers/analyze_image';

/**
 * Internal action for parsing files (PDF, DOCX, PPTX).
 * Wrapped for caching - same fileId/filename should return same result.
 */
export const parseFileUncached = internalAction({
  args: {
    fileId: v.string(),
    filename: v.string(),
    toolName: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    filename: v.string(),
    file_type: v.optional(v.string()),
    full_text: v.optional(v.string()),
    page_count: v.optional(v.number()),
    slide_count: v.optional(v.number()),
    paragraph_count: v.optional(v.number()),
    metadata: v.optional(
      v.object({
        title: v.optional(v.string()),
        author: v.optional(v.string()),
        subject: v.optional(v.string()),
      }),
    ),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<ParseFileResult> => {
    return await parseFileHelper(ctx, args.fileId, args.filename, args.toolName);
  },
});

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
