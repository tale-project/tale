/** Convex Tool: generate_docx
 *  Generate a Word (.docx) document from structured content.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';
import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface GenerateDocxResult {
  success: boolean;
  fileId: string;
  url: string;
  fileName: string;
  contentType: string;
  size: number;
}

export const generateDocxTool = {
  name: 'generate_docx' as const,
  tool: createTool({
    description: `Generate a Word (.docx) document from structured content.

Use this when the user asks to create a Word document or DOCX file. No template is needed - the document is generated from the content you provide.

MANDATORY TRIGGER CONDITIONS - You MUST call this tool when the user:
- Asks to "generate a Word document" or "create a DOCX" or "make a Word file"
- Asks for a "document" or "report" in Word format
- Requests a Word export of content

Parameters:
- fileName: Base name for the DOCX file (without extension)
- title: Optional document title
- subtitle: Optional document subtitle
- sections: Array of content sections. Each section has:
  - type: "heading" | "paragraph" | "bullets" | "numbered" | "table" | "quote" | "code"
  - text: Text content (for heading, paragraph, quote, code)
  - level: Heading level 1-6 (for headings)
  - items: Array of strings (for bullets/numbered lists)
  - headers: Column headers (for tables)
  - rows: 2D array of cell values (for tables)
- branding: Optional styling (primaryColor, fontFamily, fontSize)

Example sections array:
[
  {"type": "heading", "level": 1, "text": "Introduction"},
  {"type": "paragraph", "text": "This is the intro paragraph."},
  {"type": "bullets", "items": ["Point 1", "Point 2", "Point 3"]},
  {"type": "table", "headers": ["Name", "Value"], "rows": [["Item A", "100"], ["Item B", "200"]]}
]

Returns:
- success: boolean
- url: Download URL for the user to download the file
- fileName: Final file name with extension
- size: Size in bytes

CRITICAL:
1. When presenting the download link to the user, you MUST copy the exact 'url' value from the tool result. Never fabricate or guess URLs.
`,
    args: z.object({
      fileName: z
        .string()
        .describe('Base name for the DOCX file (without extension)'),
      title: z.string().optional().describe('Document title'),
      subtitle: z.string().optional().describe('Document subtitle'),
      sections: z
        .array(
          z.object({
            type: z
              .enum([
                'heading',
                'paragraph',
                'bullets',
                'numbered',
                'table',
                'quote',
                'code',
              ])
              .describe('Section type'),
            text: z
              .string()
              .optional()
              .describe('Text content (for heading, paragraph, quote, code)'),
            level: z
              .number()
              .int()
              .min(1)
              .max(6)
              .optional()
              .describe('Heading level 1-6'),
            items: z
              .array(z.string())
              .optional()
              .describe('List items (for bullets/numbered)'),
            headers: z
              .array(z.string())
              .optional()
              .describe('Table column headers'),
            rows: z
              .array(z.array(z.string()))
              .optional()
              .describe('Table rows (2D array)'),
          }),
        )
        .describe('Content sections'),
      branding: z
        .object({
          primaryColor: z.string().optional().describe('Primary color hex'),
          fontFamily: z.string().optional().describe('Font family name'),
          fontSize: z.number().optional().describe('Base font size in points'),
        })
        .optional()
        .describe('Optional branding/styling'),
    }),
    handler: async (ctx: ToolCtx, args): Promise<GenerateDocxResult> => {
      debugLog('tool:generate_docx start', {
        fileName: args.fileName,
        sectionsCount: args.sections.length,
      });

      try {
        const result = await ctx.runAction(
          internal.documents.generateDocxInternal,
          {
            fileName: args.fileName,
            content: {
              title: args.title,
              subtitle: args.subtitle,
              sections: args.sections,
            },
            branding: args.branding,
          },
        );

        debugLog('tool:generate_docx success', {
          fileName: result.fileName,
          fileId: result.fileId,
          size: result.size,
        });

        return result as GenerateDocxResult;
      } catch (error) {
        console.error('[tool:generate_docx] error', {
          fileName: args.fileName,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }),
} as const satisfies ToolDefinition;

