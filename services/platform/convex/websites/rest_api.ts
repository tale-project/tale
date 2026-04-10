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

  const domain = toWebsiteDomain(body.domain);

  const websiteId = await rc.ctx.runMutation(
    internal.websites.internal_mutations.provisionWebsite,
    {
      organizationId: rc.org.organizationId,
      domain,
      title: body.title,
      description: body.description,
      scanInterval: body.scanInterval,
      status: 'scanning',
    },
  );

  // Register with crawler and schedule follow-up sync
  await rc.ctx.runAction(internal.websites.internal_actions.registerAndSync, {
    websiteId,
    domain,
    scanInterval: body.scanInterval,
  });

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

  await rc.ctx.runMutation(internal.websites.internal_mutations.deleteWebsite, {
    websiteId: toId<'websites'>(id),
  });

  return jsonNoContent();
});

export const websiteSubActions = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id, subPath } = extractPathParts(url, PREFIX);

    if (!id) {
      return jsonError('Missing website ID', 400);
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
          offset,
          limit,
        },
      );

      return jsonOk(result);
    }

    return jsonError(`Unknown sub-path: ${subPath}`, 404);
  },
);

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
      await rc.ctx.runAction(
        internal.websites.internal_actions.syncWebsiteStatuses,
        { organizationId: rc.org.organizationId },
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
          limit: body.limit,
        },
      );

      return jsonOk(result);
    }

    return jsonError(`Unknown action: ${subPath}`, 404);
  },
);
