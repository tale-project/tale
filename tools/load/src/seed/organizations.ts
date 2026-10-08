/**
 * Organizations, created and configured THROUGH THE API so the platform's
 * own hooks run: Better Auth's create fires `afterCreateOrganization`, which
 * enqueues the `org.scaffold` job (config tree, starter project, automation
 * packs) and writes the owner's `joined_organization` audit row.
 *
 * Two passes, each with bounded concurrency:
 *
 *  1. create every organization (a taken slug is looked up, not an error, so
 *     a rerun converges);
 *  2. configure each one for load — mock provider definition, env
 *     credential, embedding model, one shared project, the chat model the
 *     composer offers — after its scaffold job has finished.
 *
 * The wait matters: the scaffold runs with `cleanFirst`, which REMOVES the
 * organization's config subtree before seeding it, so a provider definition
 * written before the job ran would be deleted; and the starter content is
 * only seeded into an organization without projects, so a load project
 * created first would suppress it. Splitting the passes lets the worker
 * scaffold early organizations while later ones are still being created.
 *
 * Every step reads before it writes, so each is idempotent; transient
 * failures are retried with backoff, and anything that still fails is
 * returned per organization for the summary — never silently dropped.
 */

import { isDeepStrictEqual } from 'node:util';

import type { Sql } from 'postgres';

import { organizationSlug, type PlanOrganization } from '../plan.ts';
import type { UserAuth } from './auth.ts';
import { mapLimit } from './concurrency.ts';
import { findOrganizationBySlug, scaffoldJobStates } from './db.ts';
import {
  SeedHttp,
  SeedHttpError,
  withRetry,
  type SeedRequest,
} from './http.ts';
import type { SeedProvider } from './options.ts';
import {
  organizationName,
  ownerIndexFor,
  type PopulationPlan,
} from './population.ts';

/** The project every member files load tasks in. */
const LOAD_PROJECT_NAME = 'Load test project';

/** The project the scaffold job's starter content creates. */
const STARTER_PROJECT_NAME = 'Getting started';

/** Name of the env credential the seed connects. */
const LOAD_CREDENTIAL_NAME = 'Load test mock';

// ---------------------------------------------------------------------------
// Request bodies (pure; validated against the platform's schemas in tests)
// ---------------------------------------------------------------------------

/** The org-custom provider definition pointing at the mock. */
export function providerDefinitionFor(provider: SeedProvider) {
  return {
    name: provider.slug,
    displayName: 'Load test mock',
    apiFormat: provider.apiFormat,
    baseUrl: provider.baseUrl,
    catalog: { source: provider.catalogSource },
    auth: [{ method: 'env' as const }],
  };
}

/**
 * The env credential activating the provider. A catalog-less provider
 * serves exactly its credential's allowlist, so the chat model goes there.
 */
export function providerCredentialBodyFor(provider: SeedProvider) {
  return {
    providerSlug: provider.slug,
    authMethod: 'env' as const,
    name: LOAD_CREDENTIAL_NAME,
    envName: provider.envName,
    isDefault: true,
    ...(provider.catalogSource === 'none'
      ? { modelAllowlist: [provider.chatModel] }
      : {}),
  };
}

/** The organization's embedding model, resolved through the credential. */
export function embeddingBodyFor(provider: SeedProvider) {
  return {
    providerSlug: provider.slug,
    model: provider.embeddingModel,
    dimensions: provider.embeddingDimensions,
  };
}

/**
 * The model id the plan records for chat turns: the configured chat model
 * when the composer offers it from the mock, else the mock's first model,
 * else `null` (the composer offers nothing from the mock — typically a
 * `models-endpoint` catalog whose mock was not running while seeding).
 */
