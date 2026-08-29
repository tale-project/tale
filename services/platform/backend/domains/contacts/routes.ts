import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { LegalHoldError } from '../legal_holds/service.ts';
import {
  CONTACT_SOURCES,
  ContactError,
  createContact,
  deleteContact,
  getContact,
  listContacts,
  updateContact,
  type ContactScope,
} from './service.ts';

const sourceSchema = z.enum(CONTACT_SOURCES);

const contactInputSchema = z.object({
  name: z.string().max(300).optional(),
  email: z.string().email().max(320).optional(),
  phone: z.string().max(50).optional(),
  externalId: z.string().max(256).optional(),
  source: sourceSchema,
  locale: z.string().max(20).optional(),
  address: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().max(60)).max(50).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(10_000).optional(),
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
          tag: z.string().max(60).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          cursorUpdatedAt: z.coerce.number().int().positive().optional(),
          cursorId: z.string().optional(),
        })
        .safeParse({
          search: c.req.query('search'),
          source: c.req.query('source'),
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

  app.post('/', async (c) => {
    const body = contactInputSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
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
      return c.json({ error: 'invalid body' }, 400);
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
