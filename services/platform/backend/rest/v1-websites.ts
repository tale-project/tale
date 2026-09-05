import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';

import {
  isValidScanInterval,
  SCAN_INTERVAL_VALUES,
} from '../core/websites/types.ts';
import {
  createWebsiteRow,
  deregisterAndDeleteWebsite,
  fetchWebsitePages,
  getWebsite,
  getWebsiteByDomain,
  listWebsites,
  normalizeListUrls,
  patchWebsite,
  searchWebsiteContent,
  WebsiteError,
  websiteDomainImmutableError,
  type WebsiteRow,
} from '../domains/websites/service.ts';
import { addJobInTx } from '../jobs/enqueue.ts';
import { resolveOrgSlug } from '../lib/org-config.ts';
import { pageLimit, type RestEnv } from './shared.ts';

/**
 * The /websites REST family (the 0.4 `websites/rest_api.ts` contract):
 * list/create/get/patch/delete, GET :id/pages, POST :id/sync (per-site,
 * fire-and-forget), POST :id/search. Cross-org rows answer 404 like 0.4.
 */

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;

function isRecordObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** An optional string field bounded to `max` characters — absent when the
 * body does not carry a string; `null` when it carries one over the cap. */
function boundedString(value: unknown, max: number): string | null | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > max ? null : value;
}

/**
 * The hostname a `domain` field names, or null when it names none: the
 * same `https://` default the domain applies (`toWebsiteDomain`), but a
 * value `new URL()` refuses (`https://`, `a b`, `::`) is a client mistake
 * for the 400 envelope, not a TypeError for the 500 handler.
 */