export function pickChatModel(
  models: readonly { id: string; providerSlug: string }[],
  provider: Pick<SeedProvider, 'slug' | 'chatModel'>,
): string | null {
  const fromMock = models.filter(
    (model) => model.providerSlug === provider.slug,
  );
  const exact = fromMock.find((model) => model.id === provider.chatModel);
  return (exact ?? fromMock[0])?.id ?? null;
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

export interface OrgSeedContext {
  http: SeedHttp;
  /** Present in SQL mode: slug lookups and scaffold probes read the DB. */
  sql: Sql | null;
  plan: PopulationPlan;
  provider: SeedProvider;
  auth: UserAuth;
  concurrency: number;
  scaffoldTimeoutMs: number;
  log: (line: string) => void;
}

export interface CreatedOrganization {
  index: number;
  id: string;
  slug: string;
  name: string;
  ownerIndex: number;
}

export interface OrganizationIssue {
  index: number;
  slug: string;
  step: string;
  message: string;
}

type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; issue: OrganizationIssue };

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A step's failure as an issue; `step` names it in the summary. */
async function step<T>(
  org: { index: number; slug: string },
  name: string,
  run: () => Promise<T>,
): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return {
      ok: false,
      issue: {
        index: org.index,
        slug: org.slug,
        step: name,
        message: message(error),
      },
    };
  }
}

/** A 409 version conflict: a concurrent write moved the hash; read again. */
const isConflict = (error: unknown): boolean =>
  error instanceof SeedHttpError && error.status === 409;

function isSlugTaken(status: number, text: string): boolean {
  return status === 400 && /already (taken|exists)/i.test(text);
}

async function lookupOrganization(
  ctx: OrgSeedContext,
  slug: string,
  cookie: string,
): Promise<{ id: string; name: string }> {
  if (ctx.sql !== null) {
    const found = await findOrganizationBySlug(ctx.sql, slug);
    if (found) return found;
  } else {
    const body = (await ctx.http.json({
      method: 'GET',
      path: '/api/app/organizations',
      cookie,
    })) as {
      organizations?: { organizationId: string; name: string; slug?: string }[];
    };
    const found = body.organizations?.find((org) => org.slug === slug);
    if (found) return { id: found.organizationId, name: found.name };
  }
  throw new Error(
    `slug ${slug} is taken by an organization its owner does not belong to`,
  );
}

async function createOne(
  ctx: OrgSeedContext,
  index: number,
): Promise<Outcome<CreatedOrganization>> {
  const slug = organizationSlug(ctx.plan.runId, index);
  const name = organizationName(ctx.plan.runId, index);
  const ownerIndex = ownerIndexFor(ctx.plan, index);
  const org = { index, slug };
  const cookie = await step(org, 'authenticate owner', () =>
    ctx.auth(ownerIndex),
  );
  if (!cookie.ok) return cookie;
  return step(org, 'create organization', () =>
    withRetry(async () => {
      const req: SeedRequest = {
        method: 'POST',
        path: '/api/auth/organization/create',
        json: { name, slug },
        cookie: cookie.value,
      };
      const res = await ctx.http.send(req);
      if (res.status === 200) {
        const id = (res.body as { id?: unknown } | null)?.id;
        if (typeof id !== 'string')
          throw new Error('create answered no organization id');
        return { index, id, slug, name, ownerIndex };
      }
      // A rerun, or a retry whose first attempt landed: adopt the existing
      // organization under its stored name.
      if (isSlugTaken(res.status, res.text)) {
        const existing = await lookupOrganization(ctx, slug, cookie.value);
        return {
          index,
          id: existing.id,
          slug,
          name: existing.name,
          ownerIndex,
        };
      }
      throw new SeedHttpError(req, res);
    }),
  );
}

