'use node';

/**
 * Internal actions for website registration + URL listing.
 *
 * Maps the Python crawler's `services/crawler/app/routers/websites.py`
 * operations (register, get, list URLs, update scan interval, deregister) onto
 * the ported `lib/website_store` functions. The Python router resolved the
 * active org via `get_active_org()`; here `orgSlug` is passed explicitly.
 *
 * Return values are JSON-serializable: `Date` columns are converted to ISO
 * strings, and `last_crawled_at` (epoch seconds in the store) is passed through
 * as a number, matching the Python response shapes. `returns` validators are
 * omitted (allowed for actions; matches the RAG port).
 */

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import { getKnowledgePoolForOrg } from '../lib/knowledge/db/knowledge_db';
import {
  registerWebsite as storeRegisterWebsite,
  getWebsite as storeGetWebsite,
  getUrlsPage,
  getTotalCount,
  updateScanInterval as storeUpdateScanInterval,
  orgHasMembership,
  beginDelete,
  executeDelete,
  listPagesWithChunkCount,
  getPageChunks as storeGetPageChunks,
  type WebsiteRecord,
} from './lib/website_store';

/** ISO-serialize a nullable `Date`. */
function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** Shape a `WebsiteRecord` into a JSON-serializable response. */
function serializeWebsite(w: WebsiteRecord) {
  return {
    domain: w.domain,
    title: w.title,
    description: w.description,
    page_count: w.total_urls,
    crawled_count: w.crawled_count,
    status: w.status,
    scan_interval: w.scan_interval,
    last_scanned_at: toIso(w.last_scanned_at),
    error: w.error,
    created_at: toIso(w.created_at),
    updated_at: toIso(w.updated_at),
  };
}

/**
 * Register a domain for `orgSlug`. Mirrors `POST /api/v1/websites`: rejects
 * registration of a domain currently being deleted, then registers and echoes
 * the *stored* scan interval. `first_membership` lets the caller decide whether
 * to trigger an immediate scan.
 */
export const registerWebsite = internalAction({
  args: {
    orgSlug: v.string(),
    domain: v.string(),
    scanInterval: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    const existing = await storeGetWebsite(sql, args.domain);
    if (existing && existing.status === 'deleting') {
      return {
        success: false,
        error: `Domain ${args.domain} is currently being deleted. Please retry later.`,
      };
    }
    const result = await storeRegisterWebsite(
      sql,
      args.domain,
      args.scanInterval ?? 21600,
      args.orgSlug,
    );
    return {
      success: true,
      domain: args.domain,
      status: result.first_membership
        ? 'scanning'
        : (existing?.status ?? result.status),
      scan_interval: result.scan_interval,
      first_membership: result.first_membership,
    };
  },
});

/**
 * Get website info for `domain`. Mirrors `GET /api/v1/websites/{domain}`:
 * returns null when the caller's org has no membership or the domain is unknown.
 */
export const getWebsite = internalAction({
  args: {
    orgSlug: v.string(),
    domain: v.string(),
  },
  handler: async (_ctx, args) => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    if (!(await orgHasMembership(sql, args.domain, args.orgSlug))) {
      return { website: null };
    }
    const website = await storeGetWebsite(sql, args.domain);
    if (!website) {
      return { website: null };
    }
    return { website: serializeWebsite(website) };
  },
});

/**
 * List crawled URLs for `domain`. Mirrors `GET /api/v1/websites/{domain}/urls`.
 * `last_crawled_at` is epoch seconds (matching the Python shape).
 */
export const listUrls = internalAction({
  args: {
    orgSlug: v.string(),
    domain: v.string(),
    offset: v.optional(v.number()),
    limit: v.optional(v.number()),
    status: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (_ctx, args) => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    if (!(await orgHasMembership(sql, args.domain, args.orgSlug))) {
      return { found: false, urls: [], total: 0, offset: 0, has_more: false };
    }
    const website = await storeGetWebsite(sql, args.domain);
    if (!website) {
      return { found: false, urls: [], total: 0, offset: 0, has_more: false };
    }
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 100;
    const urls = await getUrlsPage(
      sql,
      args.domain,
      offset,
      limit,
      args.status,
    );
    const total = await getTotalCount(sql, args.domain, args.status);
    return {
      found: true,
      domain: args.domain,
      urls,
      total,
      offset,
      has_more: offset + limit < total,
    };
  },
});

