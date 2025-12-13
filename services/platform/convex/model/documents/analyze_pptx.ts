/**
 * Analyze a PPTX template to extract its full content.
 *
 * This is the model-layer helper; Convex actions should call this via a thin
 * wrapper in `convex/documents.ts`.
 */

import type { ActionCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { getCrawlerUrl } from './generate_document_helpers';
import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_DOCUMENTS', '[Documents]');

export interface TextContentInfo {
  text: string;
  isPlaceholder: boolean;
}

export interface TableInfo {
  rowCount: number;
  columnCount: number;
  headers: string[];
  rows: string[][];
}

export interface ChartInfo {
  chartType: string;
  hasLegend?: boolean;
  seriesCount?: number;
}

export interface ImageInfo {
  width?: number;
  height?: number;
}

export interface SlideInfo {
  slideNumber: number;
  layoutName: string;
  title: string | null;
  subtitle: string | null;
  textContent: TextContentInfo[];
  tables: TableInfo[];
  charts: ChartInfo[];
  images: ImageInfo[];
}

export interface BrandingInfo {
  slideWidth?: number;
  slideHeight?: number;
  titleFontName?: string | null;
  bodyFontName?: string | null;
  titleFontSize?: number;
  bodyFontSize?: number;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
}

export interface AnalyzePptxArgs {
  templateStorageId: Id<'_storage'>;
}

export interface AnalyzePptxResult {
  success: boolean;
  slideCount: number;
  slides: SlideInfo[];
  availableLayouts: string[];
  branding: BrandingInfo;
}

/**
 * Analyze a PPTX template to extract its full content using the crawler service.
 *
 * Uses multipart form upload to send the file directly to the crawler service,
 * avoiding memory-intensive base64 encoding.
 */
export async function analyzePptx(
  ctx: ActionCtx,
  args: AnalyzePptxArgs,
): Promise<AnalyzePptxResult> {
  const crawlerUrl = getCrawlerUrl();
  const apiUrl = `${crawlerUrl}/api/v1/pptx/analyze`;

  const templateStorageId = args.templateStorageId;

  // Download the template from Convex storage
  const templateUrl = await ctx.storage.getUrl(templateStorageId);
  if (!templateUrl) {
    throw new Error(
      `Template file not found in storage (ID: ${templateStorageId}). ` +
        'Please upload a PPTX template to Convex storage first.',
    );
  }

  const templateResponse = await fetch(templateUrl);
  if (!templateResponse.ok) {
    throw new Error(`Failed to fetch template: ${templateResponse.status}`);
  }
  const templateBlob = await templateResponse.blob();

  // Create FormData and upload the file directly (no base64 encoding)
  const formData = new FormData();
  formData.append('template_file', templateBlob, 'template.pptx');

  debugLog('documents.analyzePptx start', {
    templateStorageId,
  });

  const response = await fetch(apiUrl, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error('[documents.analyzePptx] crawler error', {
      status: response.status,
      errorText,
    });
    throw new Error(`Crawler analyzePptx failed: ${response.status}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error || 'Failed to analyze PPTX template');
  }

  debugLog('documents.analyzePptx success', {
    slideCount: result.slideCount,
  });

  // Map the crawler response to our expected format
  // The Pydantic models use camelCase, so we can use the response directly
  const slides: SlideInfo[] = (result.slides || []).map(
    (slide: {
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
      images: Array<{ width?: number; height?: number }>;
    }) => ({
      slideNumber: slide.slideNumber,
      layoutName: slide.layoutName,
      title: slide.title,
      subtitle: slide.subtitle,
      textContent: (slide.textContent || []).map((t) => ({
        text: t.text,
        isPlaceholder: t.isPlaceholder,
      })),
      tables: (slide.tables || []).map((t) => ({
        rowCount: t.rowCount,
        columnCount: t.columnCount,
        headers: t.headers,
        rows: t.rows,
      })),
      charts: (slide.charts || []).map((c) => ({
        chartType: c.chartType,
        ...(c.hasLegend != null ? { hasLegend: c.hasLegend } : {}),
        ...(c.seriesCount != null ? { seriesCount: c.seriesCount } : {}),
      })),
      images: slide.images || [],
    }),
  );

  // Extract branding from the result
  const branding: BrandingInfo = result.branding || {};

  return {
    success: result.success,
    slideCount: result.slideCount,
    slides,
    availableLayouts: result.availableLayouts || [],
    branding,
  };
}
