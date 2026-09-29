import { transactSerializable } from '@tale/shared/db/serializable';
import { configurationHashSchema } from '@tale/shared/schemas/configuration';
import {
  providerCredentialCreateSchema,
  providerCredentialUpdateSchema,
  providerDefinitionSchema,
} from '@tale/shared/schemas/providers';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { ConfigurationError } from '../../core/lib/config_store/precondition';
import { loadOrgCustomProviders } from '../../core/lib/providers/org_providers.ts';
import { invalidBodyResponse } from '../../lib/invalid-body-response.ts';
import { parseNativeJsonBody } from '../../lib/native-json-body.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { requeueEmbeddingBlockedDocuments } from '../knowledge/service.ts';
import { deleteProviderDefinition } from '../providers/config.ts';
import { updateCredentialWithDefinition } from './custom-provider-edit.ts';
import {
  CredentialAdminError,
  createCredential,
  credentialDependents,
  deleteCredential,
  listCredentials,
  updateCredential,
  type CredentialScope,
  type UpdateCredentialPatch,
} from './service.ts';

const createSchema = providerCredentialCreateSchema.extend({
  expectedHash: z.null().optional(),
});
const updateSchema = providerCredentialUpdateSchema.extend({
  expectedHash: configurationHashSchema.optional(),
});
/** The edit dialog's Save for a credential of an organization-defined
 * provider: the credential's non-secret fields beside the provider's
 * definition, each against the hash the dialog read it at. Strict, so a
 * field this door does not take is refused rather than dropped. */
const updateWithDefinitionSchema = z.strictObject({
  ...providerCredentialUpdateSchema.pick({
    name: true,
    modelAllowlist: true,
    endpointUrl: true,
  }).shape,
  expectedHash: configurationHashSchema,
  definition: z.strictObject({
    config: providerDefinitionSchema,
    expectedHash: configurationHashSchema,
  }),
});

/** What the credential resolver reads off a row — an edit to any of these
 * can lift a refusal the embedding model failed on. A rename or a model
 * allowlist changes nothing an embedding call resolves. */
