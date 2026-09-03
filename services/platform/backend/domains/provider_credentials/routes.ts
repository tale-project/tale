import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  CredentialAdminError,
  createCredential,
  deleteCredential,
  listCredentials,
  updateCredential,
  type CredentialScope,
} from './service.ts';

const createSchema = z.object({
  providerSlug: z.string().min(1).max(100),
  authMethod: z.enum([
    'api-key',
    'env',
    'subscription-key',
    'subscription-broker',
  ]),
  name: z.string().min(1).max(120),
  secret: z.string().max(100_000).optional(),
  envName: z.string().max(80).optional(),
  endpointUrl: z.string().max(2048).optional(),
  modelAllowlist: z.array(z.string().max(200)).max(200).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  isDefault: z.boolean().optional(),
  modelAllowlist: z.array(z.string().max(200)).max(200).nullable().optional(),
  endpointUrl: z.string().max(2048).nullable().optional(),
  /** Re-point an env credential at another TALE_PROVIDER_KEY_* variable. */
  envName: z.string().max(80).optional(),
  secret: z.string().max(100_000).optional(),
});

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof CredentialAdminError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

/**
 * /api/app/provider-credentials — the Settings → AI providers admin surface.
 * Secrets go IN only; every read returns metadata + the masked preview.
 */
export function createProviderCredentialRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const scopeOf = (c: Context<OrgEnv>): CredentialScope => ({
    organizationId: c.get('orgId'),
    userId: c.get('sessionBundle').user.id,
    email: c.get('sessionBundle').user.email,
    role: c.get('orgMember').role,
  });

  app.get('/', async (c) => {
    try {
      return c.json({
        credentials: await listCredentials(
          deps.sql,
          scopeOf(c),
          c.req.query('providerSlug'),
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/', async (c) => {
    const body = createSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const scope = scopeOf(c);
      const credentialId = await transactSerializable(deps.sql, (tx) =>
        createCredential(tx, scope, body.data),
      );
      return c.json({ credentialId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:credentialId', async (c) => {
    const body = updateSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const scope = scopeOf(c);
      await transactSerializable(deps.sql, (tx) =>
        updateCredential(tx, scope, c.req.param('credentialId'), body.data),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:credentialId', async (c) => {
    try {
      const scope = scopeOf(c);
      await transactSerializable(deps.sql, (tx) =>
        deleteCredential(tx, scope, c.req.param('credentialId')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
