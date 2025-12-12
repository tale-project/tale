/**
 * Convex Tool: PPTX
 *
 * PPTX operations for agents: analyze templates, generate presentations, and parse existing files.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';
import type { Id } from '../../../_generated/dataModel';
import type { BrandingInfo } from '../../../model/documents';
import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
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
  tables: z.array(tableDataSchema).optional().describe('Tables to add to the slide'),
});

// Branding schema - extracted from analyze_template, passed to generate
const brandingSchema = z.object({
  slideWidth: z.number().optional().describe('Slide width in inches'),
  slideHeight: z.number().optional().describe('Slide height in inches'),
  titleFontName: z.string().optional().describe('Font name for titles (e.g., "Arial")'),
  bodyFontName: z.string().optional().describe('Font name for body text (e.g., "Calibri")'),
  titleFontSize: z.number().optional().describe('Font size for titles in points'),
  bodyFontSize: z.number().optional().describe('Font size for body text in points'),
  primaryColor: z.string().optional().describe('Primary color as hex (e.g., "#003366")'),
  secondaryColor: z.string().optional().describe('Secondary color as hex'),
  accentColor: z.string().optional().describe('Accent color as hex'),
});

// Use a flat object schema for OpenAI-compatible JSON Schema
const pptxArgs = z.object({
  operation: z
    .enum(['list_templates', 'analyze_template', 'generate', 'parse'])
    .describe(
      "Operation to perform: 'list_templates', 'analyze_template', 'generate', or 'parse' (extract text from PPTX)",
    ),
  // For list_templates operation
  limit: z
    .number()
    .optional()
    .describe(
      "For 'list_templates': Maximum number of templates to return (default: 50)",
    ),
  // Required for analyze_template and generate operations
  templateStorageId: z
    .string()
    .optional()
    .describe(
      "Convex storage ID of the PPTX template. Required for 'analyze_template' and 'generate'. The template is used as base, preserving all styling, backgrounds, and decorative elements.",
    ),
  // For generate operation
  fileName: z
    .string()
    .optional()
    .describe(
      "Required for 'generate': Base name for the PPTX file (without extension)",
    ),
  slidesContent: z
    .array(slideContentSchema)
    .optional()
    .describe("For 'generate': Content for each slide in the presentation"),
  branding: brandingSchema
    .optional()
    .describe("For 'generate': Optional additional branding overrides"),
  // For parse operation
  url: z
    .string()
    .optional()
    .describe("For 'parse': URL of the PPTX file to parse"),
  filename: z
    .string()
    .optional()
    .describe("For 'parse': Original filename (e.g., 'presentation.pptx')"),
});

// Result types
interface ListTemplatesResult {
  operation: 'list_templates';
  success: boolean;
  templates: Array<{
    documentId: string;
    storageId: string;
    title: string;
    createdAt: number;
  }>;
  totalCount: number;
  message: string;
}

interface AnalyzeTemplateResult {
  operation: 'analyze_template';
  success: boolean;
  slideCount: number;
  slides: Array<{
    slideNumber: number;
    layoutName: string;
    title: string | null;
    subtitle: string | null;
    textContent: Array<{ text: string; isPlaceholder: boolean }>;
    tables: Array<{
      rowCount: number;
      columnCount: number;
      headers: string[];
      rows: string[][];
    }>;
    charts: Array<{
      chartType: string;
      hasLegend?: boolean;
      seriesCount?: number;
    }>;
    images: Array<{
      width: number;
      height: number;
    }>;
  }>;
  availableLayouts: string[];
  branding: BrandingInfo;
}

interface GenerateResult {
  operation: 'generate';
  success: boolean;
  fileId: string;
  url: string;
  fileName: string;
  contentType: string;
  size: number;
}

type ParsePptxResult = { operation: 'parse' } & ParseFileResult;

type PptxResult = ListTemplatesResult | AnalyzeTemplateResult | GenerateResult | ParsePptxResult;

export const pptxTool: ToolDefinition = {
  name: 'pptx',
  tool: createTool({
    description: `PowerPoint (PPTX) tool for listing templates, analyzing, generating, and parsing presentations.

OPERATIONS:

1. list_templates - List all available PPTX templates
   Returns: { templates, totalCount, message }

2. analyze_template - Analyze an existing PPTX template
   Pass templateStorageId from list_templates or file upload.
   Returns: { slides, branding }

3. generate - Generate a PPTX with your content
   Pass templateStorageId to preserve template styling.
   Pass slidesContent with your content. Each slide can have:
   - title, subtitle, textContent, bulletPoints, tables

4. parse - Extract text content from an existing PPTX file
   USE THIS when a user uploads a PPTX and you need to read its content.
   Parameters:
   - url: URL of the PPTX file (from Convex storage or accessible HTTP URL)
   - filename: Original filename (e.g., "presentation.pptx")
   Returns: { success, full_text, slide_count, metadata }

EXAMPLES:
• List templates: { "operation": "list_templates" }
• Analyze: { "operation": "analyze_template", "templateStorageId": "kg..." }
• Generate: { "operation": "generate", "templateStorageId": "kg...", "fileName": "Report", "slidesContent": [...] }
• Parse: { "operation": "parse", "url": "https://storage.convex.cloud/...", "filename": "presentation.pptx" }

CRITICAL: When presenting download links, copy the exact 'url' from the result. Never fabricate URLs.`,
    args: pptxArgs,
    handler: async (ctx: ToolCtx, args): Promise<PptxResult> => {
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
          const documents = await ctx.runQuery(
            internal.documents.listDocumentsByExtension,
            {
              organizationId,
              extension: 'pptx',
              limit: args.limit,
            },
          );

          const templates = documents
            .filter((doc) => doc.fileId) // Only include documents with file storage
            .map((doc) => ({
              documentId: doc._id,
              storageId: doc.fileId as string,
              title: doc.title ?? 'Untitled Template',
              createdAt: doc._creationTime,
            }));

          debugLog('tool:pptx list_templates success', {
            totalCount: templates.length,
          });

          return {
            operation: 'list_templates',
            success: true,
            templates,
            totalCount: templates.length,
            message:
              templates.length > 0
                ? `Found ${templates.length} PPTX template(s). Use the storageId as templateStorageId for analyze_template or generate operations.`
                : 'No PPTX templates found. Upload a PPTX file first to use as a template.',
          };
        } catch (error) {
          console.error('[tool:pptx list_templates] error', {
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }

      // Handle analyze_template operation
      if (args.operation === 'analyze_template') {
        if (!args.templateStorageId) {
          throw new Error("Missing required 'templateStorageId' for analyze_template operation");
        }

        debugLog('tool:pptx analyze_template start', {
          templateStorageId: args.templateStorageId,
        });

        try {
          const result = await ctx.runAction(
            internal.documents.analyzePptxInternal,
            {
              templateStorageId: args.templateStorageId as Id<'_storage'>,
            },
          );

          debugLog('tool:pptx analyze_template success', {
            slideCount: result.slideCount,
          });

          return {
            operation: 'analyze_template',
            ...result,
          } as AnalyzeTemplateResult;
        } catch (error) {
          console.error('[tool:pptx analyze_template] error', {
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }

      // Handle parse operation
      if (args.operation === 'parse') {
        if (!args.url) {
          throw new Error("Missing required 'url' for parse operation");
        }
        if (!args.filename) {
          throw new Error("Missing required 'filename' for parse operation");
        }

        const result = await parseFile(args.url, args.filename, 'pptx');
        return { operation: 'parse', ...result };
      }

      // operation === 'generate'
      if (!args.templateStorageId) {
        throw new Error("Missing required 'templateStorageId' for generate operation");
      }
      if (!args.fileName) {
        throw new Error("Missing required 'fileName' for generate operation");
      }
      if (!args.slidesContent || args.slidesContent.length === 0) {
        throw new Error("Missing required 'slidesContent' for generate operation");
      }

      debugLog('tool:pptx generate start', {
        fileName: args.fileName,
        slidesCount: args.slidesContent.length,
        hasBranding: !!args.branding,
        hasTemplate: !!args.templateStorageId,
      });

      try {
        const result = await ctx.runAction(
          internal.documents.generatePptxInternal,
          {
            fileName: args.fileName,
            slidesContent: args.slidesContent,
            branding: args.branding,
            templateStorageId: args.templateStorageId as Id<'_storage'>,
          },
        );

        debugLog('tool:pptx generate success', {
          fileName: result.fileName,
          fileId: result.fileId,
          size: result.size,
        });

        return {
          operation: 'generate',
          ...result,
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
