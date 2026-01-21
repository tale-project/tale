import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

export interface ResourceCheckArgs {
  url: string;
  timeoutMs?: number;
}

export interface ResourceCheckBatchArgs {
  urls: string[];
  timeoutMs?: number;
}

export interface ResourceCheckBatchResult {
  results: ResourceCheckResult[];
}

export interface ResourceCheckResult {
  success: boolean;
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  contentType: string | null;
  contentLength: number | null;
  isImage: boolean;
  error?: string;
}

export async function checkResourceAccessible({
  url,
  timeoutMs = 10_000,
}: ResourceCheckArgs): Promise<ResourceCheckResult> {
  const trimmedUrl = url.trim();
  const lower = trimmedUrl.toLowerCase();

  if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
    const result: ResourceCheckResult = {
      success: false,
      url: trimmedUrl,
      finalUrl: trimmedUrl,
      status: 0,
      ok: false,
      contentType: null,
      contentLength: null,
      isImage: false,
      error: 'Only http and https URLs are supported',
    };

    debugLog('tool:resource_check invalid scheme', {
      url: trimmedUrl,
    });

    return result;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    debugLog('tool:resource_check HEAD start', {
      url: trimmedUrl,
      timeoutMs,
    });

    const response = await fetch(trimmedUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type');
    const contentLengthHeader = response.headers.get('content-length');
    const parsedLength = contentLengthHeader
      ? Number.parseInt(contentLengthHeader, 10)
      : Number.NaN;
    const contentLength = Number.isFinite(parsedLength) ? parsedLength : null;

    const isImage =
      typeof contentType === 'string' &&
      contentType.toLowerCase().startsWith('image/');

    const result: ResourceCheckResult = {
      success: true,
      url: trimmedUrl,
      finalUrl: response.url || trimmedUrl,
      status: response.status,
      ok: response.ok,
      contentType: contentType ?? null,
      contentLength,
      isImage,
    };

    debugLog('tool:resource_check HEAD result', {
      url: trimmedUrl,
      status: response.status,
      ok: response.ok,
      contentType,
      contentLength,
      isImage,
    });

    return result;
  } catch (error) {
    clearTimeout(timeoutId);

    const message = error instanceof Error ? error.message : String(error);

    console.error('[tool:resource_check] error', {
      url: trimmedUrl,
      error: message,
    });

    const result: ResourceCheckResult = {
      success: false,
      url: trimmedUrl,
      finalUrl: trimmedUrl,
      status: 0,
      ok: false,
      contentType: null,
      contentLength: null,
      isImage: false,
      error: message,
    };

    return result;
  }
}

export async function checkResourcesAccessibleBatch({
  urls,
  timeoutMs = 10_000,
}: ResourceCheckBatchArgs): Promise<ResourceCheckBatchResult> {
  debugLog('tool:resource_check batch start', {
    urlCount: urls.length,
    timeoutMs,
  });

  const results = await Promise.allSettled(
    urls.map((url) => checkResourceAccessible({ url, timeoutMs })),
  );

  const processedResults = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      success: false,
      url: urls[index],
      finalUrl: urls[index],
      status: 0,
      ok: false,
      contentType: null,
      contentLength: null,
      isImage: false,
      error: result.reason?.message || 'Unknown error',
    };
  });

  debugLog('tool:resource_check batch complete', {
    total: processedResults.length,
    successCount: processedResults.filter((r) => r.success).length,
  });

  return { results: processedResults };
}
