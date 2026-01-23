/** Convex Tool: TXT
 *  Parse plain text files and analyze content using fast model.
 *  Handles various encodings and large files via chunked processing.
 *  Uses ctx.storage.get() for direct Convex storage access (like image_tool).
 */

import { z } from 'zod/v4';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { createDebugLog } from '../../lib/debug_log';
import { analyzeTextContent } from './helpers/analyze_text';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface TxtResult {
  operation: 'parse';
  success: boolean;
  result: string;
  filename: string;
  char_count: number;
  line_count: number;
  encoding: string;
  chunked: boolean;
  chunk_count?: number;
  error?: string;
}

const txtArgs = z.object({
  fileId: z
    .string()
    .describe(
      "**REQUIRED** - Convex storage ID of the text file (e.g., 'kg2bazp7fbgt9srq63knfagjrd7yfenj'). Get this from the file attachment context.",
    ),
  filename: z.string().describe("Original filename (e.g., 'data.txt')"),
  user_input: z
    .string()
    .describe('The user question or instruction about what to analyze in the text file'),
});

export const txtTool = {
  name: 'txt' as const,
  tool: createTool({
    description: `Text file (.txt) tool for parsing and analyzing plain text files.

USE THIS when a user uploads a .txt file and asks to analyze its content.

**CRITICAL: You MUST provide the fileId parameter.**
The fileId is provided in the context when users upload files (look for "fileId" in the attachment info).
DO NOT use URL for uploaded files - use the fileId from the attachment context.

Parameters:
- fileId: **REQUIRED** - Convex storage ID (e.g., "kg2bazp7fbgt9srq63knfagjrd7yfenj")
- filename: Original filename (e.g., "notes.txt")
- user_input: The user's question or instruction (e.g., "Find all error messages", "Summarize this log")

The tool automatically:
- Detects file encoding (UTF-8, UTF-16, GBK, etc.)
- Handles large files by chunking and processing with fast model
- Returns analyzed results based on the user's question

EXAMPLES:
• Parse and analyze: { "fileId": "kg2bazp7fbgt9srq63knfagjrd7yfenj", "filename": "error.log", "user_input": "Find all error messages" }
• Extract info: { "fileId": "...", "filename": "data.txt", "user_input": "List all email addresses" }

Returns: { success, result, char_count, line_count, encoding, chunked }
`,
    args: txtArgs,
    handler: async (ctx: ToolCtx, args): Promise<TxtResult> => {
      const { fileId, filename, user_input } = args;

      if (!fileId) {
        return {
          operation: 'parse',
          success: false,
          result: '',
          filename: filename || 'unknown',
          char_count: 0,
          line_count: 0,
          encoding: 'unknown',
          chunked: false,
          error:
            "ERROR: Missing required 'fileId' parameter. For uploaded text files, you MUST provide the fileId from the file attachment context (it looks like 'kg2bazp7fbgt9srq63knfagjrd7yfenj'). Please check the attachment info and retry with fileId.",
        };
      }

      debugLog('tool:txt parse start', {
        fileId,
        filename,
        user_input: user_input.length > 100 ? user_input.substring(0, 100) + '...' : user_input,
      });

      try {
        const result = await analyzeTextContent(ctx, {
          fileId,
          filename,
          userInput: user_input,
        });

        debugLog('tool:txt parse success', {
          filename,
          charCount: result.charCount,
          lineCount: result.lineCount,
          chunked: result.chunked,
        });

        return {
          operation: 'parse',
          success: result.success,
          result: result.result,
          filename,
          char_count: result.charCount,
          line_count: result.lineCount,
          encoding: result.encoding,
          chunked: result.chunked,
          chunk_count: result.chunkCount,
          error: result.error,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[tool:txt parse] error', {
          fileId,
          filename,
          error: errorMessage,
        });

        return {
          operation: 'parse',
          success: false,
          result: '',
          filename,
          char_count: 0,
          line_count: 0,
          encoding: 'unknown',
          chunked: false,
          error: errorMessage,
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
