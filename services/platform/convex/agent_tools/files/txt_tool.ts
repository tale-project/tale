/** Convex Tool: TXT
 *  Parse plain text files and analyze content using fast model.
 *  Generate plain text files from content.
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

interface TxtParseResult {
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

interface TxtGenerateResult {
  operation: 'generate';
  success: boolean;
  fileId: string;
  url: string;
  filename: string;
  char_count: number;
  line_count: number;
  error?: string;
}

type TxtResult = TxtParseResult | TxtGenerateResult;

const txtArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('parse').describe('Parse and analyze a text file'),
    fileId: z
      .string()
      .describe(
        "**REQUIRED** - Convex storage ID of the text file (e.g., 'kg2bazp7fbgt9srq63knfagjrd7yfenj'). Get this from the file attachment context.",
      ),
    filename: z.string().describe("Original filename (e.g., 'data.txt')"),
    user_input: z
      .string()
      .describe('The user question or instruction about what to analyze in the text file'),
  }),
  z.object({
    operation: z.literal('generate').describe('Generate a new text file'),
    filename: z.string().describe("Output filename (e.g., 'output.txt')"),
    content: z.string().describe('The text content to write to the file'),
  }),
]);

export const txtTool = {
  name: 'txt' as const,
  tool: createTool({
    description: `Text file (.txt) tool for parsing, analyzing, and generating plain text files.

OPERATIONS:
1. **parse** - Parse and analyze an uploaded text file
2. **generate** - Create a new text file from content

**PARSE OPERATION**
Use when a user uploads a .txt file and asks to analyze its content.
Parameters:
- operation: "parse"
- fileId: **REQUIRED** - Convex storage ID (e.g., "kg2bazp7fbgt9srq63knfagjrd7yfenj")
- filename: Original filename (e.g., "notes.txt")
- user_input: The user's question or instruction

**GENERATE OPERATION**
Use when a user wants to create/export a text file.
Parameters:
- operation: "generate"
- filename: Output filename (e.g., "output.txt")
- content: The text content to write

EXAMPLES:
• Parse: { "operation": "parse", "fileId": "kg2...", "filename": "error.log", "user_input": "Find all errors" }
• Generate: { "operation": "generate", "filename": "report.txt", "content": "Your report content here..." }

Returns: { success, url (for generate), result (for parse), char_count, line_count }
`,
    args: txtArgs,
    handler: async (ctx: ToolCtx, args): Promise<TxtResult> => {
      if (args.operation === 'generate') {
        const { filename, content } = args;

        debugLog('tool:txt generate start', {
          filename,
          contentLength: content.length,
        });

        try {
          const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
          const fileId = await ctx.storage.store(blob);
          const url = await ctx.storage.getUrl(fileId);

          const lineCount = content.split('\n').length;

          debugLog('tool:txt generate success', {
            filename,
            fileId,
            charCount: content.length,
            lineCount,
          });

          return {
            operation: 'generate',
            success: true,
            fileId,
            url: url ?? '',
            filename,
            char_count: content.length,
            line_count: lineCount,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('[tool:txt generate] error', {
            filename,
            error: errorMessage,
          });

          return {
            operation: 'generate',
            success: false,
            fileId: '',
            url: '',
            filename,
            char_count: 0,
            line_count: 0,
            error: errorMessage,
          };
        }
      }

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
