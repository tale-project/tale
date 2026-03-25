/**
 * Convex Tool: PPTX
 *
 * PPTX operations for agents: list templates, generate presentations, and parse existing files.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ListDocumentsByExtensionResult } from '../../documents/types';
import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import { toId } from '../../lib/type_cast_helpers';
import { appendFilePart } from './helpers/append_file_part';
import { getAgentModelId } from './helpers/get_agent_model';
import { parseFile, type ParseFileResult } from './helpers/parse_file';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

// Table data schema for generation
const tableDataSchema = z.object({
  headers: z.array(z.string()).describe('Column headers'),
  rows: z.array(z.array(z.string())).describe('Table data rows'),
});

// Slide content schema for generation
const slideContentSchema = z.object({
  title: z.string().optional().describe('Slide title'),
  subtitle: z.string().optional().describe('Slide subtitle'),
  textContent: z.array(z.string()).optional().describe('Text paragraphs'),
  bulletPoints: z.array(z.string()).optional().describe('Bullet point items'),
  tables: z
    .array(tableDataSchema)
    .optional()
    .describe('Tables to add to the slide'),
});

// Branding schema
const brandingSchema = z.object({
  slideWidth: z.number().optional().describe('Slide width in inches'),
  slideHeight: z.number().optional().describe('Slide height in inches'),
  titleFontName: z
    .string()
    .optional()
    .describe('Font name for titles (e.g., "Arial")'),
  bodyFontName: z
    .string()
    .optional()
    .describe('Font name for body text (e.g., "Calibri")'),
  titleFontSize: z
    .number()
    .optional()
    .describe('Font size for titles in points'),
  bodyFontSize: z
    .number()
    .optional()
    .describe('Font size for body text in points'),
  primaryColor: z
    .string()
    .optional()
    .describe('Primary color as hex (e.g., "#003366")'),
  secondaryColor: z.string().optional().describe('Secondary color as hex'),
  accentColor: z.string().optional().describe('Accent color as hex'),
});

const pptxArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('list_templates'),
    limit: z
      .number()
      .optional()
      .describe('Maximum number of templates to return (default: 50)'),
  }),
  z.object({
    operation: z.literal('generate'),
    templateStorageId: z
      .string()
      .optional()
      .describe(
        'Convex storage ID of the PPTX template. The template is used as base, preserving all styling, backgrounds, and decorative elements.',
      ),
    fileName: z
      .string()
      .describe('Base name for the PPTX file (without extension)'),
    slidesContent: z
      .array(slideContentSchema)
      .describe('Content for each slide in the presentation'),
    branding: brandingSchema
      .optional()
      .describe('Optional additional branding overrides'),
  }),
  z.object({
    operation: z.literal('parse'),
    fileId: z
      .string()
      .describe(
        "Convex storage ID (e.g., 'kg2bazp7fbgt9srq63knfagjrd7yfenj'). Get this from the file attachment context.",
      ),
    filename: z
      .string()
      .optional()
      .describe(
        "Original filename (e.g., 'presentation.pptx'). Optional — auto-resolved from file metadata if omitted.",
      ),
    user_input: z
      .string()
      .describe(
        "The user's question or instruction about the presentation content",
      ),
  }),
]);

// Result types
interface ListTemplatesResult {
  operation: 'list_templates';
  success: boolean;
  templates: Array<{
    fileId: string;
    title: string;
    createdAt: number;
  }>;
  totalCount: number;
  message: string;
}

interface GenerateResult {
  operation: 'generate';
  success: boolean;
  fileStorageId: string;
  downloadUrl: string;
  fileName: string;
  contentType: string;
  size: number;
  error?: string;
}

type ParsePptxResult = { operation: 'parse' } & ParseFileResult;

type PptxResult = ListTemplatesResult | GenerateResult | ParsePptxResult;

export const pptxTool: ToolDefinition = {
  name: 'pptx',
  tool: createTool({
    description: `PowerPoint (PPTX) tool for listing templates, generating, and parsing presentations.

IMPORTANT: Only call the "generate" operation when the user explicitly requests creating or exporting a PowerPoint/PPTX file. Do NOT proactively generate presentations unless the user specifically asks for this format.

IMPORTANT WORKFLOW FOR GENERATING PPTX:
1. FIRST call list_templates to check if templates are available
2. If no templates found, tell the user to upload a .pptx template to the Knowledge Base (Documents page) — NOT in the chat. Include the link from the list_templates result.
3. Only call generate after you have a valid templateStorageId from list_templates

OPERATIONS:

1. list_templates - List all available PPTX templates
   ALWAYS call this first before generate!
   Returns: { templates, totalCount, message }

2. generate - Generate a PPTX with your content
   REQUIRES templateStorageId from list_templates - do NOT call without it!
   Pass slidesContent with your content. Each slide can have:
   - title, subtitle, textContent, bulletPoints, tables
   The backend automatically selects the best layout based on content.

3. parse - Extract text content from an existing PPTX file
   USE THIS when a user uploads a PPTX and you need to read its content.
   Parameters:
   - fileId: **REQUIRED** - Convex storage ID (e.g., "kg2bazp7fbgt9srq63knfagjrd7yfenj")
   - filename: Optional — original filename (e.g., "presentation.pptx"). Auto-resolved from file metadata if omitted.
   - user_input: **REQUIRED** - The user's question or instruction about the presentation
   Returns: { success, full_text, slide_count, metadata }

EXAMPLES:
• List templates: { "operation": "list_templates" }
• Generate: { "operation": "generate", "templateStorageId": "kg...", "fileName": "Report", "slidesContent": [...] }
• Parse: { "operation": "parse", "fileId": "kg2bazp7...", "filename": "presentation.pptx", "user_input": "Summarize the key slides" }

SLIDE CONTENT EXAMPLES:
- Title slide: { "title": "Welcome", "subtitle": "Introduction" }
- Content slide: { "title": "Agenda", "bulletPoints": ["Point 1", "Point 2"] }
- With table: { "title": "Data", "tables": [{"headers": ["A", "B"], "rows": [["1", "2"]]}] }

AFTER GENERATING: The file automatically appears as a download card in the chat. Do NOT mention downloading, do NOT include a link, and do NOT say "you can download it" — the card handles this. To also save the file to a folder in the documents hub, call document_write with the returned fileStorageId and the desired folderPath.`,
    inputSchema: pptxArgs,
    execute: async (ctx: ToolCtx, args): Promise<PptxResult> => {
      const { organizationId } = ctx;

      // Handle list_templates operation
      if (args.operation === 'list_templates') {
        if (!organizationId) {
          return {
            operation: 'list_templates',
            success: false,
            templates: [],
            totalCount: 0,
            message:
              'No organizationId in context - cannot list templates. This tool requires organizationId to be set.',
          };
        }

        debugLog('tool:pptx list_templates start', {
          organizationId,
          limit: args.limit,
        });

        try {
          const documents: ListDocumentsByExtensionResult = await ctx.runQuery(
            internal.documents.internal_queries.listDocumentsByExtension,
            {
              organizationId,
              extension: 'pptx',
              limit: args.limit,
            },
          );

          const templates = documents
            .filter(
              (doc): doc is typeof doc & { fileId: string } => !!doc.fileId,
            )
            .map((doc) => ({
              fileId: doc.fileId,
              title: doc.title ?? 'Untitled Template',
              createdAt: doc._creationTime,
            }));

          debugLog('tool:pptx list_templates success', {
            totalCount: templates.length,
          });

          const siteUrl = process.env.SITE_URL || '';
          const knowledgeUrl = `${siteUrl}/dashboard/${organizationId}/documents`;

          return {
            operation: 'list_templates',
            success: true,
            templates,
            totalCount: templates.length,
            message:
              templates.length > 0
                ? `Found ${templates.length} PPTX template(s). Use the fileId as templateStorageId for generate operations.`
                : `No PPTX templates found. The user must upload a .pptx template file to the Knowledge Base first — uploading in the chat will NOT work as a template. Direct the user to: ${knowledgeUrl} . Do NOT attempt to call generate without a template.`,
          };
        } catch (error) {
          console.error('[tool:pptx list_templates] error', {
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }

      if (args.operation === 'parse') {
        const model = getAgentModelId(ctx);
        const result = await parseFile(
          ctx,
          args.fileId,
          args.filename,
          'pptx',
          args.user_input,
          model,
        );
        return { operation: 'parse', ...result };
      }

      // operation === 'generate'
      if (!args.templateStorageId) {
        return {
          operation: 'generate',
          success: false,
          fileStorageId: '',
          downloadUrl: '',
          fileName: args.fileName,
          contentType: '',
          size: 0,
          error:
            'templateStorageId is required. Call list_templates first to get available templates. If no templates exist, the user must upload a .pptx template to the Knowledge Base (Documents page) — not in chat.',
        };
      }

      if (!organizationId) {
        throw new Error(
          'organizationId is required to generate a presentation',
        );
      }

      debugLog('tool:pptx generate start', {
        fileName: args.fileName,
        slidesCount: args.slidesContent.length,
        hasBranding: !!args.branding,
        hasTemplate: !!args.templateStorageId,
      });

      try {
        const result = await ctx.runAction(
          internal.documents.internal_actions.generatePptx,
          {
            organizationId,
            fileName: args.fileName,
            slidesContent: args.slidesContent,
            branding: args.branding,
            templateStorageId: toId<'_storage'>(args.templateStorageId),
          },
        );

        debugLog('tool:pptx generate success', {
          fileName: result.fileName,
          fileStorageId: result.fileStorageId,
          size: result.size,
        });

        const cardAppended = await appendFilePart(ctx, {
          fileName: result.fileName,
          mimeType: result.contentType,
          downloadUrl: result.downloadUrl,
        });

        return {
          operation: 'generate',
          ...result,
          downloadUrl: cardAppended
            ? '[file card shown in chat]'
            : result.downloadUrl,
        } as GenerateResult;
      } catch (error) {
        console.error('[tool:pptx generate] error', {
          fileName: args.fileName,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }),
};
