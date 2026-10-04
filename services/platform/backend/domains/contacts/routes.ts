import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  CONTACT_EXTERNAL_ID_MAX,
  CONTACT_IMPORT_ROWS_MAX,
  CONTACT_LOCALE_MAX,
  CONTACT_LOCALE_PATTERN,
} from '../../../lib/shared/schemas/common.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { mergeBulkResult, partitionBulkRows } from '../../lib/bulk-rows.ts';
import { invalidBodyResponse } from '../../lib/invalid-body-response.ts';
import { LegalHoldError } from '../legal_holds/service.ts';
import { contactEmailSchema, contactFieldsShape } from './input-schema.ts';
import {
  bulkCreateContacts,
  CONTACT_SOURCES,
  ContactError,
  countContacts,
  createContact,
  deleteContact,
  getContact,
  listContacts,
  searchContacts,
  type ContactScope,
  updateContact,
} from './service.ts';

const sourceSchema = z.enum(CONTACT_SOURCES);

/** The shared field shape (`input-schema.ts`) with this door's own rule:
 * the app always names the source. Unknown keys are stripped, as the
 * adapters expect; the REST door composes the same shape strict. */
const contactInputSchema = z.object({
  ...contactFieldsShape,
  externalId: z
    .string()
    .trim()
    .max(CONTACT_EXTERNAL_ID_MAX)
    .nullable()
    .optional(),
  source: sourceSchema,
  locale: contactFieldsShape.locale.refine(
    (value) => !value || CONTACT_LOCALE_PATTERN.test(value),
    'invalid contact locale',
  ),
});

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof ContactError) {
    return c.json({ error: error.code }, error.status);
  }
  // The legal-hold gate refuses destructive paths with its own 409.
  if (error instanceof LegalHoldError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

/** /api/app/contacts — the org correspondent directory. */
export function createContactRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const scopeOf = (c: Context<OrgEnv>): ContactScope => ({
    organizationId: c.get('orgId'),
    userId: c.get('sessionBundle').user.id,
    email: c.get('sessionBundle').user.email,
    role: c.get('orgMember').role,
  });

  app.get('/', async (c) => {
    try {
      const query = z
        .object({
          search: z.string().max(200).optional(),
          source: sourceSchema.optional(),
          // An open set, like `search` and `tag`: the REST door stores any
          // locale up to the cap, so an unknown one lists nothing.
          locale: z.string().max(CONTACT_LOCALE_MAX).optional(),
          tag: z.string().max(60).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          cursorUpdatedAt: z.coerce.number().int().positive().optional(),
          cursorId: z.string().optional(),
        })
        .safeParse({
          search: c.req.query('search'),
          source: c.req.query('source'),
          locale: c.req.query('locale'),
          tag: c.req.query('tag'),
          limit: c.req.query('limit'),
          cursorUpdatedAt: c.req.query('cursorUpdatedAt'),
          cursorId: c.req.query('cursorId'),
        });
      if (!query.success) {
        return c.json({ error: 'invalid query' }, 400);
      }
      const { cursorUpdatedAt, cursorId, ...rest } = query.data;
      return c.json(
        await listContacts(deps.sql, scopeOf(c), {
          ...rest,
          cursor:
            cursorUpdatedAt !== undefined && cursorId !== undefined
              ? { updatedAt: cursorUpdatedAt, id: cursorId }
              : null,
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/count', async (c) => {
    return c.json({ count: await countContacts(deps.sql, c.get('orgId')) });
  });

  app.post('/', async (c) => {
    const body = contactInputSchema.safeParse(await c.req.json());
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      const scope = scopeOf(c);
      const contactId = await transactSerializable(deps.sql, (tx) =>
        createContact(tx, scope, body.data),
      );
      return c.json({ contactId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/search', async (c) => {
    try {
      return c.json({
        hits: await searchContacts(
          deps.sql,
          scopeOf(c),
          c.req.query('q') ?? '',
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/bulk', async (c) => {
    const body = z
      .object({ contacts: z.array(z.unknown()).max(CONTACT_IMPORT_ROWS_MAX) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      // Row by row: a refused row names its field at the caller's index and
      // the rest of the file still lands (the REST contacts-bulk semantics).
      // The bulk lane REQUIRES an email: it is the duplicate key the per-row
      // check uses, and a row without one cannot be deduplicated.
      const { valid, refused } = partitionBulkRows(
        body.data.contacts,
        contactInputSchema.extend({ email: contactEmailSchema }),
      );
      const landed = await bulkCreateContacts(
        deps.sql,
        scopeOf(c),
        valid.map((entry) => entry.item),
      );
      return c.json(
        mergeBulkResult(
          valid,
          refused.map(({ input, ...refusal }) =>
            Object.assign(refusal, { contact: input }),
          ),
          landed,
        ),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:contactId', async (c) => {
    try {
      return c.json({
        contact: await getContact(
          deps.sql,
          scopeOf(c),
          c.req.param('contactId'),
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:contactId', async (c) => {
    const body = contactInputSchema.partial().safeParse(await c.req.json());
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      const scope = scopeOf(c);
      await transactSerializable(deps.sql, (tx) =>
        updateContact(tx, scope, c.req.param('contactId'), body.data),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:contactId', async (c) => {
    try {
      const scope = scopeOf(c);
      await transactSerializable(deps.sql, (tx) =>
        deleteContact(tx, scope, c.req.param('contactId')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
