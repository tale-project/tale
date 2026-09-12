import { transactSerializable } from '@tale/shared/db/serializable';
import { configurationHashSchema } from '@tale/shared/schemas/configuration';
import {
  providerCredentialCreateSchema,
  providerCredentialUpdateSchema,
} from '@tale/shared/schemas/providers';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { ConfigurationError } from '../../core/lib/config_store/precondition';
import {
  CredentialAdminError,
  createCredential,
  deleteCredential,
  listCredentials,
  updateCredential,
  type CredentialScope,
} from './service.ts';

const createSchema = providerCredentialCreateSchema.extend({
  expectedHash: z.null().optional(),
});
const updateSchema = providerCredentialUpdateSchema.extend({
  expectedHash: configurationHashSchema.optional(),
});

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (
    error instanceof CredentialAdminError ||
    error instanceof ConfigurationError
  ) {
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
    const body = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const scope = scopeOf(c);
      const { expectedHash, ...config } = body.data;
      const credentialId = await transactSerializable(deps.sql, (tx) =>
        createCredential(tx, scope, config, expectedHash),
      );
      return c.json({ credentialId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:credentialId', async (c) => {
    const body = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const scope = scopeOf(c);
      const { expectedHash, ...config } = body.data;
      await transactSerializable(deps.sql, (tx) =>
        updateCredential(
          tx,
          scope,
          c.req.param('credentialId'),
          config,
          expectedHash,
        ),
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
