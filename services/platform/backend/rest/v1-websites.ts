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
  type WebsiteRow,
} from '../domains/websites/service.ts';
import { addJobInTx } from '../jobs/enqueue.ts';
import { resolveOrgSlug } from '../lib/org-config.ts';
import type { RestEnv } from './shared.ts';

/**
 * The /websites REST family (the 0.4 `websites/rest_api.ts` contract):
 * list/create/get/patch/delete, GET :id/pages, POST :id/sync (per-site,
 * fire-and-forget), POST :id/search. Cross-org rows answer 404 like 0.4.
 */

function isRecordObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
      limit: Number(c.req.query('limit') ?? '25') || 25,
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
    const domain = new URL(
      body.domain.startsWith('http') ? body.domain : `https://${body.domain}`,
    ).hostname;

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
      let websiteId: string;
      const existing = isList
        ? await getWebsiteByDomain(deps.sql, organizationId, domain)
        : null;
      if (existing) {
        await patchWebsite(deps.sql, {
          websiteId: existing.id,
          callerOrgId: organizationId,
          scanInterval: body.scanInterval,
          status: 'scanning',
        });
        websiteId = existing.id;
      } else {
        websiteId = await createWebsiteRow(deps.sql, {
          organizationId,
          domain,
          ...(isList ? { kind: 'list' as const } : {}),
          ...(typeof body.title === 'string' ? { title: body.title } : {}),
          ...(typeof body.description === 'string'
            ? { description: body.description }
            : {}),
          scanInterval: body.scanInterval,
          status: 'scanning',
        });
      }
      await addJobInTx(deps.sql, 'websites.register', {
        websiteId,
        domain,
        scanInterval: body.scanInterval,
        organizationId,
        ...(listedUrls !== undefined ? { urls: listedUrls } : {}),
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
    return c.json(
      await fetchWebsitePages(deps.sql, website, {
        offset: Number(c.req.query('offset') ?? '0') || 0,
        limit: Number(c.req.query('limit') ?? '100') || 100,
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
    try {
      await patchWebsite(deps.sql, {
        websiteId: website.id,
        callerOrgId: c.get('organizationId'),
        ...(typeof body.domain === 'string' ? { domain: body.domain } : {}),
        ...(typeof body.title === 'string' ? { title: body.title } : {}),
        ...(typeof body.description === 'string'
          ? { description: body.description }
          : {}),
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
        ...(typeof body.limit === 'number' ? { limit: body.limit } : {}),
      }),
    );
  });

  return app;
}
