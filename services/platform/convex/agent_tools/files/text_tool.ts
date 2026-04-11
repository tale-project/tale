/** Convex Tool: Text
 *  Generate plain text files from content.
 *  Supports all text formats: .txt, .md, .js, .ts, .json, .csv, .log, code files, and more.
 *  Uses ctx.storage.get() for direct Convex storage access (like image_tool).
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import { buildDownloadUrl } from '../../lib/helpers/public_storage_url';
import type { ToolDefinition } from '../types';
import { appendFilePart } from './helpers/append_file_part';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface TextGenerateResult {
  operation: 'generate';
  success: boolean;
  fileStorageId: string;
  downloadUrl: string;
  filename: string;
  char_count: number;
  line_count: number;
  error?: string;
}

const textArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('generate'),
    filename: z
      .string()
      .describe("Output filename (e.g., 'output.txt', 'notes.md')"),
    content: z.string().describe('The text content to write to the file'),
  }),
]);

export const textTool = {
  name: 'text' as const,
  tool: createTool({
    description: `Text file tool for generating text-based files (.txt, .md, .js, .ts, .json, .csv, .log, and any other text format).

IMPORTANT: Only call the "generate" operation when the user explicitly requests creating or exporting a text file. Do NOT proactively generate text files unless the user specifically asks for this format.

TO READ TEXT FILE CONTENT: Do NOT use this tool. Instead use the rag_search tool:
• To get the full content of a text file: use rag_search with operation='retrieve' and the fileId
• To search for specific information across text files: use rag_search with operation='search'

**GENERATE OPERATION**
Use when a user wants to create/export a text file.
Parameters:
- operation: "generate"
- filename: Output filename (e.g., "output.txt", "report.md")
- content: The text content to write

EXAMPLES:
• Generate: { "operation": "generate", "filename": "report.md", "content": "# Report\\n\\nContent here..." }

Returns: { success, downloadUrl, filename, char_count, line_count }

AFTER GENERATING: Check the downloadUrl in the result:
- If it says "[file card shown in chat]": the file is already visible as a download card. Do NOT mention downloading, do NOT include a link, and do NOT say "you can download it" — the card handles this.
- If it contains an actual URL: no download card was shown. You MUST include the URL as a clickable markdown link so the user can download the file.
To also save the file to a folder in the documents hub, call document_write with the returned fileStorageId and the desired folderPath.
`,
    inputSchema: textArgs,
    execute: async (ctx: ToolCtx, args): Promise<TextGenerateResult> => {
      const { filename, content } = args;

      try {
        debugLog('tool:text generate start', {
          filename,
          contentLength: content.length,
        });
        const blob = new Blob([content], {
          type: 'text/plain; charset=utf-8',
        });
        const fileId = await ctx.storage.store(blob);

        await ctx.runMutation(
          internal.file_metadata.internal_mutations.saveFileMetadata,
          {
            organizationId: ctx.organizationId ?? 'system',
            storageId: fileId,
            fileName: filename,
            contentType: 'text/plain; charset=utf-8',
            size: blob.size,
            source: 'agent',
          },
        );

        const url = buildDownloadUrl(fileId, filename);
        const lineCount = content.split('\n').length;

        debugLog('tool:text generate success', {
          filename,
          fileId,
          charCount: content.length,
          lineCount,
        });

        const cardAppended = await appendFilePart(ctx, {
          fileName: filename,
          mimeType: 'text/plain; charset=utf-8',
          downloadUrl: url,
        });

        return {
          operation: 'generate',
          success: true,
          fileStorageId: fileId,
          downloadUrl: cardAppended ? '[file card shown in chat]' : url,
          filename,
          char_count: content.length,
          line_count: lineCount,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error('[tool:text generate] error', {
          filename,
          error: errorMessage,
        });

        return {
          operation: 'generate',
          success: false,
          fileStorageId: '',
          downloadUrl: '',
          filename,
          char_count: 0,
          line_count: 0,
          error: errorMessage,
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
