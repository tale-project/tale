import { v } from 'convex/values';

import type { ActionCtx } from '../../../_generated/server';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { WebsitePagesActionParams } from './helpers/types';

import { jsonRecordValidator } from '../../../../lib/shared/schemas/utils/json-value';
import { isRecord, getRecord } from '../../../../lib/utils/type-guards';
import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { toConvexJsonValue } from '../../../lib/type_cast_helpers';

const debugLog = createDebugLog('DEBUG_WEBSITE_PAGES', '[WebsitePages]');

const BATCH_SIZE = 100;

const pageValidator = v.object({
  url: v.string(),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  content: v.optional(v.string()),
  wordCount: v.optional(v.number()),
  word_count: v.optional(v.number()),
  metadata: v.optional(jsonRecordValidator),
  structuredData: v.optional(jsonRecordValidator),
  structured_data: v.optional(jsonRecordValidator),
});

export const websitePagesAction: ActionDefinition<WebsitePagesActionParams> = {
  type: 'websitePages',
  title: 'Website Pages',
  description:
    'Manage website pages (bulk upsert, register URLs, crawl and upsert). organizationId is automatically read from workflow context variables.',

  parametersValidator: v.union(
    v.object({
      operation: v.literal('bulk_upsert'),
      websiteId: v.id('websites'),
      pages: v.array(pageValidator),
    }),
    v.object({
      operation: v.literal('register_urls'),
      websiteId: v.id('websites'),
      urls: v.array(
        v.object({
          url: v.string(),
          contentHash: v.optional(v.union(v.string(), v.null())),
          status: v.optional(v.string()),
        }),
      ),
    }),
    v.object({
      operation: v.literal('crawl_and_upsert'),
      websiteId: v.id('websites'),
      urls: v.array(v.string()),
      wordCountThreshold: v.optional(v.number()),
      crawlerTimeoutMs: v.optional(v.number()),
    }),
  ),

  async execute(ctx, params, variables) {
    switch (params.operation) {
      case 'bulk_upsert':
        return await executeBulkUpsert(ctx, params, variables);
      case 'register_urls':
        return await executeRegisterUrls(ctx, params, variables);
      case 'crawl_and_upsert':
        return await executeCrawlAndUpsert(ctx, params, variables);
      default:
        throw new Error(
          `Unknown websitePages operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};

type BulkUpsertParams = Extract<
  WebsitePagesActionParams,
  { operation: 'bulk_upsert' }
>;

type RegisterUrlsParams = Extract<
  WebsitePagesActionParams,
  { operation: 'register_urls' }
>;

type CrawlAndUpsertParams = Extract<
  WebsitePagesActionParams,
  { operation: 'crawl_and_upsert' }
>;

function getOrganizationId(
  variables: Record<string, unknown>,
  operation: string,
) {
  const organizationId =
    typeof variables.organizationId === 'string'
      ? variables.organizationId
      : undefined;

  if (!organizationId) {
    throw new Error(
      `${operation} operation requires organizationId in context`,
    );
  }

  return organizationId;
}

async function executeBulkUpsert(
  ctx: ActionCtx,
  params: BulkUpsertParams,
  variables: Record<string, unknown>,
) {
  const organizationId = getOrganizationId(variables, 'bulk_upsert');

  const normalizedPages = params.pages.map((p) => {
    const sd = p.structuredData ?? p.structured_data;
    return {
      url: p.url,
      title: p.title ?? undefined,
      content: p.content ?? undefined,
      wordCount: p.wordCount ?? p.word_count ?? undefined,
      metadata: p.metadata ? toConvexJsonValue(p.metadata) : undefined,
      structuredData: sd ? toConvexJsonValue(sd) : undefined,
    };
  });

  const result = await ctx.runMutation(
    internal.websites.internal_mutations.bulkUpsertPages,
    {
      organizationId,
      websiteId: params.websiteId,
      pages: normalizedPages,
    },
  );

  return {
    operation: 'bulk_upsert' as const,
    created: result.created,
    updated: result.updated,
    total: result.total,
    success: true,
    timestamp: Date.now(),
  };
}

async function executeRegisterUrls(
  ctx: ActionCtx,
  params: RegisterUrlsParams,
  variables: Record<string, unknown>,
) {
  const organizationId = getOrganizationId(variables, 'register_urls');

  let totalRegistered = 0;
  let totalUpdated = 0;
  let totalDeleted = 0;
  let totalSkipped = 0;
  const allUrlsToSync: string[] = [];

  // Normalize entries: map null contentHash to undefined for Convex
  const entries = params.urls.map((entry) => ({
    url: entry.url,
    contentHash: entry.contentHash ?? undefined,
    status: entry.status,
  }));

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);

    debugLog(
      `Registering URL batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} URLs)`,
    );

    const result = await ctx.runMutation(
      internal.websites.internal_mutations.registerUrls,
      {
        organizationId,
        websiteId: params.websiteId,
        urls: batch,
      },
    );

    totalRegistered += result.registered;
    totalUpdated += result.updated;
    totalDeleted += result.deleted;
    totalSkipped += result.skipped;
    allUrlsToSync.push(...result.urlsToSync);
  }

  debugLog(
    `Registered ${totalRegistered}, updated ${totalUpdated}, deleted ${totalDeleted}, skipped ${totalSkipped}`,
  );

  return {
    operation: 'register_urls' as const,
    registered: totalRegistered,
    updated: totalUpdated,
    deleted: totalDeleted,
    skipped: totalSkipped,
    total: params.urls.length,
    urlsToSync: allUrlsToSync,
    success: true,
    timestamp: Date.now(),
  };
}

interface CrawlerFetchResponse {
  success: boolean;
  urls_requested: number;
  urls_fetched: number;
  pages: Array<{
    url: string;
    title?: string;
    content: string;
    word_count: number;
    metadata?: Record<string, unknown>;
    structured_data?: Record<string, unknown>;
  }>;
  failed?: Array<{ url: string; status_code: number | null; error: string }>;
}

async function executeCrawlAndUpsert(
  ctx: ActionCtx,
  params: CrawlAndUpsertParams,
  variables: Record<string, unknown>,
) {
  const organizationId = getOrganizationId(variables, 'crawl_and_upsert');

  debugLog('crawl_and_upsert params.urls:', {
    hasUrls: params.urls !== undefined,
    urlsType: typeof params.urls,
    isArray: Array.isArray(params.urls),
    urlsLength: Array.isArray(params.urls) ? params.urls.length : 'N/A',
    registerUrlsStep: (() => {
      const steps = isRecord(variables.steps) ? variables.steps : undefined;
      return steps?.register_urls ? 'exists' : 'missing';
    })(),
    registerUrlsOutput: (() => {
      const steps = isRecord(variables.steps) ? variables.steps : undefined;
      const step = steps ? getRecord(steps, 'register_urls') : undefined;
      const output = step ? getRecord(step, 'output') : undefined;
      const data = output ? getRecord(output, 'data') : undefined;
      return {
        hasOutput: !!output,
        hasData: !!data,
        hasUrlsToSync: data?.urlsToSync !== undefined,
        urlsToSyncType: typeof data?.urlsToSync,
        urlsToSyncIsArray: Array.isArray(data?.urlsToSync),
      };
    })(),
  });

  const urls = params.urls ?? [];

  if (urls.length === 0) {
    debugLog('No URLs to sync');
    return {
      operation: 'crawl_and_upsert' as const,
      processed: 0,
      failed: 0,
      total: 0,
      success: true,
      timestamp: Date.now(),
    };
  }

  const wordCountThreshold = params.wordCountThreshold ?? 100;
  const crawlerTimeout = params.crawlerTimeoutMs ?? 300000;
  const serviceUrl = process.env.CRAWLER_URL || 'http://localhost:8002';

  debugLog(`Fetching ${urls.length} pages via crawler`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), crawlerTimeout);

  const response = await fetch(`${serviceUrl}/api/v1/urls/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      urls,
      word_count_threshold: wordCountThreshold,
    }),
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Crawler service error (${response.status}): ${errorText}`);
  }

  const fetchResult: CrawlerFetchResponse = await response.json();

  if (!fetchResult.success) {
    const errorMessage =
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
      (fetchResult as unknown as { error?: string }).error || 'Unknown error';
    throw new Error(`URL fetch failed: ${errorMessage}`);
  }

  const failedCount = fetchResult.failed?.length ?? 0;

  debugLog(
    `Crawler returned ${fetchResult.pages.length} pages, ${failedCount} failures`,
  );

  if (fetchResult.pages.length > 0) {
    const normalizedPages = fetchResult.pages.map((p) => ({
      url: p.url,
      title: p.title ?? undefined,
      content: p.content,
      wordCount: p.word_count,
      metadata: p.metadata ? toConvexJsonValue(p.metadata) : undefined,
      structuredData: p.structured_data
        ? toConvexJsonValue(p.structured_data)
        : undefined,
    }));

    await ctx.runMutation(
      internal.websites.internal_mutations.bulkUpsertPages,
      {
        organizationId,
        websiteId: params.websiteId,
        pages: normalizedPages,
      },
    );
  }

  return {
    operation: 'crawl_and_upsert' as const,
    processed: fetchResult.pages.length,
    failed: failedCount,
    total: urls.length,
    success: true,
    timestamp: Date.now(),
  };
}
