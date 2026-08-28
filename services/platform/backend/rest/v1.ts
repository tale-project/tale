import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  deleteAgentForCaller,
  listAgentsForCaller,
  readAgentForCaller,
  saveAgentForCaller,
} from '../../convex/agents/file_actions.ts';
import { defineAbilityFor } from '../../lib/permissions/ability.ts';
import type { Auth } from '../auth/auth.ts';
import { findOrganizationMember } from '../auth/membership.ts';
import {
  AutomationError,
  beginRun,
  cancelRun as cancelAutomationRun,
  deploy,
  getRun,
  listAutomations,
  listRuns,
  listTriggers,
  listVersions,
  saveVersion,
} from '../domains/automations/store.ts';
import {
  ContactError,
  createContact,
  deleteContact,
  getContact,
  listContacts,
  updateContact,
  type ContactScope,
} from '../domains/contacts/service.ts';
import {
  listDocuments,
  getDocumentById,
} from '../domains/documents/service.ts';
import { resolveUserOrganization } from '../domains/organizations/service.ts';
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  ProductError,
  updateProduct,
  type ProductScope,
} from '../domains/products/service.ts';
import {
  getProjectAuthContext,
  listProjects,
  loadProjectOrThrow,
  assertReadable,
  createProject,
  ProjectError,
} from '../domains/projects/service.ts';
import {
  createTask,
  loadTaskOrThrow,
  TaskError,
} from '../domains/tasks/service.ts';
import { resolveOrgSlug } from '../lib/org-config.ts';
import { RateLimitExceededError, checkIpRateLimit } from '../lib/rate-limit.ts';

/**
 * /api/v1 — the REST machine door: Bearer API key (the Better Auth apiKey
 * plugin verifies it through the same session surface the dashboard uses),
 * org resolution honouring `X-Organization-Slug` (membership-checked; a
 * multi-org key without the header is refused on write-capable routes
 * rather than guessed from the dashboard's last-active pointer), per-IP
 * rate limiting on the shared `rest:api` rule, and coded JSON errors.
 *
 * Handlers are thin adapters over the SAME domain services the app surface
 * uses — the 0.4 REST handlers' parsing and response shapes mirrored onto
 * them, so a consumer written against 0.4 keeps working.
 */

interface RestVars {
  userId: string;
  organizationId: string;
  orgSlug: string;
  role: string;
}

type RestEnv = { Variables: RestVars };

class RestRefusal extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409;

  constructor(message: string, status: 400 | 401 | 403 | 404 | 409) {
    super(message);
    this.name = 'RestRefusal';
    this.status = status;
  }
}

function domainErrorResponse(c: Context<RestEnv>, error: unknown): Response {
  if (error instanceof RestRefusal) {
    return c.json({ error: error.message }, error.status);
  }
  if (
    error instanceof ContactError ||
    error instanceof ProductError ||
    error instanceof ProjectError ||
    error instanceof TaskError ||
    error instanceof AutomationError
  ) {
    // Every domain error carries a client-mappable status; NOT_FOUND-ish
    // codes read as 404 rather than leaking existence semantics.
    const status =
      'status' in error && typeof error.status === 'number'
        ? error.status
        : 400;
    return c.json(
      { error: error.message, code: error.code },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- domain statuses are the closed 4xx set
      status as 400,
    );
  }
  throw error;
}

