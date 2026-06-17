'use node';

/**
 * Generate a document (PDF / image / DOCX) in-process and store it in Convex
 * storage.
 *
 * `'use node'`: this model helper value-imports the `'use node'` crawler libs
 * (Playwright dispatch, jszip OOXML, the remark markdown pipeline), so it must
 * run in the Node runtime. It is invoked only from `'use node'` internalActions
 * and is intentionally NOT re-exported by the V8-reachable `documents/helpers`
 * barrel (which `documents/internal_queries.ts` namespace-imports) — keeping the
 * Node/V8 bundling boundary clean.
 *
 * Replaces the former `services/crawler` HTTP calls
 * (`POST /api/v1/{pdf,images}/from-{markdown,html,url}` and
 * `POST /api/v1/docx/from-{markdown,html}`):
 *   - PDF/image: HTML/markdown → HTML (in-process) → headless Playwright render
 *     in the sandbox (`renderDocumentInSandbox`). The render writes its bytes
 *     straight to a Convex `_storage` slot, so this helper only assembles the
 *     HTML, dispatches, and saves file metadata.
 *   - DOCX from markdown/html: in-process OOXML generation (`docx_generate`).
 *
 * This is the model-layer helper; Convex actions call it via a thin wrapper in
 * `convex/documents/internal_actions.ts`.
 */

import { fetchJson } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import {
  htmlToDocxBytes,
  markdownToDocxBytes,
} from '../crawler/lib/docx_generate';
import {
  injectCss,
  markdownToHtml,
  wrapHtml,
} from '../crawler/lib/markdown_to_html';
import {
  renderDocumentInSandbox,
  type SandboxImageOptions,
  type SandboxPdfOptions,
  type SandboxRenderRequest,
  type SandboxRenderSource,
} from '../crawler/lib/sandbox_render_document';
import { createDebugLog } from '../lib/debug_log';
import { sanitizeError } from '../lib/utils/sanitize_secrets';
import { buildDownloadUrl, getOutputInfo } from './generate_document_helpers';
import type { GenerateDocumentArgs, GenerateDocumentResult } from './types';

const debugLog = createDebugLog('DEBUG_DOCUMENTS', '[Documents]');

/** Decode common HTML entities (LLMs sometimes output HTML-encoded content). */
function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // Must be last to avoid double-decoding
}

/** Whether the HTML is a complete document (should NOT be template-wrapped). */
function isCompleteHtmlDocument(html: string): boolean {
  const trimmed = html.trim().toLowerCase();
  return (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    (trimmed.includes('<head') && trimmed.includes('<body'))
  );
}

/**
 * Build the finished HTML for a markdown/html source, applying the default
 * template + extra CSS exactly as the crawler PDF/image services did.
 */
function buildRenderHtml(args: GenerateDocumentArgs): string {
  if (args.sourceType === 'markdown') {
    const inner = markdownToHtml(args.content);
    const extraHead = args.extraCss ? `<style>${args.extraCss}</style>` : '';
    return wrapHtml(inner, extraHead);
  }
  // html source
  const decoded = decodeHtmlEntities(args.content);
  const wrap =
    args.wrapInTemplate !== undefined
      ? args.wrapInTemplate
      : !isCompleteHtmlDocument(decoded);
  if (wrap) {
    const extraHead = args.extraCss ? `<style>${args.extraCss}</style>` : '';
    return wrapHtml(decoded, extraHead);
  }
  return args.extraCss ? injectCss(decoded, args.extraCss) : decoded;
}

function buildPdfOptions(args: GenerateDocumentArgs): SandboxPdfOptions {
  const o = args.pdfOptions;
  return {
    format: o?.format ?? 'A4',
    landscape: o?.landscape ?? false,
    marginTop: o?.marginTop ?? '20mm',
    marginBottom: o?.marginBottom ?? '20mm',
    marginLeft: o?.marginLeft ?? '20mm',
    marginRight: o?.marginRight ?? '20mm',
    printBackground: o?.printBackground ?? true,
  };
}

function buildImageOptions(args: GenerateDocumentArgs): SandboxImageOptions {
  const o = args.imageOptions;
  const imageType = o?.imageType === 'jpeg' ? 'jpeg' : 'png';
  return {
    imageType,
    quality: o?.quality ?? 100,
    fullPage: o?.fullPage ?? true,
    width: o?.width ?? 1200,
    // URL screenshots get a viewport height; HTML uses a default.
    height: o?.height ?? (args.sourceType === 'url' ? 1080 : 600),
    scale: o?.scale ?? 1.0,
  };
}