/**
 * Update a website's scan interval. Mirrors `PATCH /api/v1/websites/{domain}`:
 * requires the caller's org to have a membership; rejects while deleting.
 */
export const updateScanInterval = internalAction({
  args: {
    orgSlug: v.string(),
    domain: v.string(),
    scanInterval: v.number(),
  },
  handler: async (_ctx, args) => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    if (!(await orgHasMembership(sql, args.domain, args.orgSlug))) {
      return { success: false, error: `Website not found: ${args.domain}` };
    }
    const website = await storeGetWebsite(sql, args.domain);
    if (!website) {
      return { success: false, error: `Website not found: ${args.domain}` };
    }
    if (website.status === 'deleting') {
      return {
        success: false,
        error: `Domain ${args.domain} is currently being deleted. Please retry later.`,
      };
    }
    await storeUpdateScanInterval(sql, args.domain, args.scanInterval);
    return {
      success: true,
      domain: args.domain,
      scan_interval: args.scanInterval,
    };
  },
});

/**
 * Deregister `domain` for `orgSlug`. Mirrors `DELETE /api/v1/websites/{domain}`:
 * removes the org's membership; when it was the last membership, marks the
 * website for deletion and runs the CASCADE DELETE best-effort inline.
 *
 * NOTE: the Python router ran `execute_delete` in a *background* task and
 * cancelled any in-flight scan first. Inside a Convex action there is no
 * long-lived process to schedule onto, so the CASCADE runs inline here
 * (best-effort; errors are surfaced in the return value). Scan cancellation is
 * a no-op in this port (no scheduler in-process).
 */
export const deregister = internalAction({
  args: {
    orgSlug: v.string(),
    domain: v.string(),
  },
  handler: async (_ctx, args) => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    const result = await beginDelete(sql, args.domain, args.orgSlug);
    if (!result.removed_membership) {
      return { success: false, error: `Website not found: ${args.domain}` };
    }
    if (!result.removed_website) {
      return {
        success: true,
        domain: args.domain,
        status: 'membership_removed',
      };
    }
    // Last membership dropped — run the CASCADE inline (best-effort).
    try {
      await executeDelete(sql, args.domain);
    } catch (err) {
      console.error(
        `[crawler] background delete failed for ${args.domain}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        success: true,
        domain: args.domain,
        status: 'deleting',
        delete_error: err instanceof Error ? err.message : String(err),
      };
    }
    return { success: true, domain: args.domain, status: 'deleting' };
  },
});

/**
 * List crawled pages for `domain` with indexing status. Mirrors
 * `GET /api/v1/pages/{domain}`. Requires the caller's org to have a membership.
 */
export const listPages = internalAction({
  args: {
    orgSlug: v.string(),
    domain: v.string(),
    offset: v.optional(v.number()),
    limit: v.optional(v.number()),
    status: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (_ctx, args) => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 100;
    if (!(await orgHasMembership(sql, args.domain, args.orgSlug))) {
      return {
        domain: args.domain,
        pages: [],
        total: 0,
        offset,
        has_more: false,
      };
    }
    const { pages, total } = await listPagesWithChunkCount(
      sql,
      args.domain,
      offset,
      limit,
      args.status,
    );
    return {
      domain: args.domain,
      pages,
      total,
      offset,
      has_more: offset + limit < total,
    };
  },
});

/**
 * Get all indexed chunks for a specific page URL. Mirrors
 * `GET /api/v1/pages/{domain}/chunks`. Requires the caller's org to have a
 * membership.
 */
export const getPageChunks = internalAction({
  args: {
    orgSlug: v.string(),
    domain: v.string(),
    url: v.string(),
  },
  handler: async (_ctx, args) => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    if (!(await orgHasMembership(sql, args.domain, args.orgSlug))) {
      return { url: args.url, domain: args.domain, chunks: [], total: 0 };
    }
    const chunks = await storeGetPageChunks(sql, args.domain, args.url);
    return {
      url: args.url,
      domain: args.domain,
      chunks,
      total: chunks.length,
    };
  },
});
