import type {
  DocumentSourceType,
  DocumentOutputFormat,
  GenerateDocumentPdfOptions,
  GenerateDocumentImageOptions,
  GenerateDocumentUrlOptions,
} from './types';

/**
 * Get crawler service URL from environment or use a sensible default.
 *
 * Priority:
 * - CRAWLER_URL environment variable (e.g., http://crawler:8002 in Docker)
 * - Default: http://localhost:8002 for local development
 */
export function getCrawlerUrl(): string {
  return process.env.CRAWLER_URL || 'http://localhost:8002';
}

/**
 * Build the API endpoint path based on source type and output format.
 */
export function getEndpointPath(
  sourceType: DocumentSourceType,
  outputFormat: DocumentOutputFormat,
): string {
  return `/api/v1/convert/${sourceType}-to-${outputFormat}`;
}

/**
 * Build the request body based on source type and options.
 */
export function buildRequestBody(
  sourceType: DocumentSourceType,
  outputFormat: DocumentOutputFormat,
  content: string,
  pdfOptions?: GenerateDocumentPdfOptions,
  imageOptions?: GenerateDocumentImageOptions,
  urlOptions?: GenerateDocumentUrlOptions,
  extraCss?: string,
  wrapInTemplate?: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  // Set content field based on source type
  if (sourceType === 'markdown') {
    body.content = content;
  } else if (sourceType === 'html') {
    body.html = content;
    body.wrap_in_template = wrapInTemplate ?? true;
  } else if (sourceType === 'url') {
    body.url = content;
    if (urlOptions?.waitUntil) {
      body.wait_until = urlOptions.waitUntil;
    }
    // URL to image also needs height
    if (outputFormat === 'image' && imageOptions?.height) {
      body.height = imageOptions.height;
    }
  }

  // Set options based on output format
  if (outputFormat === 'pdf') {
    body.options = {
      format: pdfOptions?.format ?? 'A4',
      landscape: pdfOptions?.landscape ?? false,
      margin_top: pdfOptions?.marginTop ?? '20mm',
      margin_bottom: pdfOptions?.marginBottom ?? '20mm',
      margin_left: pdfOptions?.marginLeft ?? '20mm',
      margin_right: pdfOptions?.marginRight ?? '20mm',
      print_background: pdfOptions?.printBackground ?? true,
    };
  } else {
    body.options = {
      image_type: imageOptions?.imageType ?? 'png',
      quality: imageOptions?.quality ?? 90,
      full_page: imageOptions?.fullPage ?? true,
      width: imageOptions?.width ?? 800,
    };
  }

  // Add extra CSS for markdown/html sources
  if (sourceType !== 'url' && extraCss) {
    body.extra_css = extraCss;
  }

  return body;
}

/**
 * Get content type and file extension based on output format.
 */
export function getOutputInfo(
  outputFormat: DocumentOutputFormat,
  imageType?: string,
): { contentType: string; extension: string } {
  if (outputFormat === 'pdf') {
    return { contentType: 'application/pdf', extension: 'pdf' };
  }
  const type = imageType ?? 'png';
  return {
    contentType: type === 'png' ? 'image/png' : 'image/jpeg',
    extension: type,
  };
}

/**
 * Get the public site URL for building download URLs returned to clients.
 *
 * Uses SITE_URL + /http_api to route through the Next.js proxy, which forwards
 * requests to the Convex HTTP API (port 3211) internally.
 *
 * This works both in:
 * - Local development: http://localhost:3000/http_api -> http://127.0.0.1:3211
 * - Docker: http://localhost:3000/http_api -> http://127.0.0.1:3211 (via Next.js rewrites)
 *
 * Fallback to direct Convex HTTP API for cases where SITE_URL is not set.
 */
export function getPublicSiteUrl(): string {
  const siteUrl = process.env.SITE_URL;
  if (siteUrl) {
    // Route through Next.js proxy which forwards to Convex HTTP API
    return `${siteUrl}/http_api`;
  }
  // Fallback for local dev without SITE_URL set
  return 'http://127.0.0.1:3211';
}

/**
 * Build a download URL for a file stored in Convex storage.
 *
 * Uses our custom HTTP endpoint that sets Content-Disposition header,
 * ensuring the downloaded file has the correct filename instead of the storage ID.
 *
 * @param storageId - The Convex storage ID of the file
 * @param fileName - The desired filename for the download
 * @returns The full download URL
 */
export function buildDownloadUrl(storageId: string, fileName: string): string {
  const siteUrl = getPublicSiteUrl();
  return `${siteUrl}/storage?id=${storageId}&filename=${encodeURIComponent(fileName)}`;
}
