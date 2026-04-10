/**
 * Customers REST API handlers.
 *
 * Endpoints:
 *   GET    /api/v1/customers          — List customers (paginated)
 *   POST   /api/v1/customers          — Create customer
 *   POST   /api/v1/customers/bulk     — Bulk create customers
 *   GET    /api/v1/customers/:id      — Get customer by ID
 *   PATCH  /api/v1/customers/:id      — Update customer
 *   DELETE /api/v1/customers/:id      — Delete customer
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

const PREFIX = '/api/v1/customers/';

export const listCustomers = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor') ?? null;
    const limit = parseIntParam(url, 'limit', 25);
    const status = url.searchParams.get('status') ?? undefined;
    const source = url.searchParams.get('source') ?? undefined;
    const locale = url.searchParams.get('locale') ?? undefined;

    const result = await rc.ctx.runQuery(
      internal.customers.internal_queries.queryCustomers,
      {
        organizationId: rc.org.organizationId,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- user input validated at runtime
        status: status as 'active' | 'churned' | 'potential' | undefined,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- user input validated at runtime
        source: source as DataSource | undefined,
        locale: locale ? [locale] : undefined,
        paginationOpts: { numItems: limit, cursor },
      },
    );

    return jsonOk(result);
  },
);

export const createCustomer = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const body = await request.json();

    const result = await rc.ctx.runMutation(
      internal.customers.internal_mutations.createCustomer,
      {
        organizationId: rc.org.organizationId,
        name: body.name,
        email: body.email,
        status: body.status,
        source: body.source,
        locale: body.locale,
        address: body.address,
        externalId: body.externalId,
        metadata: body.metadata,
      },
    );

    return jsonCreated({ id: result.customerId });
  },
);

export const getCustomer = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id } = extractPathParts(url, PREFIX);

    if (!id) {
      return jsonError('Missing customer ID', 400);
    }

    const customer = await rc.ctx.runQuery(
      internal.customers.internal_queries.getCustomerById,
      { customerId: toId<'customers'>(id) },
    );

    if (!customer) {
      return jsonError('Customer not found', 404);
    }

    return jsonOk(customer);
  },
);

export const patchCustomer = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id } = extractPathParts(url, PREFIX);

    if (!id) {
      return jsonError('Missing customer ID', 400);
    }

    const body = await request.json();

    const updated = await rc.ctx.runMutation(
      internal.customers.internal_mutations.updateCustomer,
      {
        customerId: toId<'customers'>(id),
        name: body.name,
        email: body.email,
        externalId: body.externalId,
        status: body.status,
        source: body.source,
        locale: body.locale,
        address: body.address,
        metadata: body.metadata,
      },
    );

    if (!updated) {
      return jsonError('Customer not found', 404);
    }

    return jsonOk(updated);
  },
);

export const deleteCustomer = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id } = extractPathParts(url, PREFIX);

    if (!id) {
      return jsonError('Missing customer ID', 400);
    }

    await rc.ctx.runMutation(
      internal.customers.internal_mutations.deleteCustomer,
      { customerId: toId<'customers'>(id) },
    );

    return jsonNoContent();
  },
);

export const customerPostActions = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id: subPath } = extractPathParts(url, PREFIX);

    if (subPath === 'bulk') {
      const body = await request.json();

      if (!Array.isArray(body.customers)) {
        return jsonError('Missing or invalid "customers" array', 400);
      }

      const result = await rc.ctx.runMutation(
        internal.customers.internal_mutations.bulkCreateCustomers,
        {
          organizationId: rc.org.organizationId,
          customers: body.customers,
        },
      );

      return jsonCreated(result);
    }

    return jsonError(`Unknown action: ${subPath}`, 404);
  },
);