const RESOLVED_FIELDS = [
  'status',
  'isDefault',
  'secret',
  'envName',
  'endpointUrl',
] as const satisfies readonly (keyof UpdateCredentialPatch)[];

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (
    error instanceof CredentialAdminError ||
    error instanceof ConfigurationError
  ) {
    return c.json(
      {
        error: error.code,
        message: error.message,
        ...(error instanceof CredentialAdminError && error.data !== undefined
          ? { data: error.data }
          : {}),
      },
      error.status,
    );
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

  // What depends on a credential — read by the delete dialog, so the
  // dependency is named before the delete is refused for it.
  app.get('/:credentialId/dependents', async (c) => {
    try {
      return c.json(
        await credentialDependents(
          deps.sql,
          scopeOf(c),
          c.req.param('credentialId'),
        ),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  /**
   * A credential the embedding model resolves was added or repaired: re-queue
   * the documents that failed on the embedding model, as saving the
   * embedding settings does. Their failure told an admin to add or fix the
   * credential, and following it used to leave every document `failed`
   * until someone retried each one by hand. After the credential's own
   * commit, and best-effort: the save stands either way, and a document
   * left behind keeps its Retry.
   */
  async function requeueEmbeddingBlocked(
    scope: CredentialScope,
    credentialId: string,
  ): Promise<void> {
    try {
      const { usedBy } = await credentialDependents(
        deps.sql,
        scope,
        credentialId,
      );
      if (!usedBy.includes('embedding')) return;
      const { requeued } = await requeueEmbeddingBlockedDocuments(deps.sql, {
        organizationId: scope.organizationId,
      });
      if (requeued > 0) {
        console.info(
          `[provider-credentials] the embedding model's credential changed: re-queued ${requeued} document(s) that had failed on the embedding model`,
        );
      }
    } catch (error) {
      console.warn(
        '[provider-credentials] could not re-queue the documents that failed on the embedding model:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  app.post('/', async (c) => {
    const body = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      const scope = scopeOf(c);
      const { expectedHash, ...config } = body.data;
      const credentialId = await transactSerializable(deps.sql, (tx) =>
        createCredential(tx, scope, config, expectedHash),
      );
      await requeueEmbeddingBlocked(scope, credentialId);
      return c.json({ credentialId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:credentialId', async (c) => {
    const body = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      const scope = scopeOf(c);
      const credentialId = c.req.param('credentialId');
      const { expectedHash, ...config } = body.data;
      await transactSerializable(deps.sql, (tx) =>
        updateCredential(tx, scope, credentialId, config, expectedHash),
      );
      if (RESOLVED_FIELDS.some((field) => config[field] !== undefined)) {
        await requeueEmbeddingBlocked(scope, credentialId);
      }
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // The definition door's cap on a definition, with room for the credential
  // fields beside it.
  app.use(
    '/:credentialId/with-definition',
    bodyLimit({
      maxSize: 512 * 1024,
      onError: (c) => c.json({ error: 'PROVIDER_DEFINITION_TOO_LARGE' }, 413),
    }),
  );

  /**
   * An edit of an organization-defined provider's credential and of the
   * provider it names, as one write: a refused credential never leaves the
   * provider changed, and neither part lands over a version saved since the
   * dialog read it. JSON-only, refusing a repeated key, like the definition
   * door.
   */
  app.post('/:credentialId/with-definition', async (c) => {
    const body = updateWithDefinitionSchema.safeParse(
      parseNativeJsonBody(await c.req.text()) ?? null,
    );
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      const scope = scopeOf(c);
      const credentialId = c.req.param('credentialId');
      const orgSlug = await resolveOrgSlug(deps.sql, scope.organizationId);
      if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
      const { expectedHash, definition, ...patch } = body.data;
      await updateCredentialWithDefinition(
        deps.sql,
        scope,
        orgSlug,
        credentialId,
        patch,
        expectedHash,
        definition,
      );
      // The one field here the credential resolver reads (RESOLVED_FIELDS).
      if (patch.endpointUrl !== undefined) {
        await requeueEmbeddingBlocked(scope, credentialId);
      }
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:credentialId', async (c) => {
    try {
      const scope = scopeOf(c);
      const { providerSlug } = await transactSerializable(deps.sql, (tx) =>
        deleteCredential(tx, scope, c.req.param('credentialId')),
      );
      // A custom provider created from the credential dialog lives and dies
      // with its credentials: the last key going removes the definition too,
      // when the caller asked for that. After the credential's own commit, so
      // a serialization retry never replays the file removal.
      if (c.req.query('retireUnusedCustomProvider') === '1') {
        await retireUnusedCustomProvider(scope, providerSlug);
      }
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  async function retireUnusedCustomProvider(
    scope: CredentialScope,
    providerSlug: string,
  ): Promise<void> {
    const orgSlug = await resolveOrgSlug(deps.sql, scope.organizationId);
    if (orgSlug === null) return;
    if (
      !loadOrgCustomProviders(orgSlug).some(
        (provider) => provider.name === providerSlug,
      )
    )
      return;
    const [remaining] = await deps.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.provider_credentials
      WHERE org_id = ${scope.organizationId} AND provider_slug = ${providerSlug}
    `;
    if ((remaining?.count ?? 0) > 0) return;
    try {
      await deleteProviderDefinition(
        deps.sql,
        {
          organizationId: scope.organizationId,
          orgSlug,
          userId: scope.userId,
          ...(scope.email !== undefined ? { email: scope.email } : {}),
        },
        providerSlug,
        undefined,
      );
    } catch (error) {
      // The credential is gone either way; a definition that outlives it
      // stays visible in the catalog picker and can be retired from there.
      console.warn(
        `[provider-credentials] could not retire the unused custom provider "${providerSlug}":`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return app;
}
