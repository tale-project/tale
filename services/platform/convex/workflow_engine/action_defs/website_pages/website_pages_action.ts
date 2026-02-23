import { v } from 'convex/values';

import type { ActionCtx } from '../../../_generated/server';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { WebsitePagesActionParams } from './helpers/types';

import { jsonRecordValidator } from '../../../../lib/shared/schemas/utils/json-value';
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
    'Manage website pages (bulk upsert, register discovered URLs, sync pending pages). organizationId is automatically read from workflow context variables.',

  parametersValidator: v.union(
    v.object({
      operation: v.literal('bulk_upsert'),
      websiteId: v.id('websites'),
      pages: v.array(pageValidator),
    }),
    v.object({
      operation: v.literal('register_discovered_urls'),
      websiteId: v.id('websites'),
      urls: v.array(v.string()),
    }),
    v.object({
      operation: v.literal('sync_pending_pages'),
      websiteId: v.id('websites'),
      batchSize: v.optional(v.number()),
      wordCountThreshold: v.optional(v.number()),
      crawlerTimeoutMs: v.optional(v.number()),
    }),
  ),

  async execute(ctx, params, variables) {
    switch (params.operation) {
      case 'bulk_upsert':
        return await executeBulkUpsert(ctx, params, variables);
      case 'register_discovered_urls':
        return await executeRegisterDiscoveredUrls(ctx, params, variables);
      case 'sync_pending_pages':
        return await executeSyncPendingPages(ctx, params, variables);
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

type RegisterDiscoveredUrlsParams = Extract<
  WebsitePagesActionParams,
  { operation: 'register_discovered_urls' }
>;

type SyncPendingPagesParams = Extract<
  WebsitePagesActionParams,
  { operation: 'sync_pending_pages' }
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

async function executeRegisterDiscoveredUrls(
  ctx: ActionCtx,
  params: RegisterDiscoveredUrlsParams,
  variables: Record<string, unknown>,
) {
  const organizationId = getOrganizationId(
    variables,
    'register_discovered_urls',
  );

  let totalRegistered = 0;
  let totalSkipped = 0;

  for (let i = 0; i < params.urls.length; i += BATCH_SIZE) {
    const batch = params.urls.slice(i, i + BATCH_SIZE);

    debugLog(
      `Registering URL batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} URLs)`,
    );

    const result = await ctx.runMutation(
      internal.websites.internal_mutations.registerDiscoveredUrls,
      {
        organizationId,
        websiteId: params.websiteId,
        urls: batch,
      },
    );

    totalRegistered += result.registered;
    totalSkipped += result.skipped;
  }

  debugLog(
    `Registered ${totalRegistered} URLs, skipped ${totalSkipped} duplicates`,
  );

  return {
    operation: 'register_discovered_urls' as const,
    registered: totalRegistered,
    skipped: totalSkipped,
    total: params.urls.length,
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
  failed: Array<{ url: string; status_code: number | null; error: string }>;
}

async function executeSyncPendingPages(
  ctx: ActionCtx,
  params: SyncPendingPagesParams,
  variables: Record<string, unknown>,
) {
  const organizationId = getOrganizationId(variables, 'sync_pending_pages');
  const batchSize = params.batchSize ?? 50;
  const wordCountThreshold = params.wordCountThreshold ?? 100;
  const crawlerTimeout = params.crawlerTimeoutMs ?? 1800000;
  const serviceUrl = process.env.CRAWLER_URL || 'http://localhost:8002';

  const pendingResult = await ctx.runQuery(
    internal.websites.internal_queries.findPendingPages,
    { websiteId: params.websiteId, limit: batchSize },
  );

  if (pendingResult.pages.length === 0) {
    debugLog('No pending pages to sync');
    return {
      operation: 'sync_pending_pages' as const,
      processed: 0,
      failed: 0,
      deleted: 0,
      hasMore: false,
      success: true,
      timestamp: Date.now(),
    };
  }

  debugLog(`Fetching ${pendingResult.pages.length} pending pages via crawler`);

  const urls = pendingResult.pages.map((p) => p.url);

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

  debugLog(
    `Crawler returned ${fetchResult.pages.length} pages, ${fetchResult.failed.length} failures`,
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

  const pageUrlToId = new Map(pendingResult.pages.map((p) => [p.url, p._id]));

  const pagesToDelete = [];
  const pagesToMarkSynced = [];

  for (const failure of fetchResult.failed) {
    const pageId = pageUrlToId.get(failure.url);
    if (!pageId) continue;

    if (failure.status_code === 404 || failure.status_code === 410) {
      pagesToDelete.push(pageId);
    } else {
      pagesToMarkSynced.push(pageId);
    }
  }

  if (pagesToDelete.length > 0) {
    debugLog(`Deleting ${pagesToDelete.length} pages (404/410)`);
    await ctx.runMutation(internal.websites.internal_mutations.deletePages, {
      websiteId: params.websiteId,
      pageIds: pagesToDelete,
    });
  }

  if (pagesToMarkSynced.length > 0) {
    debugLog(
      `Marking ${pagesToMarkSynced.length} failed pages as synced (non-404/410 errors)`,
    );
    await ctx.runMutation(
      internal.websites.internal_mutations.markPagesSynced,
      { pageIds: pagesToMarkSynced },
    );
  }

  return {
    operation: 'sync_pending_pages' as const,
    processed: fetchResult.pages.length,
    failed: fetchResult.failed.length,
    deleted: pagesToDelete.length,
    hasMore: pendingResult.hasMore,
    success: true,
    timestamp: Date.now(),
  };
}
