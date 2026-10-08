import { expectedConfigurationHashSchema } from '@tale/shared/schemas/configuration';
import {
  KNOWLEDGE_CONNECTION_PASSWORD_MAX,
  knowledgeConnectionSchema,
} from '@tale/shared/schemas/knowledge';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { FETCH_WINDOW_CHARS, windowText } from '../../core/knowledge/fetch.ts';
import { isAudienceAdmin } from '../../core/lib/audience.ts';
import { ConfigurationError } from '../../core/lib/config_store/precondition';
import {
  invalidBodyIssuesResponse,
  invalidBodyResponse,
} from '../../lib/invalid-body-response.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { getProjectAuthContext, listProjects } from '../projects/service.ts';
import {
  isCredentialSelectionResolvable,
  listCredentials,
} from '../provider_credentials/service.ts';
import { websitesAfterEmbeddingChange } from '../websites/service.ts';
import {
  KnowledgeAdminError,
  deleteKnowledgeConnection,
  deleteKnowledgeEmbedding,
  listEmbeddingRecommendationsForOrg,
  probeKnowledgeConnection,
  readKnowledgeConnectionView,
  readKnowledgeEmbeddingView,
  writeKnowledgeConnection,
  writeKnowledgeEmbedding,
} from './admin.ts';
import {
  fetchKnowledgeDocument,
  KnowledgeError,
  searchKnowledgeForOrg,
  requeueDocumentsWithoutVectors,
  requeueEmbeddingBlockedDocuments,
} from './service.ts';

