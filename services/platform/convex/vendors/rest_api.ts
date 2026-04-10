/**
 * Vendors REST API handlers.
 *
 * Endpoints:
 *   GET    /api/v1/vendors          — List vendors (paginated)
 *   POST   /api/v1/vendors          — Create single vendor
 *   POST   /api/v1/vendors/bulk     — Bulk create vendors
 *   GET    /api/v1/vendors/:id      — Get vendor by ID
 *   PATCH  /api/v1/vendors/:id      — Update vendor
 *   DELETE /api/v1/vendors/:id      — Delete vendor
 */

import type { DataSource } from '../../lib/shared/schemas/common';
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

const PREFIX = '/api/v1/vendors/';

export const listVendors = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') ?? null;
  const limit = parseIntParam(url, 'limit', 25);
  const source = url.searchParams.get('source') ?? undefined;
  const locale = url.searchParams.get('locale') ?? undefined;

  const result = await rc.ctx.runQuery(
    internal.vendors.internal_queries.queryVendors,
    {
      organizationId: rc.org.organizationId,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- user input validated at runtime
      source: source as DataSource | undefined,
      locale,
      paginationOpts: { numItems: limit, cursor },
    },
  );

  return jsonOk(result);
});

export const createVendor = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const body = await request.json();

    const vendorId = await rc.ctx.runMutation(
      internal.vendors.internal_mutations.createVendor,
      {
        organizationId: rc.org.organizationId,
        name: body.name,
        email: body.email,
        phone: body.phone,
        externalId: body.externalId,
        source: body.source,
        locale: body.locale,
        address: body.address,
        tags: body.tags,
        metadata: body.metadata,
        notes: body.notes,
      },
    );

    return jsonCreated({ id: vendorId });
  },
);

export const bulkCreateVendors = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const body = await request.json();

    if (!Array.isArray(body.vendors)) {
      return jsonError('Missing or invalid "vendors" array', 400);
    }

    const result = await rc.ctx.runMutation(
      internal.vendors.internal_mutations.bulkCreateVendors,
      {
        organizationId: rc.org.organizationId,
        vendors: body.vendors,
      },
    );

    return jsonOk(result);
  },
);

export const getVendor = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id } = extractPathParts(url, PREFIX);

  if (!id) {
    return jsonError('Missing vendor ID', 400);
  }

  const vendor = await rc.ctx.runQuery(
    internal.vendors.internal_queries.getVendor,
    { vendorId: toId<'vendors'>(id) },
  );

  if (!vendor) {
    return jsonError('Vendor not found', 404);
  }

  return jsonOk(vendor);
});

export const patchVendor = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id } = extractPathParts(url, PREFIX);

  if (!id) {
    return jsonError('Missing vendor ID', 400);
  }

  const body = await request.json();

  await rc.ctx.runMutation(internal.vendors.internal_mutations.updateVendor, {
    vendorId: toId<'vendors'>(id),
    name: body.name,
    email: body.email,
    phone: body.phone,
    externalId: body.externalId,
    source: body.source,
    locale: body.locale,
    address: body.address,
    tags: body.tags,
    metadata: body.metadata,
    notes: body.notes,
  });

  return jsonNoContent();
});

export const deleteVendor = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id } = extractPathParts(url, PREFIX);

    if (!id) {
      return jsonError('Missing vendor ID', 400);
    }

    await rc.ctx.runMutation(internal.vendors.internal_mutations.deleteVendor, {
      vendorId: toId<'vendors'>(id),
    });

    return jsonNoContent();
  },
);