function buildRenderSource(args: GenerateDocumentArgs): SandboxRenderSource {
  if (args.sourceType === 'url') {
    return {
      kind: 'url',
      url: args.content,
      waitUntil: args.urlOptions?.waitUntil ?? 'load',
    };
  }
  return { kind: 'html', html: buildRenderHtml(args) };
}

/** Upload bytes to Convex storage and return the storageId + size. */
async function uploadBytes(
  ctx: ActionCtx,
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
): Promise<{ storageId: Id<'_storage'>; size: number }> {
  const uploadUrl = await ctx.storage.generateUploadUrl();
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: bytes,
  });
  if (!uploadResponse.ok) {
    const uploadErrorText = await uploadResponse.text().catch(() => '');
    console.error('[documents.generateDocument] upload error', {
      status: uploadResponse.status,
      statusText: uploadResponse.statusText,
      errorText: sanitizeError(uploadErrorText, 400),
    });
    throw new Error(
      `Failed to upload generated document: HTTP ${uploadResponse.status}`,
    );
  }
  const { storageId } = await fetchJson<{ storageId: Id<'_storage'> }>(
    uploadResponse,
  );
  return { storageId, size: bytes.byteLength };
}

/**
 * Generate a document (PDF/image/DOCX) in-process and upload it to storage.
 */
export async function generateDocument(
  ctx: ActionCtx,
  args: GenerateDocumentArgs,
): Promise<GenerateDocumentResult> {
  debugLog('documents.generateDocument start', {
    fileName: args.fileName,
    sourceType: args.sourceType,
    outputFormat: args.outputFormat,
    contentLength: args.content.length,
    contentPreview: args.content.slice(0, 100),
  });

  const { contentType, extension } = getOutputInfo(
    args.outputFormat,
    args.imageOptions?.imageType,
  );

  let storageId: Id<'_storage'>;
  let size: number;

  if (args.outputFormat === 'pdf' || args.outputFormat === 'image') {
    // Headless render in the sandbox writes the bytes directly to a storage
    // slot; we receive the storageId back.
    const source = buildRenderSource(args);
    const request: SandboxRenderRequest =
      args.outputFormat === 'pdf'
        ? { output: 'pdf', source, pdf: buildPdfOptions(args) }
        : { output: 'image', source, image: buildImageOptions(args) };

    const rendered = await renderDocumentInSandbox(
      { ctx, organizationId: args.organizationId },
      request,
    );
    storageId = rendered.storageId;
    size = rendered.size;
  } else if (args.outputFormat === 'docx') {
    // markdown/html → DOCX in-process. (Structured-content DOCX goes through
    // the dedicated `generateDocx` helper, not this path.)
    if (args.sourceType === 'url') {
      throw new Error('DOCX generation does not support a URL source');
    }
    const bytes =
      args.sourceType === 'markdown'
        ? await markdownToDocxBytes(args.content)
        : await htmlToDocxBytes(decodeHtmlEntities(args.content));
    ({ storageId, size } = await uploadBytes(ctx, bytes, contentType));
  } else {
    throw new Error(
      `Unsupported output format for in-process generation: ${args.outputFormat}`,
    );
  }

  const safeExtension = extension || 'pdf';
  const lowerFileName = args.fileName.toLowerCase();
  const expectedSuffix = `.${safeExtension.toLowerCase()}`;
  const finalFileName = lowerFileName.endsWith(expectedSuffix)
    ? args.fileName
    : `${args.fileName}.${safeExtension}`;

  await ctx.runMutation(
    internal.file_metadata.internal_mutations.saveFileMetadata,
    {
      organizationId: args.organizationId,
      storageId,
      fileName: finalFileName,
      contentType,
      size,
      source: 'agent',
    },
  );

  const downloadUrl = buildDownloadUrl(storageId, finalFileName);

  debugLog('documents.generateDocument success', {
    fileName: finalFileName,
    storageId,
    size,
    contentType,
    extension: safeExtension,
  });

  return {
    success: true,
    fileStorageId: storageId,
    downloadUrl,
    fileName: finalFileName,
    contentType,
    size,
    extension: safeExtension,
  };
}