function parseWebsiteDomain(raw: string): string | null {
  if (raw.length > 253) return null;
  try {
    const { hostname } = new URL(
      raw.startsWith('http://') || raw.startsWith('https://')
        ? raw
        : `https://${raw}`,
    );
    return hostname === '' ? null : hostname;
  } catch (error) {
    console.warn(
      '[websites-rest] unparseable domain:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

function restJsonError(
  c: Context<RestEnv>,
  message: string,
  status: 400 | 404 | 409,
): Response {
  return c.json({ error: message }, status);
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

  app.get('/websites', async (c) => {
    const result = await listWebsites(deps.sql, c.get('organizationId'), {
      ...(c.req.query('status') !== undefined
        ? { status: c.req.query('status') ?? '' }
        : {}),
      ...(c.req.query('scanInterval') !== undefined
        ? { scanInterval: c.req.query('scanInterval') ?? '' }
        : {}),
      cursor: c.req.query('cursor') ?? null,
      limit: pageLimit(c.req.query('limit'), { fallback: 25, max: 200 }),
    });
    return c.json(result);
  });

  app.post('/websites', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecordObj(body)) return restJsonError(c, 'Invalid JSON body', 400);
    if (typeof body.domain !== 'string' || body.domain.length === 0) {
      return restJsonError(c, 'Missing required field: domain', 400);
    }
    if (typeof body.scanInterval !== 'string' || body.scanInterval === '') {
      return restJsonError(c, 'Missing required field: scanInterval', 400);
    }
    if (!isValidScanInterval(body.scanInterval)) {
      return restJsonError(
        c,
        `Invalid scanInterval. Allowed values: ${SCAN_INTERVAL_VALUES.join(', ')}`,
        400,
      );
    }
    // Bound to a local: the narrowing does not survive into the
    // transaction closure below.
    const scanInterval = body.scanInterval;
    const domain = parseWebsiteDomain(body.domain);
    if (domain === null) return restJsonError(c, 'Invalid domain', 400);
    const title = boundedString(body.title, MAX_TITLE);
    const description = boundedString(body.description, MAX_DESCRIPTION);
    if (title === null || description === null) {
      return restJsonError(
        c,
        `title (≤${MAX_TITLE}) or description (≤${MAX_DESCRIPTION}) is too long`,
        400,
      );
    }

    const rawUrls: unknown = body.urls;
    const listEntries = Array.isArray(rawUrls) ? rawUrls : [];
    const isList = listEntries.length > 0;
    let listedUrls: string[] | undefined;
    if (isList) {
      const candidates: string[] = [];
      for (const entry of listEntries) {
        if (typeof entry !== 'string') {
          return restJsonError(
            c,
            `Invalid list URL (must be http(s) on ${domain}): ${String(entry)}`,
            400,
          );
        }
        candidates.push(entry);
      }
      try {
        listedUrls = normalizeListUrls(domain, candidates);
      } catch (error) {
        if (error instanceof WebsiteError) {
          return restJsonError(c, error.message, 400);
        }
        throw error;
      }
    }

    try {
      const organizationId = c.get('organizationId');
      // Row write + register job in ONE transaction (the app door's shape):
      // a 'scanning' row without its job strands until the stuck-scan
      // window, then scans a domain the corpus never registered.
      const websiteId = await deps.sql.begin(async (tx) => {
        let id: string;
        const existing = isList
          ? await getWebsiteByDomain(tx, organizationId, domain)
          : null;
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
        return id;
      });
      return c.json({ id: websiteId }, 201);
    } catch (error) {
      if (error instanceof WebsiteError) {
        return c.json({ error: error.message, code: error.code }, error.status);
      }
      throw error;
    }
  });

  app.get('/websites/:id', async (c) => {
    const website = await loadOwned(c.get('organizationId'), c.req.param('id'));
    if (!website) return restJsonError(c, 'Website not found', 404);
    return c.json(website);
  });

  app.get('/websites/:id/pages', async (c) => {
    const website = await loadOwned(c.get('organizationId'), c.req.param('id'));
    if (!website) return restJsonError(c, 'Website not found', 404);
    // Whole, non-negative rows only: the inventory query ships these as
    // `OFFSET`/`LIMIT`, where `-1` and `2.5` are Postgres errors and an
    // unbounded limit walks the whole per-domain corpus.
    const offset = Math.max(0, Math.trunc(Number(c.req.query('offset')) || 0));
    return c.json(
      await fetchWebsitePages(deps.sql, website, {
        offset,
        limit: pageLimit(c.req.query('limit'), { fallback: 100, max: 500 }),
      }),
    );
  });

  app.patch('/websites/:id', async (c) => {
    const website = await loadOwned(c.get('organizationId'), c.req.param('id'));
    if (!website) return restJsonError(c, 'Website not found', 404);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecordObj(body)) return restJsonError(c, 'Invalid JSON body', 400);
    if (
      body.scanInterval !== undefined &&
      !isValidScanInterval(body.scanInterval)
    ) {
      return restJsonError(
        c,
        `Invalid scanInterval. Allowed values: ${SCAN_INTERVAL_VALUES.join(', ')}`,
        400,
      );
    }
    if (body.domain !== undefined) {
      const refusal = websiteDomainImmutableError();
      return c.json({ error: refusal.message, code: refusal.code }, 400);
    }
    const title = boundedString(body.title, MAX_TITLE);
    const description = boundedString(body.description, MAX_DESCRIPTION);
    if (title === null || description === null) {
      return restJsonError(
        c,
        `title (≤${MAX_TITLE}) or description (≤${MAX_DESCRIPTION}) is too long`,
        400,
      );
    }
    try {
      await patchWebsite(deps.sql, {
        websiteId: website.id,
        callerOrgId: c.get('organizationId'),
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(typeof body.scanInterval === 'string'
          ? { scanInterval: body.scanInterval }
          : {}),
      });
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof WebsiteError) {
        return c.json({ error: error.message, code: error.code }, error.status);
      }
      throw error;
    }
  });

  app.delete('/websites/:id', async (c) => {
    const website = await loadOwned(c.get('organizationId'), c.req.param('id'));
    if (!website) return restJsonError(c, 'Website not found', 404);
    await deregisterAndDeleteWebsite(deps.sql, website);
    return c.body(null, 204);
  });

  app.post('/websites/:id/sync', async (c) => {
    const website = await loadOwned(c.get('organizationId'), c.req.param('id'));
    if (!website) return restJsonError(c, 'Website not found', 404);
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
    if (!website) return restJsonError(c, 'Website not found', 404);
    const body: unknown = await c.req.json().catch(() => null);
    if (
      !isRecordObj(body) ||
      typeof body.query !== 'string' ||
      body.query.length === 0
    ) {
      return restJsonError(c, 'Missing required field: query', 400);
    }
    return c.json(
      await searchWebsiteContent(deps.sql, website, {
        query: body.query,
        ...(typeof body.limit === 'number'
          ? { limit: pageLimit(body.limit, { fallback: 10, max: 100 }) }
          : {}),
      }),
    );
  });

  return app;
}
