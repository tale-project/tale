import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { SCAN_INTERVAL_VALUES } from '../core/websites/types.ts';
import {
  crawlableDomain,
  createWebsiteRow,
  deregisterAndDeleteWebsite,
  fetchWebsitePages,
  getWebsite,
  getWebsiteByDomain,
  listWebsites,
  normalizeListUrls,
  patchWebsite,
  searchWebsiteContent,
  websiteDomainImmutableError,
  type WebsiteRow,
} from '../domains/websites/service.ts';
import { addJobInTx } from '../jobs/enqueue.ts';
import { resolveOrgSlug } from '../lib/org-config.ts';
import {
  domainErrorResponse,
  formatKeysetCursor,
  mintCursor,
  noQuery,
  notFound,
  PAGE_QUERY,
  pageLimit,
  parseBody,
  queryFilter,
  readKeysetCursor,
  readPageLimit,
  readQuery,
  type RestEnv,
} from './shared.ts';

/**
 * The /websites REST family: list/create/get/patch/delete, GET :id/pages,
 * POST :id/sync (per-site, fire-and-forget), POST :id/search. Cross-org
 * rows answer 404. Bodies are schema-checked and refused with the door's
 * `INVALID_BODY` envelope (unknown keys included); domain refusals carry
 * their code. The crawler corpus keeps its own snake_case / ISO-timestamp
 * rows — the page and search views below translate them into the
 * camelCase, epoch-millisecond vocabulary every other family speaks.
 */

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
const MAX_LIST_URLS = 10_000;
const MAX_URL = 2048;

const websiteInput = z
  .object({
    domain: z.string().min(1).max(MAX_URL),
    scanInterval: z.enum(SCAN_INTERVAL_VALUES),
    title: z.string().max(MAX_TITLE).optional(),
    description: z.string().max(MAX_DESCRIPTION).optional(),
    urls: z.array(z.string().min(1).max(MAX_URL)).max(MAX_LIST_URLS).optional(),
  })
  .strict();

/** `domain` is accepted by the schema so a CHANGED value answers the
 * documented `WEBSITE_DOMAIN_IMMUTABLE`, not an unknown-key refusal — and
 * a value equal to the stored one passes, since a PUT-style client echoes
 * the resource it read. */
const websitePatch = z
  .object({
    title: z.string().max(MAX_TITLE).optional(),
    description: z.string().max(MAX_DESCRIPTION).optional(),
    scanInterval: z.enum(SCAN_INTERVAL_VALUES).optional(),
    domain: z.string().optional(),
  })
  .strict();

const searchBody = z
  .object({
    query: z.string().min(1).max(1000),
    limit: z.number().optional(),
  })
  .strict();

function isRecordObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The corpus stamps ISO-8601 text; the wire speaks epoch milliseconds. */
function epochMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value === '') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** One crawled page (`CrawlerPage`) in the door's vocabulary. */
function websitePageView(row: unknown): Record<string, unknown> {
  const page = isRecordObj(row) ? row : {};
  const chunksCount = Number(page.chunks_count ?? 0);
  return {
    url: nullableString(page.url) ?? '',
    title: nullableString(page.title),
    wordCount: Number(page.word_count ?? 0),
    status: nullableString(page.status) ?? 'unknown',
    contentHash: nullableString(page.content_hash),
    lastCrawledAt: epochMs(page.last_crawled_at),
    discoveredAt: epochMs(page.discovered_at),
    chunksCount,
    indexed: page.indexed === true || chunksCount > 0,
  };
}

/** One search match (`CrawlerSearchResult`) in the door's vocabulary: the
 * chunk's core text when the reindex has filled it, else the raw chunk. */
function websiteSearchHitView(row: unknown): Record<string, unknown> {
  const hit = isRecordObj(row) ? row : {};
  const core = nullableString(hit.core_content);
  return {
    url: nullableString(hit.url) ?? '',
    title: nullableString(hit.title),
    content:
      core !== null && core !== ''
        ? core
        : (nullableString(hit.chunk_content) ?? ''),
    chunkIndex: Number(hit.chunk_index ?? 0),
    score: Number(hit.score ?? 0),
  };
}

