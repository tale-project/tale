/** Convex Tool: PDF
 *  Generate PDF documents from Markdown/HTML/URL via the crawler service.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import type { ToolDefinition } from '../types';
import { appendFilePart } from './helpers/append_file_part';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface GeneratePdfResult {
  operation: 'generate';
  success: boolean;
  fileStorageId: string;
  downloadUrl: string;
  fileName: string;
  contentType: string;
  extension: string;
  size: number;
}

export const pdfTool = {
  name: 'pdf' as const,
  tool: createTool({
    description: `Generate a downloadable .pdf file. **Default: do NOT call this tool.**

GATE — only call when the user has explicitly asked for a .pdf *file deliverable*. Trigger phrases: "download as PDF", "email me a PDF report", "save this as a PDF attachment", "export to PDF". If the user asks for a page, document, deck, report, mockup, draft, preview, or visual without saying "PDF" or "file", this tool is NOT the right answer — even if the content would look fine as a PDF.

IF NOT ELIGIBLE — emit a fenced \`\`\`html / \`\`\`svg / \`\`\`mermaid / \`\`\`markdown code block in your reply instead. The chat's Canvas pane renders these automatically; that is the product's intended UI for:
  • demo pages, comparison pages, interactive pages
  • visualizations, dashboards
  • slide decks / presentations (reveal.js via CDN works well)
  • mockups, drafts, previews
  • anything the user will read inline in chat rather than download

Do NOT call this tool for any of the above.

TO READ PDF FILE CONTENT: Do NOT use this tool. Instead use the rag_search tool:
• To get the full content of a PDF file: use rag_search with operation='retrieve' and the fileId
• To search for specific information across PDF files: use rag_search with operation='search'

OPERATIONS:

1. generate - Generate a PDF from Markdown/HTML, or download/capture a PDF from a URL
   This is the PREFERRED way to generate downloadable PDF files.
   Parameters:
   - fileName: Base name for the PDF (without extension)
   - sourceType: "markdown", "html", or "url"
   - content: The Markdown/HTML text or URL to capture/download
   - pdfOptions: Advanced options (format, landscape, margins, etc.)
   - urlOptions: Options for URL capture (waitUntil, etc.)
   - extraCss: Additional CSS to inject
   - wrapInTemplate: Whether to wrap in HTML template
   Returns: { success, fileStorageId, downloadUrl, fileName, contentType, size }

   LANGUAGE SUPPORT (applies to sourceType "markdown" and "html" only):
   • Renders correctly: Latin (English, French, German, Spanish, Portuguese, Italian, Nordic), Cyrillic (Russian, Ukrainian, Serbian), Arabic, Hebrew, Greek, Devanagari (Hindi), Bengali, Tamil, Thai, Lao, Khmer, Armenian, Georgian, Ethiopic, emoji.
   • NOT supported: Chinese (Simplified & Traditional), Japanese, Korean. These scripts render as empty-box glyphs because the PDF renderer has no CJK fonts installed.
   • If the content you would send is primarily in Chinese / Japanese / Korean, do NOT call "generate" with sourceType "markdown" or "html". Instead, in your reply you MUST do BOTH:
     (a) Deliver the full report content directly in chat — same structure (headings, Conclusion, Key Points, Details, Sources) you would have put in the PDF.
     (b) Add ONE short sentence in the user's own language explaining that no PDF was produced because the renderer does not yet support CJK fonts, and inviting them to ask for an English-translated PDF if they need a file deliverable. Example (Chinese): "(说明：当前 PDF 渲染器暂不支持中文字体，因此直接以 Markdown 形式输出。如需英文 PDF 版本，请告诉我。)"
   Silently omitting the PDF without (b) is not acceptable — the user expected a file deliverable and must understand why it didn't come.
   • The "url" sourceType is exempt from this limit — remote pages supply their own fonts.

   URL MODE (sourceType: "url"):
   • For web pages: renders the page as a PDF
   • For direct PDF links (e.g. https://example.com/report.pdf): downloads the original PDF file as-is
   • Use this to download and store existing PDF files from external URLs
   • The returned fileStorageId can be passed to document_write to save to a folder in the documents hub

EXAMPLES:
• Generate: { "operation": "generate", "fileName": "report", "sourceType": "markdown", "content": "# Report\\n..." }
• Download existing PDF: { "operation": "generate", "fileName": "report", "sourceType": "url", "content": "https://example.com/report.pdf" }

AFTER GENERATING: Check the downloadUrl in the result:
- If it says "[file card shown in chat]": the file is already visible as a download card. Do NOT mention downloading, do NOT include a link, and do NOT say "you can download it" — the card handles this.
- If it contains an actual URL: no download card was shown. You MUST include the URL as a clickable markdown link so the user can download the file.
To also save the file to a folder in the documents hub, call document_write with the returned fileStorageId and the desired folderPath.
`,
    inputSchema: z.object({
      operation: z.literal('generate'),
      fileName: z
        .string()
        .describe('Base name for the PDF file (without extension)'),
      sourceType: z
        .enum(['markdown', 'html', 'url'])
        .describe('Type of source content'),
      content: z
        .string()
        .describe('Markdown text, HTML content, or URL to capture'),
      pdfOptions: z
        .object({
          format: z.string().optional(),
          landscape: z.boolean().optional(),
          marginTop: z.string().optional(),
          marginBottom: z.string().optional(),
          marginLeft: z.string().optional(),
          marginRight: z.string().optional(),
          printBackground: z.boolean().optional(),
        })
        .optional()
        .describe('Advanced PDF options'),
      urlOptions: z
        .object({
          waitUntil: z
            .enum(['load', 'domcontentloaded', 'networkidle', 'commit'])
            .optional(),
        })
        .optional()
        .describe('Options for URL capture'),
      extraCss: z.string().optional().describe('Additional CSS to inject'),
      wrapInTemplate: z
        .boolean()
        .optional()
        .describe('Whether to wrap in HTML template'),
    }),
    execute: async (ctx: ToolCtx, args): Promise<GeneratePdfResult> => {
      const { organizationId } = ctx;
      if (!organizationId) {
        throw new Error('organizationId is required to generate a PDF');
      }

      debugLog('tool:pdf generate start', {
        fileName: args.fileName,
        sourceType: args.sourceType,
      });

      try {
        const result = await ctx.runAction(
          internal.documents.internal_actions.generateDocument,
          {
            organizationId,
            fileName: args.fileName,
            sourceType: args.sourceType,
            outputFormat: 'pdf',
            content: args.content,
            pdfOptions: args.pdfOptions,
            urlOptions: args.urlOptions,
            extraCss: args.extraCss,
            wrapInTemplate: args.wrapInTemplate,
          },
        );

        debugLog('tool:pdf generate success', {
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
        } as GeneratePdfResult;
      } catch (error) {
        console.error('[tool:pdf generate] error', {
          fileName: args.fileName,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }),
} as const satisfies ToolDefinition;
