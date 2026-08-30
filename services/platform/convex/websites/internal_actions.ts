import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import type { Id } from '../lib/rows';
import type { CrawlerWebsiteInfo } from './types';

export function scanIntervalToSeconds(interval: string): number {
  switch (interval) {
    case '60m':
      return 3600;
    case '6h':
      return 21600;
    case '12h':
      return 43200;
    case '1d':
      return 86400;
    case '5d':
      return 432000;
    case '7d':
      return 604800;
    case '30d':
      return 2592000;
    default:
      return 21600;
  }
}

/**
 * Register a domain in the organization's `public_web` corpus and start its
 * first scan immediately — a freshly added website should show pages within
 * minutes, not wait out its scan interval.
 */
export async function registerDomainWithCrawler(
  ctx: ActionCtx,
  orgSlug: string,
  domain: string,
  scanInterval: string,
  organizationId: string,
): Promise<void> {
  await ctx.runAction(internal.knowledge.crawl_ops.registerDomainOp, {
    orgSlug,
    domain,
    scanIntervalSeconds: scanIntervalToSeconds(scanInterval),
  });
  await ctx.scheduler.runAfter(0, internal.knowledge.crawl_action.scanWebsite, {
    domain,
    orgSlug,
    organizationId,
  });
}

/**
 * Register a curated URL list in the organization's `public_web` corpus and
 * start its first scan immediately. The listed URLs are the whole frontier —
 * no discovery runs for a list.
 */
export async function registerUrlListWithCrawler(
  ctx: ActionCtx,
  orgSlug: string,
  domain: string,
  urls: readonly string[],
  scanInterval: string,
  organizationId: string,
): Promise<void> {
  await ctx.runAction(internal.knowledge.crawl_ops.registerUrlListOp, {
    orgSlug,
    domain,
    urls: [...urls],
    scanIntervalSeconds: scanIntervalToSeconds(scanInterval),
  });
  await ctx.scheduler.runAfter(0, internal.knowledge.crawl_action.scanWebsite, {
    domain,
    orgSlug,
    organizationId,
  });
}

export async function updateCrawlerScanInterval(
  ctx: ActionCtx,
  orgSlug: string,
  domain: string,
  scanInterval: string,
): Promise<void> {
  await ctx.runAction(internal.knowledge.crawl_ops.setScanIntervalOp, {
    orgSlug,
    domain,
    scanIntervalSeconds: scanIntervalToSeconds(scanInterval),
  });
}

export async function deregisterDomainFromCrawler(
  ctx: ActionCtx,
  orgSlug: string,
  domain: string,
): Promise<void> {
  await ctx.runAction(internal.knowledge.crawl_ops.deregisterDomainOp, {
    orgSlug,
    domain,
  });
}

export async function fetchWebsiteInfo(
  ctx: ActionCtx,
  orgSlug: string,
  domain: string,
): Promise<CrawlerWebsiteInfo | null> {
  return await ctx.runAction(internal.knowledge.crawl_ops.websiteInfoOp, {
    orgSlug,
    domain,
  });
} /**
 * Delete a website row, best-effort deregistering its crawler binding first.
 * Deregistration is already a logged no-op while the crawler is offline, so
 * deletion always proceeds.
 */
export async function deregisterAndDeleteWebsiteRow(
  ctx: ActionCtx,
  websiteId: Id<'websites'>,
  orgSlug: string,
  domain: string,
): Promise<void> {
  try {
    await deregisterDomainFromCrawler(ctx, orgSlug, domain);
  } catch (error) {
    console.warn(
      `[deleteWebsite] crawler deregister failed for ${domain}, deleting row anyway: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  await ctx.runMutation(internal.websites.internal_mutations.deleteWebsite, {
    websiteId,
  });
}
