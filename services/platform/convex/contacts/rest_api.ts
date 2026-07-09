/**
 * Contacts REST API handlers.
 *
 * Endpoints:
 *   GET    /api/v1/contacts          — List contacts (paginated)
 *   POST   /api/v1/contacts          — Create contact
 *   POST   /api/v1/contacts/bulk     — Bulk create contacts
 *   GET    /api/v1/contacts/:id      — Get contact by ID
 *   PATCH  /api/v1/contacts/:id      — Update contact
 *   DELETE /api/v1/contacts/:id      — Delete contact
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

const PREFIX = '/api/v1/contacts/';

export const listContacts = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') ?? null;
  const limit = parseIntParam(url, 'limit', 25);
  const source = url.searchParams.get('source') ?? undefined;
  const locale = url.searchParams.get('locale') ?? undefined;

  const result = await rc.ctx.runQuery(
    internal.contacts.internal_queries.queryContacts,
    {
      organizationId: rc.org.organizationId,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- user input validated at runtime
      source: source as DataSource | undefined,
      locale: locale ? [locale] : undefined,
      paginationOpts: { numItems: limit, cursor },
    },
  );

  return jsonOk(result);
});

export const createContact = withRestAuth('rest:api', async (rc, request) => {
  const body = await request.json();

  const result = await rc.ctx.runMutation(
    internal.contacts.internal_mutations.createContact,
    {
      organizationId: rc.org.organizationId,
      name: body.name,
      email: body.email,
      phone: body.phone,
      source: body.source,
      locale: body.locale,
      address: body.address,
      externalId: body.externalId,
      tags: body.tags,
      metadata: body.metadata,
      notes: body.notes,
    },
  );

  return jsonCreated({ id: result.contactId });
});

export const getContact = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id } = extractPathParts(url, PREFIX);

  if (!id) {
    return jsonError('Missing contact ID', 400);
  }

  const contact = await rc.ctx.runQuery(
    internal.contacts.internal_queries.getContactById,
    {
      contactId: toId<'contacts'>(id),
      callerOrgId: rc.org.organizationId,
    },
  );

  if (!contact) {
    return jsonError('Contact not found', 404);
  }

  return jsonOk(contact);
});

export const patchContact = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id } = extractPathParts(url, PREFIX);

  if (!id) {
    return jsonError('Missing contact ID', 400);
  }

  const body = await request.json();

  const updated = await rc.ctx.runMutation(
    internal.contacts.internal_mutations.updateContact,
    {
      contactId: toId<'contacts'>(id),
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
      callerOrgId: rc.org.organizationId,
    },
  );

  if (!updated) {
    return jsonError('Contact not found', 404);
  }

  return jsonOk(updated);
});

export const deleteContact = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id } = extractPathParts(url, PREFIX);

  if (!id) {
    return jsonError('Missing contact ID', 400);
  }

  await rc.ctx.runMutation(internal.contacts.internal_mutations.deleteContact, {
    contactId: toId<'contacts'>(id),
    callerOrgId: rc.org.organizationId,
  });

  return jsonNoContent();
});

export const contactPostActions = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id: subPath } = extractPathParts(url, PREFIX);

    if (subPath === 'bulk') {
      const body = await request.json();

      if (!Array.isArray(body.contacts)) {
        return jsonError('Missing or invalid "contacts" array', 400);
      }

      const result = await rc.ctx.runMutation(
        internal.contacts.internal_mutations.bulkCreateContacts,
        {
          organizationId: rc.org.organizationId,
          contacts: body.contacts,
        },
      );

      return jsonCreated(result);
    }

    return jsonError(`Unknown action: ${subPath}`, 404);
  },
);
