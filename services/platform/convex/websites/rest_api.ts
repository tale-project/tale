/**
 * Websites REST API handlers.
 *
 * Endpoints:
 *   GET    /api/v1/websites             — List websites (paginated)
 *   POST   /api/v1/websites             — Create website
 *   GET    /api/v1/websites/:id         — Get website by ID
 *   GET    /api/v1/websites/:id/pages   — Fetch pages
 *   PATCH  /api/v1/websites/:id         — Update website
 *   DELETE /api/v1/websites/:id         — Delete website
 *   POST   /api/v1/websites/:id/sync    — Sync statuses
 *   POST   /api/v1/websites/:id/search  — Search content
 */

import { normalizeListedUrl, siteHosts } from '../../lib/knowledge/crawl-parse';
import { internal } from '../_generated/api';
import {
  extractPathParts,
  jsonCreated,
  jsonError,
  jsonNoContent,
  jsonOk,
  parseIntParam,
  withRestAuth,
} from '../lib/rest/helpers';
import { toId } from '../lib/type_cast_helpers';
import { toWebsiteDomain } from './create_website';
import { isValidScanInterval, SCAN_INTERVAL_VALUES } from './validators';

const PREFIX = '/api/v1/websites/';

export const listWebsites = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') ?? null;
  const limit = parseIntParam(url, 'limit', 25);
  const status = url.searchParams.get('status') ?? undefined;
  const scanInterval = url.searchParams.get('scanInterval') ?? undefined;

  const result = await rc.ctx.runQuery(
    internal.websites.internal_queries.listWebsitesPaginated,
    {
      organizationId: rc.org.organizationId,
      status,
      scanInterval,
      paginationOpts: { numItems: limit, cursor },
    },
  );

  return jsonOk(result);
});

export const createWebsite = withRestAuth('rest:api', async (rc, request) => {
  const body = await request.json();

  if (!body.domain) {
    return jsonError('Missing required field: domain', 400);
  }
  if (!body.scanInterval) {
    return jsonError('Missing required field: scanInterval', 400);
  }
  if (!isValidScanInterval(body.scanInterval)) {
    return jsonError(
      `Invalid scanInterval. Allowed values: ${SCAN_INTERVAL_VALUES.join(', ')}`,
      400,
    );
  }

  const domain = toWebsiteDomain(body.domain);

  // Optional `urls` = a curated URL list on this domain instead of a
  // whole-site crawl. Mirrors `actions.createWebsite`: entries must be
  // http(s) URLs on the domain (or its www/apex sibling), and re-posting a
  // list for a domain this org already tracks MERGES the URLs.
  const rawUrls: unknown = body.urls;
  const listEntries: unknown[] = Array.isArray(rawUrls) ? rawUrls : [];
  const isList = listEntries.length > 0;
  let listedUrls: string[] | undefined;
  if (isList) {
    const hosts = siteHosts(domain);
    const normalized = new Set<string>();
    for (const entry of listEntries) {
      const candidate = typeof entry === 'string' ? entry : null;
      const url =
        candidate === null ? null : normalizeListedUrl(candidate, hosts);
      if (!url) {
        return jsonError(
          `Invalid list URL (must be http(s) on ${domain}): ${String(entry)}`,
          400,
        );
      }
      normalized.add(url);
    }
    listedUrls = [...normalized];
  }

  const existing = isList
    ? await rc.ctx.runQuery(
        internal.websites.internal_queries.getWebsiteByDomain,
        { organizationId: rc.org.organizationId, domain },
      )
    : null;

  let websiteId;
  if (existing) {
    await rc.ctx.runMutation(
      internal.websites.internal_mutations.patchWebsite,
      {
        websiteId: existing._id,
        scanInterval: body.scanInterval,
        status: 'scanning',
        callerOrgId: rc.org.organizationId,
      },
    );
    websiteId = existing._id;
  } else {
    websiteId = await rc.ctx.runMutation(
      internal.websites.internal_mutations.provisionWebsite,
      {
        organizationId: rc.org.organizationId,
        domain,
        kind: isList ? 'list' : undefined,
        title: body.title,
        description: body.description,
        scanInterval: body.scanInterval,
        status: 'scanning',
      },
    );
  }

  // Register with crawler and schedule follow-up sync.
  // Fire-and-forget via the scheduler — matches `actions.createWebsite`
  // (the Convex-action surface), so REST + Convex both return as soon
  // as the row exists rather than blocking the HTTP response on a
  // crawler round-trip. `registerAndSync` patches the row to
  // `status: 'error'` on its own failure path.
  await rc.ctx.scheduler.runAfter(
    0,
    internal.websites.internal_actions.registerAndSync,
    {
      websiteId,
      domain,
      scanInterval: body.scanInterval,
      organizationId: rc.org.organizationId,
      urls: listedUrls,
    },
  );

  return jsonCreated({ id: websiteId });
});