export function createRestV1Routes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  // ---- the door: rate limit → API key → org resolution → role ------------
  app.use(async (c, next) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
      'unknown';
    try {
      await checkIpRateLimit(deps.sql, 'rest:api', ip);
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        return c.json({ error: 'Rate limit exceeded' }, 429, {
          'retry-after': String(Math.ceil(error.retryAfter / 1000)),
        });
      }
      throw error;
    }

    const header = c.req.header('authorization') ?? '';
    if (!header.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }
    const apiKey = header.slice('Bearer '.length).trim();
    if (apiKey === '') {
      return c.json({ error: 'Empty API key' }, 401);
    }
    const syntheticHeaders = new Headers();
    syntheticHeaders.set('x-api-key', apiKey);
    const session = await deps.auth.api
      .getSession({ headers: syntheticHeaders })
      .catch(() => null);
    if (!session?.user) {
      return c.json({ error: 'Invalid API key' }, 401);
    }

    const orgSlugHeader = c.req.header('x-organization-slug')?.trim();
    let resolved;
    try {
      resolved = await resolveUserOrganization(deps.sql, {
        userId: session.user.id,
        ...(orgSlugHeader ? { orgSlug: orgSlugHeader } : {}),
        // Machine writes must never follow the dashboard's last-active
        // pointer across tenants — multi-org keys say which org they mean.
        requireExplicitOrgSlug: c.req.method !== 'GET',
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to resolve organization';
      return c.json({ error: message }, 400);
    }

    const member = await findOrganizationMember(
      deps.sql,
      resolved.organizationId,
      session.user.id,
    );
    if (member === null || member.role === 'disabled') {
      return c.json(
        { error: `Not a member of organization "${resolved.orgSlug}".` },
        403,
      );
    }

    c.set('userId', session.user.id);
    c.set('organizationId', resolved.organizationId);
    c.set('orgSlug', resolved.orgSlug);
    c.set('role', member.role);
    await next();
  });

  const scope = (c: Context<RestEnv>): ContactScope & ProductScope => ({
    organizationId: c.get('organizationId'),
    userId: c.get('userId'),
    role: c.get('role'),
  });

  // ---- contacts -----------------------------------------------------------
  const contactInput = z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    source: z.string().optional(),
    locale: z.string().optional(),
    address: z.record(z.string(), z.unknown()).optional(),
    externalId: z.union([z.string(), z.number()]).optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    notes: z.string().optional(),
  });

  app.get('/contacts', async (c) => {
    const limitRaw = Number(c.req.query('limit') ?? '25');
    try {
      const result = await listContacts(deps.sql, scope(c), {
        ...(c.req.query('source') !== undefined
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the service validates the source vocabulary
            { source: c.req.query('source') as never }
          : {}),
        ...(Number.isFinite(limitRaw) ? { limit: limitRaw } : {}),
      });
      return c.json({
        page: result.items,
        isDone: result.nextCursor === null,
        continueCursor:
          result.nextCursor === null ? '' : JSON.stringify(result.nextCursor),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.post('/contacts', async (c) => {
    const body = contactInput.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const id = await deps.sql.begin((tx) =>
        createContact(tx, scope(c), {
          ...body.data,
          externalId:
            body.data.externalId === undefined
              ? undefined
              : String(body.data.externalId),
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the service validates the source vocabulary
          source: (body.data.source ?? 'api') as never,
        }),
      );
      return c.json({ id }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/contacts/:id', async (c) => {
    try {
      const contact = await getContact(deps.sql, scope(c), c.req.param('id'));
      if (!contact) return c.json({ error: 'Contact not found' }, 404);
      return c.json(contact);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.patch('/contacts/:id', async (c) => {
    const body = contactInput.partial().safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      await deps.sql.begin((tx) =>
        updateContact(tx, scope(c), c.req.param('id'), {
          ...body.data,
          externalId:
            body.data.externalId === undefined
              ? undefined
              : String(body.data.externalId),
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the service validates the source vocabulary
          source: body.data.source as never,
        }),
      );
      const updated = await getContact(deps.sql, scope(c), c.req.param('id'));
      if (!updated) return c.json({ error: 'Contact not found' }, 404);
      return c.json(updated);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.delete('/contacts/:id', async (c) => {
    try {
      await deps.sql.begin((tx) =>
        deleteContact(tx, scope(c), c.req.param('id')),
      );
      return c.body(null, 204);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- products -----------------------------------------------------------
  const productInput = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    imageUrl: z.string().optional(),
    stock: z.number().optional(),
    price: z.number().optional(),
    currency: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.string().optional(),
    externalId: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  });

  app.get('/products', async (c) => {
    const limitRaw = Number(c.req.query('limit') ?? '25');
    try {
      const result = await listProducts(deps.sql, scope(c), {
        ...(c.req.query('category') !== undefined
          ? { category: c.req.query('category') ?? '' }
          : {}),
        ...(Number.isFinite(limitRaw) ? { limit: limitRaw } : {}),
      });
      return c.json({
        page: result.items,
        isDone: result.nextCursor === null,
        continueCursor:
          result.nextCursor === null ? '' : JSON.stringify(result.nextCursor),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.post('/products', async (c) => {
    const body = productInput.safeParse(await c.req.json());
    if (!body.success || body.data.name === undefined) {
      return c.json({ error: 'invalid body ("name" is required)' }, 400);
    }
    try {
      const id = await deps.sql.begin((tx) =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the service validates status/currency vocabularies
        createProduct(tx, scope(c), {
          ...body.data,
          name: body.data.name,
        } as never),
      );
      return c.json({ id }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/products/:id', async (c) => {
    try {
      const product = await getProduct(deps.sql, scope(c), c.req.param('id'));
      if (!product) return c.json({ error: 'Product not found' }, 404);
      return c.json(product);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.patch('/products/:id', async (c) => {
    const body = productInput.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      await deps.sql.begin((tx) =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the service validates status/currency vocabularies
        updateProduct(tx, scope(c), c.req.param('id'), body.data as never),
      );
      const updated = await getProduct(deps.sql, scope(c), c.req.param('id'));
      if (!updated) return c.json({ error: 'Product not found' }, 404);
      return c.json(updated);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.delete('/products/:id', async (c) => {
    try {
      await deps.sql.begin((tx) =>
        deleteProduct(tx, scope(c), c.req.param('id')),
      );
      return c.body(null, 204);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- projects -----------------------------------------------------------
  const projectAuth = async (c: Context<RestEnv>) =>
    getProjectAuthContext(deps.sql, {
      organizationId: c.get('organizationId'),
      userId: c.get('userId'),
      role: c.get('role'),
    });

  app.get('/projects', async (c) => {
    try {
      const auth = await projectAuth(c);
      const projects = await listProjects(deps.sql, auth, {
        includeArchived: c.req.query('includeArchived') === 'true',
      });
      return c.json({ projects });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.post('/projects', async (c) => {
    const body = z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        key: z.string().optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body ("name" is required)' }, 400);
    }
    try {
      const auth = await projectAuth(c);
      const created = await deps.sql.begin((tx) =>
        createProject(tx, auth, body.data),
      );
      return c.json(created, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/projects/:id', async (c) => {
    try {
      const auth = await projectAuth(c);
      const project = await loadProjectOrThrow(deps.sql, c.req.param('id'));
      assertReadable(project, auth);
      return c.json(project);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- tasks --------------------------------------------------------------
  app.post('/tasks', async (c) => {
    const body = z
      .object({
        projectId: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        labels: z.array(z.string()).optional(),
        dueDate: z.number().optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        { error: 'invalid body ("projectId" and "title" are required)' },
        400,
      );
    }
    try {
      const auth = await projectAuth(c);
      const created = await deps.sql.begin((tx) =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the service validates status/priority vocabularies
        createTask(tx, auth, body.data as never),
      );
      return c.json(created, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/tasks/:id', async (c) => {
    try {
      const auth = await projectAuth(c);
      const task = await loadTaskOrThrow(deps.sql, c.req.param('id'));
      const project = await loadProjectOrThrow(deps.sql, task.projectId);
      assertReadable(project, auth);
      return c.json(task);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- documents ----------------------------------------------------------
  app.get('/documents', async (c) => {
    try {
      const auth = await projectAuth(c);
      const documents = await listDocuments(deps.sql, auth);
      return c.json({ documents });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/documents/:id', async (c) => {
    try {
      const auth = await projectAuth(c);
      const document = await getDocumentById(deps.sql, auth, c.req.param('id'));
      return c.json(document);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- agents (the file layer, reused) ------------------------------------
  const agentCaller = async (c: Context<RestEnv>) => ({
    orgSlug:
      (await resolveOrgSlug(deps.sql, c.get('organizationId'))) ??
      c.get('orgSlug'),
    viewerUserId: c.get('userId'),
    isOrgAdmin: defineAbilityFor(c.get('role')).can('write', 'orgSettings'),
  });

  app.get('/agents', async (c) => {
    return c.json(await listAgentsForCaller(await agentCaller(c)));
  });

  app.get('/agents/:slug', async (c) => {
    const agent = await readAgentForCaller({
      ...(await agentCaller(c)),
      slug: c.req.param('slug'),
    });
    if (agent === null) return c.json({ error: 'Agent not found' }, 404);
    return c.json({ agent });
  });

  app.put('/agents/:slug', async (c) => {
    const body = z
      .object({
        displayName: z.string().min(1),
        description: z.string().optional(),
        instructions: z.string().optional(),
        visibility: z.enum(['private', 'org']).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const agent = await saveAgentForCaller({
      ...(await agentCaller(c)),
      slug: c.req.param('slug'),
      ...body.data,
    });
    return c.json({ agent });
  });

  app.delete('/agents/:slug', async (c) => {
    return c.json({
      deleted: await deleteAgentForCaller({
        ...(await agentCaller(c)),
        slug: c.req.param('slug'),
      }),
    });
  });

  // ---- automations --------------------------------------------------------
  const requireAuthorRole = (c: Context<RestEnv>): void => {
    const role = c.get('role');
    if (role !== 'owner' && role !== 'admin' && role !== 'developer') {
      throw new RestRefusal('admin or developer role required', 403);
    }
  };

  app.get('/automations', async (c) => {
    return c.json({
      automations: await listAutomations(deps.sql, c.get('organizationId')),
    });
  });

  app.get('/automations/:name{.+}/versions', async (c) => {
    const name = decodeURIComponent(
      (c.req.path.split('/api/v1/automations/')[1] ?? '').slice(
        0,
        -'/versions'.length,
      ),
    );
    return c.json({
      versions: await listVersions(deps.sql, c.get('organizationId'), name),
    });
  });

  app.get('/automations/:name{.+}/triggers', async (c) => {
    const name = decodeURIComponent(
      (c.req.path.split('/api/v1/automations/')[1] ?? '').slice(
        0,
        -'/triggers'.length,
      ),
    );
    return c.json({
      triggers: await listTriggers(deps.sql, c.get('organizationId'), name),
    });
  });

  app.post('/automations/:name{.+}/save', async (c) => {
    const body = z
      .object({
        document: z.unknown(),
        message: z.string().optional(),
        testsPassed: z.boolean().optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success || body.data.document === undefined) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      requireAuthorRole(c);
      const name = decodeURIComponent(
        (c.req.path.split('/api/v1/automations/')[1] ?? '').slice(
          0,
          -'/save'.length,
        ),
      );
      return c.json(
        await saveVersion(deps.sql, {
          organizationId: c.get('organizationId'),
          name,
          document: body.data.document,
          actor: c.get('userId'),
          ...(body.data.message !== undefined
            ? { message: body.data.message }
            : {}),
          ...(body.data.testsPassed !== undefined
            ? { testsPassed: body.data.testsPassed }
            : {}),
        }),
        201,
      );
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.post('/automations/:name{.+}/deploy', async (c) => {
    const body = z
      .object({ version: z.number().int().min(1) })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      requireAuthorRole(c);
      const name = decodeURIComponent(
        (c.req.path.split('/api/v1/automations/')[1] ?? '').slice(
          0,
          -'/deploy'.length,
        ),
      );
      return c.json(
        await deploy(deps.sql, {
          organizationId: c.get('organizationId'),
          name,
          version: body.data.version,
          actor: c.get('userId'),
        }),
      );
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.post('/automations/:name{.+}/start', async (c) => {
    const body = z
      .object({
        input: z.unknown().optional(),
        mode: z.enum(['mock', 'live']).optional(),
        version: z.number().int().optional(),
        projectId: z.string().optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const mode = body.data.mode ?? 'mock';
    try {
      if (mode === 'live') requireAuthorRole(c);
      const name = decodeURIComponent(
        (c.req.path.split('/api/v1/automations/')[1] ?? '').slice(
          0,
          -'/start'.length,
        ),
      );
      const started = await beginRun(deps.sql, {
        organizationId: c.get('organizationId'),
        name,
        input: body.data.input ?? {},
        mode,
        startedBy: `api:${c.get('userId')}`,
        ...(body.data.version !== undefined
          ? { version: body.data.version }
          : {}),
        ...(body.data.projectId !== undefined
          ? { projectId: body.data.projectId }
          : {}),
      });
      if (started === null) {
        return c.json({ error: 'automation has no deployed version' }, 409);
      }
      return c.json(started, 202);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/automations/:name{.+}/runs', async (c) => {
    const name = decodeURIComponent(
      (c.req.path.split('/api/v1/automations/')[1] ?? '').slice(
        0,
        -'/runs'.length,
      ),
    );
    return c.json({
      runs: await listRuns(deps.sql, c.get('organizationId'), { name }),
    });
  });

  app.get('/runs/:runId', async (c) => {
    const run = await getRun(
      deps.sql,
      c.get('organizationId'),
      c.req.param('runId'),
    );
    if (run === null) return c.json({ error: 'Run not found' }, 404);
    return c.json(run);
  });

  app.post('/runs/:runId/cancel', async (c) => {
    return c.json(
      await cancelAutomationRun(
        deps.sql,
        c.get('organizationId'),
        c.req.param('runId'),
      ),
    );
  });

  return app;
}
