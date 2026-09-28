import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { isRecord } from '../../../lib/utils/type-utils.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import {
  countWebsites,
  deregisterAndDeleteWebsite,
  fetchPageChunks,
  fetchWebsitePages,
  getWebsite,
  listWebsites,
  needsStatusSync,
  patchWebsite,
  registerWebsite,
  resumeScanning,
  searchWebsiteContent,
  syncScanIntervalToCorpus,
  syncWebsiteStatuses,
  WebsiteError,
  websiteDomainImmutableError,
  type WebsiteRow,
} from './service.ts';

/**
 * /api/app/websites — the tracked-websites surface (the 0.4
 * `websites/actions` + queries). Org-member gated like 0.4; a "create"
 * answers as soon as the row exists and the crawler registration runs as
 * the `websites.register` job (the 0.4 fire-and-forget scheduler shape).
 */

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof WebsiteError) {
    return c.json(
      {
        error: error.code,
        message: error.message,
        ...(error.data === undefined ? {} : { data: error.data }),
      },
      error.status,
    );
  }
  throw error;
}

/** Load + org-guard one row ("not found" for both no-row and wrong-org —
 * cross-org callers must not be able to probe existence). */
async function loadOwnedWebsite(
  sql: Sql,
  c: Context<OrgEnv>,
): Promise<WebsiteRow> {
  const websiteId = c.req.param('websiteId') ?? '';
  const website = await getWebsite(sql, websiteId);
  if (!website || website.organizationId !== c.get('orgId')) {
    throw new WebsiteError('WEBSITE_NOT_FOUND', 'Website not found', 404);
  }
  return website;
}

const createBodySchema = z.object({
  domain: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  scanInterval: z.string().min(1),
  urls: z.array(z.string()).max(10_000).optional(),
});

const updateBodySchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  scanInterval: z.string().min(1).optional(),
});

export function createWebsiteRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.get('/', async (c) => {
    const result = await listWebsites(deps.sql, c.get('orgId'), {
      ...(c.req.query('status') !== undefined
        ? { status: c.req.query('status') ?? '' }
        : {}),
      ...(c.req.query('scanInterval') !== undefined
        ? { scanInterval: c.req.query('scanInterval') ?? '' }
        : {}),
      ...(c.req.query('search') !== undefined
        ? { searchTerm: c.req.query('search') ?? '' }
        : {}),
      cursor: c.req.query('cursor') ?? null,
      limit: Number(c.req.query('limit') ?? '25') || 25,
    });
    return c.json(result);
  });

  app.get('/count', async (c) => {
    return c.json({ count: await countWebsites(deps.sql, c.get('orgId')) });
  });

  app.post('/', async (c) => {
    const body = createBodySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      // The one registration choreography, shared with the REST door
      // (`registerWebsite`): a same-org re-post of a LIST merges (the
      // corpus upsert adds the new URLs); a whole-site crawl, a bare
      // duplicate or the www/apex sibling is the 409 naming the row.
      const outcome = await registerWebsite(deps.sql, {
        organizationId: c.get('orgId'),
        domain: body.data.domain,
        scanInterval: body.data.scanInterval,
        ...(body.data.title !== undefined ? { title: body.data.title } : {}),
        ...(body.data.description !== undefined
          ? { description: body.data.description }
          : {}),
        ...(body.data.urls !== undefined ? { urls: body.data.urls } : {}),
      });
      return c.json({ id: outcome.id }, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Static routes register BEFORE the :websiteId params (Hono trie order).
  app.post('/sync-statuses', async (c) => {
    await syncWebsiteStatuses(deps.sql, c.get('orgId'));
    return c.json({ ok: true });
  });

  app.get('/:websiteId', async (c) => {
    try {
      return c.json(await loadOwnedWebsite(deps.sql, c));
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.patch('/:websiteId', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const body = updateBodySchema.safeParse(raw);
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      if (isRecord(raw) && raw.domain !== undefined) {
        throw websiteDomainImmutableError();
      }
      const website = await loadOwnedWebsite(deps.sql, c);
      if (
        body.data.scanInterval !== undefined &&
        body.data.scanInterval !== website.scanInterval
      ) {
        await syncScanIntervalToCorpus(deps.sql, {
          organizationId: c.get('orgId'),
          domain: website.domain,
          scanInterval: body.data.scanInterval,
        });
      }
      const updated = await patchWebsite(deps.sql, {
        websiteId: website.id,
        callerOrgId: c.get('orgId'),
        ...(body.data.title !== undefined ? { title: body.data.title } : {}),
        ...(body.data.description !== undefined
          ? { description: body.data.description }
          : {}),
        ...(body.data.scanInterval !== undefined
          ? { scanInterval: body.data.scanInterval }
          : {}),
      });
      return c.json(updated);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:websiteId', async (c) => {
    try {
      const website = await loadOwnedWebsite(deps.sql, c);
      await deregisterAndDeleteWebsite(deps.sql, website);
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:websiteId/resume', async (c) => {
    try {
      const website = await loadOwnedWebsite(deps.sql, c);
      await resumeScanning(deps.sql, website);
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:websiteId/pages', async (c) => {
    try {
      const website = await loadOwnedWebsite(deps.sql, c);
      // The 0.4 fetchPages debounce: at most one corpus→row sync per hour
      // per site, no matter how often the pages tab polls.
      if (needsStatusSync(website)) {
        const orgSlug = await resolveOrgSlug(deps.sql, c.get('orgId'));
        if (orgSlug) {
          await addJobInTx(
            deps.sql,
            'websites.row_sync',
            { orgSlug, domain: website.domain },
            {
              singletonKey: `websites-row-sync-${orgSlug}-${website.domain}`,
            },
          );
        }
      }
      return c.json(
        await fetchWebsitePages(deps.sql, website, {
          offset: Number(c.req.query('offset') ?? '0') || 0,
          limit: Number(c.req.query('limit') ?? '100') || 100,
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:websiteId/chunks', async (c) => {
    const url = c.req.query('url');
    if (!url) return c.json({ error: 'url is required' }, 400);
    try {
      const website = await loadOwnedWebsite(deps.sql, c);
      return c.json(await fetchPageChunks(deps.sql, website, url));
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:websiteId/search', async (c) => {
    const body = z
      .object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      const website = await loadOwnedWebsite(deps.sql, c);
      return c.json(
        await searchWebsiteContent(deps.sql, website, {
          query: body.data.query,
          ...(body.data.limit !== undefined ? { limit: body.data.limit } : {}),
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