/** Pass 1: create (or adopt) every organization in `indexes`. */
export async function createOrganizations(
  ctx: OrgSeedContext,
  indexes: readonly number[],
  onProgress: () => void,
): Promise<{ created: CreatedOrganization[]; failures: OrganizationIssue[] }> {
  const outcomes = await mapLimit(indexes, ctx.concurrency, async (index) => {
    const outcome = await createOne(ctx, index);
    onProgress();
    return outcome;
  });
  const created: CreatedOrganization[] = [];
  const failures: OrganizationIssue[] = [];
  for (const outcome of outcomes) {
    if (outcome.ok) created.push(outcome.value);
    else failures.push(outcome.issue);
  }
  return { created, failures };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const PENDING_JOB_STATES = new Set(['created', 'retry', 'active']);

async function listProjects(
  ctx: OrgSeedContext,
  org: CreatedOrganization,
  cookie: string,
): Promise<{ id: string; name: string }[]> {
  const body = (await ctx.http.json({
    method: 'GET',
    path: '/api/app/projects',
    query: { orgId: org.id },
    cookie,
  })) as { projects?: { id: string; name: string }[] };
  return body.projects ?? [];
}

/**
 * Wait until the organization's scaffold job is done. With the database the
 * job row itself is read (a job still pending at the deadline is a failure:
 * configuring now would race its `cleanFirst`); over HTTP alone the starter
 * project is the signal, and a deadline without one is only a warning, since
 * a deployment may run with provisioning disabled.
 */
async function waitForScaffold(
  ctx: OrgSeedContext,
  org: CreatedOrganization,
  cookie: string,
): Promise<{ warning: string | null }> {
  const deadline = Date.now() + ctx.scaffoldTimeoutMs;
  let delay = 250;
  for (;;) {
    if (ctx.sql !== null) {
      const states = await scaffoldJobStates(ctx.sql, org.slug);
      if (!states.some((state) => PENDING_JOB_STATES.has(state))) {
        const failed =
          states.includes('failed') && !states.includes('completed');
        return { warning: failed ? 'the org.scaffold job failed' : null };
      }
    } else {
      // The load project counts too: it is only ever created after this
      // wait passed once, so a resumed organization is not held up again on
      // a deployment that seeds no starter content.
      const projects = await withRetry(() => listProjects(ctx, org, cookie));
      if (
        projects.some(
          (project) =>
            project.name === STARTER_PROJECT_NAME ||
            project.name === LOAD_PROJECT_NAME,
        )
      ) {
        return { warning: null };
      }
    }
    if (Date.now() >= deadline) {
      const waited = `${Math.round(ctx.scaffoldTimeoutMs / 1000)} s`;
      if (ctx.sql !== null) {
        throw new Error(
          `the org.scaffold job was still pending after ${waited}`,
        );
      }
      return {
        warning: `no starter project after ${waited}; configured anyway`,
      };
    }
    await sleep(delay);
    delay = Math.min(2000, delay * 2);
  }
}

async function ensureProviderDefinition(
  ctx: OrgSeedContext,
  org: CreatedOrganization,
  cookie: string,
): Promise<void> {
  const path = `/api/app/providers/definitions/${ctx.provider.slug}`;
  const query = { orgId: org.id };
  const desired = providerDefinitionFor(ctx.provider);
  await withRetry(
    async () => {
      const current = (await ctx.http.json({
        method: 'GET',
        path,
        query,
        cookie,
      })) as {
        config: unknown;
        hash: string | null;
      };
      if (current.hash !== null && isDeepStrictEqual(current.config, desired))
        return;
      await ctx.http.json({
        method: 'PUT',
        path,
        query,
        cookie,
        json: { config: desired, expectedHash: current.hash },
      });
    },
    { retryIf: isConflict },
  );
}

async function ensureCredential(
  ctx: OrgSeedContext,
  org: CreatedOrganization,
  cookie: string,
): Promise<void> {
  const path = '/api/app/provider-credentials';
  await withRetry(
    async () => {
      const current = (await ctx.http.json({
        method: 'GET',
        path,
        query: { orgId: org.id, providerSlug: ctx.provider.slug },
        cookie,
      })) as { credentials?: { authMethod: string; envName: string | null }[] };
      const present = (current.credentials ?? []).some(
        (row) =>
          row.authMethod === 'env' && row.envName === ctx.provider.envName,
      );
      if (present) return;
      await ctx.http.json({
        method: 'POST',
        path,
        query: { orgId: org.id },
        cookie,
        json: providerCredentialBodyFor(ctx.provider),
      });
    },
    { retryIf: isConflict },
  );
}

async function ensureEmbedding(
  ctx: OrgSeedContext,
  org: CreatedOrganization,
  cookie: string,
): Promise<void> {
  const path = '/api/app/knowledge/embedding';
  const query = { orgId: org.id };
  const desired = embeddingBodyFor(ctx.provider);
  await withRetry(
    async () => {
      const view = (await ctx.http.json({
        method: 'GET',
        path,
        query,
        cookie,
      })) as {
        configured?: boolean;
        providerSlug?: string;
        model?: string;
        dimensions?: number;
      };
      if (
        view.configured === true &&
        view.providerSlug === desired.providerSlug &&
        view.model === desired.model &&
        view.dimensions === desired.dimensions
      ) {
        return;
      }
      await ctx.http.json({
        method: 'POST',
        path,
        query,
        cookie,
        json: desired,
      });
    },
    { retryIf: isConflict },
  );
}

async function ensureProject(
  ctx: OrgSeedContext,
  org: CreatedOrganization,
  cookie: string,
): Promise<string> {
  return withRetry(async () => {
    const existing = (await listProjects(ctx, org, cookie)).find(
      (project) => project.name === LOAD_PROJECT_NAME,
    );
    if (existing) return existing.id;
    const created = (await ctx.http.json({
      method: 'POST',
      path: '/api/app/projects',
      query: { orgId: org.id },
      cookie,
      json: {
        name: LOAD_PROJECT_NAME,
        description:
          'Shared by every member of this organization during load runs.',
      },
    })) as { projectId?: unknown };
    if (typeof created.projectId !== 'string') {
      throw new Error('project create answered no projectId');
    }
    return created.projectId;
  });
}

async function resolveModel(
  ctx: OrgSeedContext,
  org: CreatedOrganization,
  cookie: string,
): Promise<string | null> {
  const body = (await withRetry(() =>
    ctx.http.json({
      method: 'GET',
      path: '/api/app/chat/composer/models',
      query: { orgId: org.id },
      cookie,
    }),
  )) as { models?: { id: string; providerSlug: string }[] };
  return pickChatModel(body.models ?? [], ctx.provider);
}

async function configureOne(
  ctx: OrgSeedContext,
  org: CreatedOrganization,
): Promise<
  Outcome<{ planned: PlanOrganization; warnings: OrganizationIssue[] }>
> {
  const warnings: OrganizationIssue[] = [];
  const warn = (stepName: string, text: string): void => {
    warnings.push({
      index: org.index,
      slug: org.slug,
      step: stepName,
      message: text,
    });
  };
  const cookie = await step(org, 'authenticate owner', () =>
    ctx.auth(org.ownerIndex),
  );
  if (!cookie.ok) return cookie;
  const c = cookie.value;

  const scaffold = await step(org, 'wait for scaffold', () =>
    waitForScaffold(ctx, org, c),
  );
  if (!scaffold.ok) return scaffold;
  if (scaffold.value.warning !== null)
    warn('wait for scaffold', scaffold.value.warning);

  const steps: [string, () => Promise<void>][] = [
    ['provider definition', () => ensureProviderDefinition(ctx, org, c)],
    ['provider credential', () => ensureCredential(ctx, org, c)],
    ['embedding model', () => ensureEmbedding(ctx, org, c)],
  ];
  for (const [name, run] of steps) {
    const done = await step(org, name, run);
    if (!done.ok) return done;
  }
  const project = await step(org, 'load project', () =>
    ensureProject(ctx, org, c),
  );
  if (!project.ok) return project;
  const model = await step(org, 'chat model', () => resolveModel(ctx, org, c));
  if (!model.ok) return model;
  if (model.value === null) {
    warn(
      'chat model',
      `the composer offers no model from "${ctx.provider.slug}" (is the mock serving ${ctx.provider.baseUrl}/models?)`,
    );
  }
  return {
    ok: true,
    value: {
      planned: {
        index: org.index,
        id: org.id,
        slug: org.slug,
        name: org.name,
        ownerIndex: org.ownerIndex,
        projectId: project.value,
        providerSlug: ctx.provider.slug,
        modelId: model.value,
      },
      warnings,
    },
  };
}

/**
 * Pass 2: configure every created organization; `onConfigured` sees each
 * finished one (the run checkpoints the plan from it).
 */
export async function configureOrganizations(
  ctx: OrgSeedContext,
  orgs: readonly CreatedOrganization[],
  onConfigured: (org: PlanOrganization) => void,
): Promise<{
  configured: PlanOrganization[];
  failures: OrganizationIssue[];
  warnings: OrganizationIssue[];
}> {
  const configured: PlanOrganization[] = [];
  const failures: OrganizationIssue[] = [];
  const warnings: OrganizationIssue[] = [];
  await mapLimit(orgs, ctx.concurrency, async (org) => {
    const outcome = await configureOne(ctx, org);
    if (outcome.ok) {
      configured.push(outcome.value.planned);
      warnings.push(...outcome.value.warnings);
      onConfigured(outcome.value.planned);
    } else {
      failures.push(outcome.issue);
    }
  });
  configured.sort((a, b) => a.index - b.index);
  return { configured, failures, warnings };
}