export function createRestWebsiteRoutes(deps: { sql: Sql }): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  const loadOwned = async (
    organizationId: string,
    id: string,
  ): Promise<WebsiteRow | null> => {
    const website = await getWebsite(deps.sql, id);
    if (!website || website.organizationId !== organizationId) return null;
    return website;
  };

  const websiteNotFound = (c: Parameters<typeof notFound>[0]) =>
    notFound(c, 'Website not found', 'WEBSITE_NOT_FOUND');

  app.get('/websites', async (c) => {
    const query = readQuery(c, {
      ...PAGE_QUERY,
      status: queryFilter(32).optional(),
      scanInterval: queryFilter(16).optional(),
    });
    if (query instanceof Response) return query;
    // The service decodes the `<createdAt>:<id>` position itself; the
    // signature is checked here so a token this list never answered is
    // refused, never read as page one.
    const cursor = readKeysetCursor(c, 'websites');
    if (cursor instanceof Response) return cursor;
    const limit = readPageLimit(c, { fallback: 25, max: 200 });
    if (limit instanceof Response) return limit;
    const result = await listWebsites(deps.sql, c.get('organizationId'), {
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.scanInterval !== undefined
        ? { scanInterval: query.scanInterval }
        : {}),
      cursor: cursor === null ? null : formatKeysetCursor(cursor.at, cursor.id),
      limit,
    });
    return c.json({
      ...result,
      continueCursor:
        result.continueCursor === ''
          ? ''
          : mintCursor(c, 'websites', result.continueCursor),
    });
  });

  /** Register a domain (201) — or, with `urls`, extend an existing list
   * registration of the same domain (200, the existing id). */
  app.post('/websites', async (c) => {
    const body = await parseBody(c, websiteInput);
    if (body instanceof Response) return body;
    const { scanInterval, title, description } = body;
    try {
      const domain = crawlableDomain(body.domain);
      const listEntries = body.urls ?? [];
      const isList = listEntries.length > 0;
      const listedUrls = isList
        ? normalizeListUrls(domain, listEntries)
        : undefined;
      const organizationId = c.get('organizationId');
      // Row write + register job in ONE transaction (the app door's shape):
      // a 'scanning' row without its job strands until the stuck-scan
      // window, then scans a domain the corpus never registered.
      const outcome = await deps.sql.begin(async (tx) => {
        const existing = isList
          ? await getWebsiteByDomain(tx, organizationId, domain)
          : null;
        let id: string;
        if (existing) {
          await patchWebsite(tx, {
            websiteId: existing.id,
            callerOrgId: organizationId,
            scanInterval,
            status: 'scanning',
          });
          id = existing.id;
        } else {
          id = await createWebsiteRow(tx, {
            organizationId,
            domain,
            ...(isList ? { kind: 'list' as const } : {}),
            ...(title !== undefined ? { title } : {}),
            ...(description !== undefined ? { description } : {}),
            scanInterval,
            status: 'scanning',
          });
        }
        await addJobInTx(tx, 'websites.register', {
          websiteId: id,
          domain,
          scanInterval,
          organizationId,
          ...(listedUrls !== undefined ? { urls: listedUrls } : {}),
        });
        return { id, merged: existing !== null };
      });
      return c.json({ id: outcome.id }, outcome.merged ? 200 : 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/websites/:id', noQuery, async (c) => {
    const website = await loadOwned(c.get('organizationId'), c.req.param('id'));
    if (!website) return websiteNotFound(c);
    return c.json(website);
  });

  app.get('/websites/:id/pages', async (c) => {
    // Whole, non-negative rows only: the inventory query ships these as
    // `OFFSET`/`LIMIT`, where `-1` and `2.5` are Postgres errors and an
    // unbounded limit walks the whole per-domain corpus. `offset=abc` used
    // to read as 0 with nothing telling the caller.
    const query = readQuery(c, {
      limit: z.string().optional(),
      offset: z
        .string()
        .regex(/^\d{1,15}$/, 'must be a whole number of rows to skip')
        .optional(),
    });
    if (query instanceof Response) return query;
    const website = await loadOwned(c.get('organizationId'), c.req.param('id'));
    if (!website) return websiteNotFound(c);
    const offset = Number(query.offset ?? 0);
    const limit = readPageLimit(c, { fallback: 100, max: 500 });
    if (limit instanceof Response) return limit;
    const result = await fetchWebsitePages(deps.sql, website, {
      offset,
      limit,
    });
    return c.json({ ...result, pages: result.pages.map(websitePageView) });
  });

  /** Partial update. Answers 200 with the website as it now stands (the
   * GET view) — a 204 left a client that wanted the new `updatedAt` or
   * `status` with a second round trip. The domain is immutable: a body
   * carrying the stored value is a client echoing the resource and passes;
   * any other value is refused before the row is touched. */
  app.patch('/websites/:id', async (c) => {
    const website = await loadOwned(c.get('organizationId'), c.req.param('id'));
    if (!website) return websiteNotFound(c);
    const body = await parseBody(c, websitePatch);
    if (body instanceof Response) return body;
    if (
      body.domain !== undefined &&
      body.domain.trim().toLowerCase() !== website.domain
    ) {
      return domainErrorResponse(c, websiteDomainImmutableError());
    }
    const { title, description, scanInterval } = body;
    try {
      const updated = await patchWebsite(deps.sql, {
        websiteId: website.id,
        callerOrgId: c.get('organizationId'),
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(scanInterval !== undefined ? { scanInterval } : {}),
      });
      // The row went away between the load and the write.
      if (updated === null) return websiteNotFound(c);
      return c.json(updated);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.delete('/websites/:id', async (c) => {
    const website = await loadOwned(c.get('organizationId'), c.req.param('id'));
    if (!website) return websiteNotFound(c);
    await deregisterAndDeleteWebsite(deps.sql, website);
    return c.body(null, 204);
  });

  app.post('/websites/:id/sync', async (c) => {
    const website = await loadOwned(c.get('organizationId'), c.req.param('id'));
    if (!website) return websiteNotFound(c);
    // Fire-and-forget so the response actually means "syncing started"
    // (the 0.4 round-3 fix) — the job is the per-site corpus→row push.
    const orgSlug = await resolveOrgSlug(deps.sql, c.get('organizationId'));
    if (orgSlug) {
      await addJobInTx(
        deps.sql,
        'websites.row_sync',
        { orgSlug, domain: website.domain },
        { singletonKey: `websites-row-sync-${orgSlug}-${website.domain}` },
      );
    }
    return c.json({ status: 'syncing' });
  });

  app.post('/websites/:id/search', async (c) => {
    const website = await loadOwned(c.get('organizationId'), c.req.param('id'));
    if (!website) return websiteNotFound(c);
    const body = await parseBody(c, searchBody);
    if (body instanceof Response) return body;
    const result = await searchWebsiteContent(deps.sql, website, {
      query: body.query,
      ...(body.limit !== undefined
        ? { limit: pageLimit(body.limit, { fallback: 10, max: 100 }) }
        : {}),
    });
    return c.json({
      ...result,
      results: result.results.map(websiteSearchHitView),
    });
  });

  return app;
}