export const getWebsite = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id, subPath } = extractPathParts(url, PREFIX);

  if (!id) {
    return jsonError('Missing website ID', 400);
  }

  if (subPath === null) {
    const website = await rc.ctx.runQuery(
      internal.websites.internal_queries.getWebsite,
      { websiteId: toId<'websites'>(id) },
    );

    if (!website) {
      return jsonError('Website not found', 404);
    }

    if (website.organizationId !== rc.org.organizationId) {
      return jsonError('Website not found', 404);
    }

    return jsonOk(website);
  }

  if (subPath === 'pages') {
    const offset = parseIntParam(url, 'offset', 0);
    const limit = parseIntParam(url, 'limit', 100);

    const website = await rc.ctx.runQuery(
      internal.websites.internal_queries.getWebsite,
      { websiteId: toId<'websites'>(id) },
    );

    if (!website) {
      return jsonError('Website not found', 404);
    }

    if (website.organizationId !== rc.org.organizationId) {
      return jsonError('Website not found', 404);
    }

    const result = await rc.ctx.runAction(
      internal.websites.internal_actions.fetchWebsitePages,
      {
        domain: website.domain,
        organizationId: website.organizationId,
        offset,
        limit,
      },
    );

    return jsonOk(result);
  }

  return jsonError(`Unknown sub-path: ${subPath}`, 404);
});

export const patchWebsite = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id } = extractPathParts(url, PREFIX);

  if (!id) {
    return jsonError('Missing website ID', 400);
  }

  const website = await rc.ctx.runQuery(
    internal.websites.internal_queries.getWebsite,
    { websiteId: toId<'websites'>(id) },
  );

  if (!website) {
    return jsonError('Website not found', 404);
  }

  if (website.organizationId !== rc.org.organizationId) {
    return jsonError('Website not found', 404);
  }

  const body = await request.json();

  if (
    body.scanInterval !== undefined &&
    !isValidScanInterval(body.scanInterval)
  ) {
    return jsonError(
      `Invalid scanInterval. Allowed values: ${SCAN_INTERVAL_VALUES.join(', ')}`,
      400,
    );
  }

  await rc.ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
    websiteId: toId<'websites'>(id),
    domain: body.domain,
    title: body.title,
    description: body.description,
    scanInterval: body.scanInterval,
  });

  return jsonNoContent();
});

export const deleteWebsite = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id } = extractPathParts(url, PREFIX);

  if (!id) {
    return jsonError('Missing website ID', 400);
  }

  const website = await rc.ctx.runQuery(
    internal.websites.internal_queries.getWebsite,
    { websiteId: toId<'websites'>(id) },
  );

  if (!website) {
    return jsonError('Website not found', 404);
  }

  if (website.organizationId !== rc.org.organizationId) {
    return jsonError('Website not found', 404);
  }

  // Route through `deregisterAndDelete` so the crawler binding is
  // removed before the row goes — REST + the Convex `actions.deleteWebsite`
  // surface now share the same shape. Previously REST deleted the
  // row directly, leaving the crawler with a dangling registration.
  await rc.ctx.runAction(
    internal.websites.internal_actions.deregisterAndDelete,
    {
      websiteId: toId<'websites'>(id),
      organizationId: rc.org.organizationId,
    },
  );

  return jsonNoContent();
});

export const websitePostActions = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id, subPath } = extractPathParts(url, PREFIX);

    if (!id) {
      return jsonError('Missing website ID', 400);
    }

    const website = await rc.ctx.runQuery(
      internal.websites.internal_queries.getWebsite,
      { websiteId: toId<'websites'>(id) },
    );

    if (!website) {
      return jsonError('Website not found', 404);
    }

    if (website.organizationId !== rc.org.organizationId) {
      return jsonError('Website not found', 404);
    }

    if (subPath === 'sync') {
      // The :id path param scopes the sync to a single website. The
      // earlier implementation called syncWebsiteStatuses (whole-org),
      // making :id load-bearing only as an ownership tripwire — REST
      // callers got an org-wide side effect when they thought they were
      // re-syncing one row. Use the per-website action so the contract
      // matches the URL (round-3 P2 R9-P2-a).
      //
      // Fire-and-forget via `scheduler.runAfter(0, ...)` so the HTTP
      // response actually means "syncing started" (matches the
      // returned status). Previously `runAction` blocked the response
      // until the crawler round-trip finished, making the `'syncing'`
      // body misleading and tying caller latency to the crawler.
      await rc.ctx.scheduler.runAfter(
        0,
        internal.websites.internal_actions.syncSingleWebsite,
        {
          websiteId: website._id,
          domain: website.domain,
          organizationId: rc.org.organizationId,
        },
      );

      return jsonOk({ status: 'syncing' });
    }

    if (subPath === 'search') {
      const body = await request.json();

      if (!body.query) {
        return jsonError('Missing required field: query', 400);
      }

      const result = await rc.ctx.runAction(
        internal.websites.internal_actions.searchWebsiteContent,
        {
          domain: website.domain,
          query: body.query,
          organizationId: website.organizationId,
          limit: body.limit,
        },
      );

      return jsonOk(result);
    }

    return jsonError(`Unknown action: ${subPath}`, 404);
  },
);
