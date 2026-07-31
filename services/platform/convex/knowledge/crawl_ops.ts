'use node';

/**
 * The node-side operations the websites surface calls — thin wrappers that
 * resolve the organization's corpus pool and run the SQL in `crawl.ts`.
 *
 * They exist because `convex/websites/*` runs in the V8 runtime (its public
 * actions and mutations must stay importable there) while every corpus read
 * and write needs the `postgres` driver. Each wrapper is one hop:
 * `ctx.runAction(internal.knowledge.crawl_ops.…)`.
 */

import { v } from 'convex/values';

import { metaDescription, siteHosts } from '../../lib/knowledge/crawl-parse';
import { htmlTitle } from '../../lib/knowledge/html-to-text';
import { internalAction } from '../_generated/server';
import { safeFetch } from '../lib/http/safe_fetch';
import type {
  CrawlerWebsiteInfo,
  FetchChunksResult,
  FetchPagesResult,
  SearchContentResult,
} from '../websites/types';
import {
  deregisterDomain,
  fetchWebsiteInfoFromCorpus,
  isMemberDomain,
  listPageChunks,
  listWebsitePages,
  registerDomain,
  searchDomainContent,
  setScanInterval,
} from './crawl';
import { getKnowledgePoolForOrg } from './pool';

const HOMEPAGE_TIMEOUT_MS = 15_000;
const HOMEPAGE_MAX_BYTES = 2 * 1024 * 1024;

export const registerDomainOp = internalAction({
  args: {
    orgSlug: v.string(),
    domain: v.string(),
    scanIntervalSeconds: v.number(),
  },
  returns: v.null(),
  handler: async (_ctx, args): Promise<null> => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    await registerDomain(
      sql,
      args.orgSlug,
      args.domain,
      args.scanIntervalSeconds,
    );
    return null;
  },
});

export const setScanIntervalOp = internalAction({
  args: {
    orgSlug: v.string(),
    domain: v.string(),
    scanIntervalSeconds: v.number(),
  },
  returns: v.null(),
  handler: async (_ctx, args): Promise<null> => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    if (!(await isMemberDomain(sql, args.orgSlug, args.domain))) return null;
    await setScanInterval(sql, args.domain, args.scanIntervalSeconds);
    return null;
  },
});

export const deregisterDomainOp = internalAction({
  args: { orgSlug: v.string(), domain: v.string() },
  returns: v.null(),
  handler: async (_ctx, args): Promise<null> => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    await deregisterDomain(sql, args.orgSlug, args.domain);
    return null;
  },
});

export const websiteInfoOp = internalAction({
  args: { orgSlug: v.string(), domain: v.string() },
  handler: async (_ctx, args): Promise<CrawlerWebsiteInfo | null> => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    return await fetchWebsiteInfoFromCorpus(sql, args.orgSlug, args.domain);
  },
});

export const websitePagesOp = internalAction({
  args: {
    orgSlug: v.string(),
    domain: v.string(),
    offset: v.number(),
    limit: v.number(),
  },
  handler: async (_ctx, args): Promise<FetchPagesResult> => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    if (!(await isMemberDomain(sql, args.orgSlug, args.domain))) {
      return { pages: [], total: 0, offset: args.offset, hasMore: false };
    }
    const { pages, total } = await listWebsitePages(
      sql,
      args.domain,
      args.offset,
      args.limit,
    );
    return {
      pages,
      total,
      offset: args.offset,
      hasMore: args.offset + pages.length < total,
    };
  },
});

export const pageChunksOp = internalAction({
  args: { orgSlug: v.string(), domain: v.string(), url: v.string() },
  handler: async (_ctx, args): Promise<FetchChunksResult> => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    if (!(await isMemberDomain(sql, args.orgSlug, args.domain))) {
      return { url: args.url, chunks: [], total: 0 };
    }
    const { chunks, total } = await listPageChunks(sql, args.domain, args.url);
    return { url: args.url, chunks, total };
  },
});

export const searchContentOp = internalAction({
  args: {
    orgSlug: v.string(),
    domain: v.string(),
    query: v.string(),
    limit: v.number(),
  },
  handler: async (_ctx, args): Promise<SearchContentResult> => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    if (!(await isMemberDomain(sql, args.orgSlug, args.domain))) {
      return { query: args.query, results: [], total: 0 };
    }
    const { results, total } = await searchDomainContent(
      sql,
      args.domain,
      args.query,
      args.limit,
    );
    return { query: args.query, results, total };
  },
});

/** Fetch the homepage's `<title>` and meta description — the quick facts the
 * websites list shows the moment a site is added, ahead of the first scan. */
export const homepageMetadataOp = internalAction({
  args: { domain: v.string() },
  handler: async (
    _ctx,
    args,
  ): Promise<{ title?: string; description?: string } | null> => {
    try {
      const response = await safeFetch(`https://${args.domain}/`, {
        method: 'GET',
        headers: { accept: 'text/html' },
        timeoutMs: HOMEPAGE_TIMEOUT_MS,
        maxResponseBytes: HOMEPAGE_MAX_BYTES,
        allowedHosts: [...siteHosts(args.domain)],
      });
      if (response.status < 200 || response.status >= 300) return null;
      const title = htmlTitle(response.body) ?? undefined;
      const description = metaDescription(response.body) ?? undefined;
      if (title === undefined && description === undefined) return null;
      return {
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
      };
    } catch (error) {
      console.warn(
        `[crawl] homepage metadata fetch failed for ${args.domain}:`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  },
});