const searchSchema = z.object({
  query: z.string().min(1).max(2000),
  corpus: z.enum(['documents', 'web', 'all']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  folder: z.string().max(1024).optional(),
});

const fetchSchema = z.object({
  fileId: z.string().min(1).max(1024),
  page: z.number().int().min(1).optional(),
});

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof KnowledgeError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

/**
 * /api/app/knowledge — retrieval for the signed-in surface. The access
 * scope is derived SERVER-SIDE from the caller's memberships (their teams +
 * the projects they can read + the hub), never from client input.
 */
export function createKnowledgeRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const callerScope = async (c: Context<OrgEnv>) => {
    const auth = await getProjectAuthContext(
      deps.sql,
      {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
        role: c.get('orgMember').role,
      },
      c.get('sessionBundle').user.email,
    );
    const projects = await listProjects(deps.sql, auth, {});
    return {
      auth,
      access: {
        userId: auth.userId,
        teamIds: auth.teamIds,
        isAdmin: isAudienceAdmin(auth.role),
        projectIds: projects.map((project) => project.id),
        includeHub: true,
        includeConversationScoped: false,
      },
    };
  };

  // Every body here reads as `null` when it is not JSON, so the schema
  // refuses it with the same 400 as any other malformed body — a parse error
  // escaping the handler used to surface as a 500.
  app.post('/search', async (c) => {
    const body = searchSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      const { access } = await callerScope(c);
      const result = await searchKnowledgeForOrg(deps.sql, {
        organizationId: c.get('orgId'),
        query: body.data.query,
        ...(body.data.corpus !== undefined ? { corpus: body.data.corpus } : {}),
        ...(body.data.limit !== undefined ? { limit: body.data.limit } : {}),
        ...(body.data.folder !== undefined ? { folder: body.data.folder } : {}),
        access,
      });
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/fetch', async (c) => {
    const body = fetchSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      const { access } = await callerScope(c);
      const document = await fetchKnowledgeDocument(deps.sql, {
        organizationId: c.get('orgId'),
        fileId: body.data.fileId,
        access,
      });
      const page = body.data.page;
      if (document === null || page === undefined) {
        return c.json({ document });
      }
      // `page` is a 1-based window of FETCH_WINDOW_CHARS over the text — the
      // paging contract every rag_fetch surface shares. Accepted-and-ignored
      // was worse than absent: a caller asking for page 2 got the whole
      // document again and no way to tell.
      const window = windowText(
        document.text,
        (page - 1) * FETCH_WINDOW_CHARS,
        FETCH_WINDOW_CHARS,
      );
      return c.json({
        document: { ...document, text: window.content },
        page,
        totalPages: Math.max(
          1,
          Math.ceil(window.totalChars / FETCH_WINDOW_CHARS),
        ),
        totalChars: window.totalChars,
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // ---- Admin config (data-residency page): connection + embedding -------
  const requireKnowledgeAdmin = (c: Context<OrgEnv>): Response | null => {
    if (
      defineAbilityFor(c.get('orgMember').role).cannot('write', 'orgSettings')
    ) {
      return c.json(
        {
          error: 'ORG_FORBIDDEN',
          message: `Role "${c.get('orgMember').role}" cannot manage the knowledge configuration.`,
        },
        403,
      );
    }
    return null;
  };
  const orgSlugOf = async (c: Context<OrgEnv>): Promise<string | null> =>
    resolveOrgSlug(deps.sql, c.get('orgId'));
  const handleAdminError = (c: Context<OrgEnv>, error: unknown): Response => {
    if (
      error instanceof KnowledgeAdminError ||
      error instanceof ConfigurationError
    ) {
      return c.json(
        { error: error.code, message: error.message },
        error.status,
      );
    }
    throw error;
  };
  // The wire shape of a BYO knowledge connection is the SHARED field schemas
  // (host charset, port range, the full sslmode set the picker offers —
  // `verify-ca` included) in a strip-mode object: strictness is the config
  // FILE's policy, not the request body's. A hand-rolled second copy of the
  // enum is exactly how `verify-ca` went missing here and every save or test
  // with it died as a bare "invalid body".
  const connectionBodySchema = z.object({
    ...knowledgeConnectionSchema.shape,
    password: z
      .string()
      .max(KNOWLEDGE_CONNECTION_PASSWORD_MAX)
      .nullable()
      .optional(),
  });

  app.get('/connection', async (c) => {
    const denied = requireKnowledgeAdmin(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    return c.json(await readKnowledgeConnectionView(orgSlug));
  });

  app.post('/connection', async (c) => {
    const denied = requireKnowledgeAdmin(c);
    if (denied) return denied;
    const body = connectionBodySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) return invalidBodyResponse(c, body.error);
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const { password, ...connection } = body.data;
    try {
      await writeKnowledgeConnection(deps.sql, orgSlug, {
        connection,
        ...(password !== undefined ? { password } : {}),
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleAdminError(c, error);
    }
  });

  app.delete('/connection', async (c) => {
    const denied = requireKnowledgeAdmin(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    await deleteKnowledgeConnection(deps.sql, orgSlug);
    return c.json({ ok: true });
  });

  app.post('/connection/test', async (c) => {
    const denied = requireKnowledgeAdmin(c);
    if (denied) return denied;
    const body = connectionBodySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) return invalidBodyResponse(c, body.error);
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const { password, ...connection } = body.data;
    try {
      return c.json(
        await probeKnowledgeConnection({
          connection,
          ...(password !== undefined ? { password } : {}),
          orgSlug,
        }),
      );
    } catch (error) {
      return handleAdminError(c, error);
    }
  });

  // The websites follow the model too: their page says whether search can
  // reach them, and a saved model is what embeds the pages crawled without
  // one. Best-effort — the setting is saved either way; a site a failure
  // here skipped is embedded by its next scheduled scan.
  const websitesFollowEmbedding = async (
    organizationId: string,
    orgSlug: string,
    change: 'saved' | 'removed',
  ): Promise<void> => {
    try {
      const { queued } = await websitesAfterEmbeddingChange(
        deps.sql,
        organizationId,
        change,
      );
      if (queued > 0) {
        console.info(
          `[knowledge] embedding configured for ${orgSlug}: queued a scan of ${queued} website(s) to embed their pages`,
        );
      }
    } catch (error) {
      console.warn(
        `[knowledge] embedding ${change} for ${orgSlug}: the websites could not follow:`,
        error instanceof Error ? error.message : error,
      );
    }
  };

  // So do the documents already indexed: vectors are kept per width, so a
  // model of another width finds none of theirs, and each would be missing
  // from search by meaning until someone indexed it again. Best-effort like
  // the websites — the setting is saved either way, and saving it again
  // picks up whatever a failure here left.
  const documentsFollowEmbedding = async (
    organizationId: string,
    orgSlug: string,
  ): Promise<number> => {
    try {
      const { requeued } = await requeueDocumentsWithoutVectors(deps.sql, {
        organizationId,
        orgSlug,
      });
      if (requeued > 0) {
        console.info(
          `[knowledge] embedding configured for ${orgSlug}: re-queued ${requeued} indexed document(s) that have no vector of the model's width`,
        );
      }
      return requeued;
    } catch (error) {
      console.warn(
        `[knowledge] embedding saved for ${orgSlug}: the indexed documents could not follow:`,
        error instanceof Error ? error.message : error,
      );
      return 0;
    }
  };

  app.get('/embedding', async (c) => {
    const denied = requireKnowledgeAdmin(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    try {
      const view = await readKnowledgeEmbeddingView(orgSlug);
      if (!view.configured || view.providerSlug === undefined) {
        return c.json(view);
      }
      // "Configured" used to be the file's existence alone: with its
      // credential deleted the page still said so while indexing and search
      // were down. Say whether the selection still resolves.
      return c.json({
        ...view,
        credentialResolvable: await isCredentialSelectionResolvable(
          deps.sql,
          c.get('orgId'),
          {
            providerSlug: view.providerSlug,
            ...(view.credentialId !== undefined
              ? { credentialId: view.credentialId }
              : {}),
          },
        ),
      });
    } catch (error) {
      return handleAdminError(c, error);
    }
  });

  app.post('/embedding', async (c) => {
    const denied = requireKnowledgeAdmin(c);
    if (denied) return denied;
    const body: unknown = await c.req.json().catch(() => null);
    if (body === null) {
      return invalidBodyIssuesResponse(c, [
        { path: 'body', message: 'must be a JSON object' },
      ]);
    }
    const input = z
      .object({ expectedHash: expectedConfigurationHashSchema.optional() })
      .catchall(z.unknown())
      .safeParse(body);
    if (!input.success)
      return c.json({ error: 'INVALID_CONFIG_PRECONDITION' }, 400);
    const { expectedHash, ...config } = input.data;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    try {
      if (expectedHash === undefined)
        await writeKnowledgeEmbedding(deps.sql, orgSlug, config);
      else
        await writeKnowledgeEmbedding(deps.sql, orgSlug, config, expectedHash);
      // Configuring a model is only half the fix: every document that failed
      // while there was none stays `failed` until something re-queues it, and
      // the failure text tells the operator to configure one "then retry
      // indexing" — one document at a time, by hand. Do it for them, and say
      // how many, so the page can report the recovery instead of looking as
      // though nothing happened.
      const { requeued } = await requeueEmbeddingBlockedDocuments(deps.sql, {
        organizationId: c.get('orgId'),
      });
      if (requeued > 0) {
        console.info(
          `[knowledge] embedding configured for ${orgSlug}: re-queued ${requeued} document(s) that had failed on the embedding model`,
        );
      }
      const reembedded = await documentsFollowEmbedding(
        c.get('orgId'),
        orgSlug,
      );
      await websitesFollowEmbedding(c.get('orgId'), orgSlug, 'saved');
      return c.json({ ok: true, requeued: requeued + reembedded });
    } catch (error) {
      return handleAdminError(c, error);
    }
  });

  app.delete('/embedding', async (c) => {
    const denied = requireKnowledgeAdmin(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    await deleteKnowledgeEmbedding(deps.sql, orgSlug);
    await websitesFollowEmbedding(c.get('orgId'), orgSlug, 'removed');
    return c.json({ ok: true });
  });

  app.get('/embedding/recommendations', async (c) => {
    const denied = requireKnowledgeAdmin(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const session = c.get('sessionBundle');
    const credentials = await listCredentials(deps.sql, {
      organizationId: c.get('orgId'),
      userId: session.user.id,
      email: session.user.email,
      role: c.get('orgMember').role,
    });
    // `{recommendations, providers}` — the curated picks and each
    // provider's declared embedding support.
    return c.json(
      await listEmbeddingRecommendationsForOrg(orgSlug, credentials),
    );
  });

  return app;
}
