import {
  configurationHashSchema,
  expectedConfigurationHashSchema,
} from '@tale/shared/schemas/configuration';
import {
  providerDefinitionSchema,
  type ProviderDefinition,
} from '@tale/shared/schemas/providers';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { AppError } from '../../../lib/shared/errors/app-error.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { ConfigurationError } from '../../core/lib/config_store/precondition';
import {
  catalogFailureCode,
  getProviderCatalog,
} from '../../core/lib/providers/catalog_fetch.ts';
import { credentialAuthFor } from '../../core/lib/providers/credential_auth.ts';
import {
  deriveHarnessStatus,
  type SubscriptionCredentialFact,
} from '../../core/lib/providers/harness_status.ts';
import {
  loadHarnesses,
  loadProviderDefinitions,
  readSystemEntryIcon,
} from '../../core/lib/providers/load_system_config.ts';
import {
  loadOrgCustomProviderSnapshots,
  resolveProvidersForOrg,
} from '../../core/lib/providers/org_providers.ts';
import { inspectImageGenerationModels } from '../../core/lib/providers/resolve_image_model.ts';
import { inspectTranscriptionModels } from '../../core/lib/providers/resolve_transcription_model.ts';
import { resolveOrgVisionModel } from '../../core/lib/providers/resolve_vision_model.ts';
import { appErrorHandler } from '../../error-reporting';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { parseNativeJsonBody } from '../../lib/native-json-body.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { rateLimitedResponse } from '../../lib/rate-limit-response.ts';
import {
  checkUserRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import { listComposerModels } from '../chat/composer.ts';
import { governanceShimHandlers } from '../governance/shim.ts';
import { knowledgeShimHandlers } from '../knowledge/service.ts';
import {
  listCredentials,
  resolveCatalogBearer,
  resolveCredentialListingBearer,
} from '../provider_credentials/service.ts';
import {
  checkProviderDefinition,
  deleteProviderDefinition,
  readProviderDefinition,
  saveProviderDefinition,
} from './config';
import { mayManageProviders, refreshProviderCatalogs } from './management.ts';

/**
 * The body of a listing with a key the caller names: the provider — one the
 * organization resolves, by `name`, or a `definition` a dialog has not saved
 * yet — and, at most one of, the `secret` the dialog holds or the
 * `credentialId` of a saved credential of that provider. Neither: the listing
 * goes out without a key. The secret rides in this body only — never a URL,
 * a log line or a cache.
 */
const catalogCheckSchema = z
  .strictObject({
    name: z.string().min(1).max(64).optional(),
    definition: z.unknown().optional(),
    secret: z.string().trim().min(1).max(8192).optional(),
    credentialId: z.string().min(1).max(128).optional(),
  })
  .refine(
    (body) => (body.name === undefined) !== (body.definition === undefined),
  )
  .refine(
    (body) => body.secret === undefined || body.credentialId === undefined,
  )
  // A draft has no saved credential to name.
  .refine(
    (body) => body.definition === undefined || body.credentialId === undefined,
  );

/** The refusal a credential named for a listing answers with, by its code:
 * not this organization's, not this provider's, or not usable. */
function credentialRefusalStatus(code: string): 404 | 409 | 400 {
  if (code === 'CREDENTIAL_NOT_FOUND') return 404;
  if (code === 'CREDENTIAL_PROVIDER_MISMATCH') return 409;
  return 400;
}

/** The code of a credential refusal the resolver threw, else `undefined`. */
function credentialRefusalCode(error: unknown): string | undefined {
  if (!(error instanceof AppError)) return undefined;
  const data: unknown = error.data;
  return data !== null &&
    typeof data === 'object' &&
    'code' in data &&
    typeof data.code === 'string' &&
    data.code.startsWith('CREDENTIAL_')
    ? data.code
    : undefined;
}

/**
 * /api/app/providers — the AI-providers SETTINGS surface (the 0.4
 * `lib/providers/*` actions): the per-provider model catalogs (live sources
 * read-through), a force refresh, the managed-harness status matrix, and the
 * resolved vision/transcription/image-generation picks. Non-secret capability metadata throughout —
 * credential SHAPES and counts, never material. Admin/developer-gated like
 * the credentials pages it sits beside.
 */

export function createProviderSettingRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));
  // A definition — saved, or drafted for a listing — is a small document;
  // anything larger is refused before its body is read.
  const definitionBodyLimit = bodyLimit({
    maxSize: 256 * 1024,
    onError: (c) => c.json({ error: 'PROVIDER_DEFINITION_TOO_LARGE' }, 413),
  });
  app.use('/definitions/*', definitionBodyLimit);
  app.use('/catalog-check', definitionBodyLimit);

  const requireDeveloper = (c: Context<OrgEnv>): Response | null =>
    mayManageProviders(c.get('orgMember').role)
      ? null
      : c.json({ error: 'FORBIDDEN' }, 403);

  const orgSlugOf = async (c: Context<OrgEnv>): Promise<string | null> =>
    resolveOrgSlug(deps.sql, c.get('orgId'));

  app.onError((error, c) => {
    if (error instanceof ConfigurationError)
      return c.json(
        { error: error.code, message: error.message },
        error.status,
      );
    return appErrorHandler(error, c);
  });

  app.get('/definitions/:name', async (c) => {
    const denied = requireDeveloper(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    return c.json(await readProviderDefinition(orgSlug, c.req.param('name')));
  });

  app.put('/definitions/:name', async (c) => {
    const denied = requireDeveloper(c);
    if (denied) return denied;
    // JSON-only transport plus the native parser's duplicate-key refusal.
    const value = parseNativeJsonBody(await c.req.text());
    if (value === undefined)
      return c.json({ error: 'PROVIDER_DEFINITION_INVALID' }, 400);
    const body = z
      .strictObject({
        config: providerDefinitionSchema,
        expectedHash: expectedConfigurationHashSchema,
      })
      .safeParse(value);
    if (!body.success)
      return c.json(
        {
          error: 'PROVIDER_DEFINITION_INVALID',
          message: 'Invalid provider definition request.',
        },
        400,
      );
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    return c.json(
      await saveProviderDefinition(
        deps.sql,
        {
          organizationId: c.get('orgId'),
          orgSlug,
          userId: c.get('sessionBundle').user.id,
          email: c.get('sessionBundle').user.email,
        },
        c.req.param('name'),
        body.data.config,
        body.data.expectedHash,
      ),
    );
  });

  app.delete('/definitions/:name', async (c) => {
    const denied = requireDeveloper(c);
    if (denied) return denied;
    // An optional compare-and-set on the reviewed hash, like the PUT: a
    // dialog that loaded the definition deletes exactly what it showed.
    const rawHash = c.req.query('expectedHash');
    const expectedHash =
      rawHash === undefined
        ? undefined
        : configurationHashSchema.safeParse(rawHash);
    if (expectedHash !== undefined && !expectedHash.success)
      return c.json({ error: 'PROVIDER_DEFINITION_INVALID' }, 400);
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    await deleteProviderDefinition(
      deps.sql,
      {
        organizationId: c.get('orgId'),
        orgSlug,
        userId: c.get('sessionBundle').user.id,
        email: c.get('sessionBundle').user.email,
      },
      c.req.param('name'),
      expectedHash === undefined ? undefined : expectedHash.data,
    );
    return c.json({ ok: true });
  });

  app.get('/definitions/:name/catalog', async (c) => {
    const denied = requireDeveloper(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const { config } = await readProviderDefinition(
      orgSlug,
      c.req.param('name'),
    );
    if (config === null) return c.json({ error: 'PROVIDER_NOT_FOUND' }, 404);
    try {
      const bearerToken = await resolveCatalogBearer(
        deps.sql,
        c.get('orgId'),
        config,
      );
      return c.json({
        models: await getProviderCatalog(config, {
          forceRefresh: true,
          ...(bearerToken !== undefined ? { bearerToken } : {}),
        }),
      });
    } catch (error) {
      console.warn(
        `[catalog] check of ${config.name}'s listing failed:`,
        error instanceof Error ? error.message : error,
      );
      // A listing that answered with something other than a model list says
      // so by its code, which settings turns into the fix; anything else is
      // the catalog being unavailable.
      return c.json(
        {
          error: catalogFailureCode(error) ?? 'PROVIDER_CATALOG_UNAVAILABLE',
          message: 'The selected provider catalog is unavailable.',
        },
        502,
      );
    }
  });

  /**
   * One provider's live model listing, with the key the caller names rather
   * than the organization's default: the key typed into the dialog that is
   * setting the provider up (before anything is saved), or a saved
   * credential's — the row's **Check models**, an edit — default or not,
   * enabled or not. A key goes only to the provider's own `/models`; any
   * other source is read keyless, the ordinary cached way.
   * Fetched once and uncached: the answer is this caller's alone, never
   * served to another caller, organization or key, and a failure is not
   * remembered. A refused or missing key says which by its code
   * (`PROVIDER_CATALOG_KEY_REFUSED` / `PROVIDER_CATALOG_KEY_REQUIRED`).
   * Charged against the person's `provider:catalog-check` budget: every call
   * reaches the endpoint.
   */
  app.post('/catalog-check', async (c) => {
    const denied = requireDeveloper(c);
    if (denied) return denied;
    const body = catalogCheckSchema.safeParse(
      parseNativeJsonBody(await c.req.text()) ?? null,
    );
    if (!body.success)
      return c.json(
        {
          error: 'PROVIDER_DEFINITION_INVALID',
          message: 'Invalid catalog check request.',
        },
        400,
      );
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const organizationId = c.get('orgId');
    const { name, definition, secret, credentialId } = body.data;
    let provider: ProviderDefinition | undefined;
    if (name !== undefined) {
      provider = resolveProvidersForOrg(orgSlug).find(
        (entry) => entry.name === name,
      );
      if (provider === undefined)
        return c.json({ error: 'PROVIDER_NOT_FOUND' }, 404);
    } else {
      // Checked as its save would check it — shape, name, endpoint policy —
      // writing nothing.
      const draftName =
        definition !== null &&
        typeof definition === 'object' &&
        'name' in definition &&
        typeof definition.name === 'string'
          ? definition.name
          : '';
      provider = checkProviderDefinition(orgSlug, draftName, definition);
    }
    try {
      await checkUserRateLimit(
        deps.sql,
        'provider:catalog-check',
        c.get('sessionBundle').user.id,
      );
    } catch (error) {
      if (error instanceof RateLimitExceededError)
        return rateLimitedResponse(c, error);
      throw error;
    }
    // A key goes only to the provider's own `/models` endpoint — as
    // `resolveCatalogBearer` sends one. Any other source is a public listing
    // (OpenRouter's catalog, a static file) that takes no key: it is read
    // the ordinary way, shared and cached, and no key leaves for it.
    const keyed = provider.catalog.source === 'models-endpoint';
    let bearerToken: string | undefined = keyed ? secret : undefined;
    if (keyed && credentialId !== undefined) {
      try {
        bearerToken = await resolveCredentialListingBearer(
          deps.sql,
          organizationId,
          provider,
          credentialId,
        );
      } catch (error) {
        const code = credentialRefusalCode(error);
        if (code === undefined) throw error;
        return c.json({ error: code }, credentialRefusalStatus(code));
      }
    }
    try {
      return c.json(
        {
          models: await getProviderCatalog(
            provider,
            keyed
              ? {
                  uncached: true,
                  maxAttempts: 1,
                  ...(bearerToken !== undefined ? { bearerToken } : {}),
                }
              : {},
          ),
        },
        200,
        { 'cache-control': 'no-store' },
      );
    } catch (error) {
      // A listing failure's words name the status and whether a key went,
      // never the key; the endpoint's own answer stays out of the log too.
      console.warn(
        `[catalog] check of ${provider.name}'s listing with the named key failed:`,
        error instanceof Error ? error.message : error,
      );
      return c.json(
        {
          error: catalogFailureCode(error) ?? 'PROVIDER_CATALOG_UNAVAILABLE',
          message: 'The selected provider catalog is unavailable.',
        },
        502,
      );
    }
  });

  app.get('/catalogs', async (c) => {
    const denied = requireDeveloper(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const results = [];
    // The same union `resolveProvidersForOrg` serves, kept apart here so each
    // entry can say where it came from: the settings page lists and edits the
    // organization's own definitions, which the shipped set never includes.
    // Those carry the hash of the file their facts were read from: the edit
    // dialog shows these facts and saves against that version, so a
    // definition someone saved since is refused, never written over.
    const sources: {
      origin: 'shipped' | 'organization';
      providers: { provider: ProviderDefinition; hash?: string }[];
    }[] = [
      {
        origin: 'shipped',
        providers: loadProviderDefinitions().map((provider) => ({ provider })),
      },
      {
        origin: 'organization',
        providers: loadOrgCustomProviderSnapshots(orgSlug),
      },
    ];
    for (const { origin, providers } of sources)
      for (const { provider, hash } of providers) {
        let models: unknown[] = [];
        let catalogError: string | undefined;
        let catalogErrorCode: string | undefined;
        try {
          const bearerToken = await resolveCatalogBearer(
            deps.sql,
            c.get('orgId'),
            provider,
          );
          models = [
            ...(await getProviderCatalog(
              provider,
              bearerToken !== undefined ? { bearerToken } : {},
            )),
          ];
        } catch (error) {
          catalogError = error instanceof Error ? error.message : String(error);
          catalogErrorCode = catalogFailureCode(error);
          console.warn(
            `[catalog] listing for ${provider.name} unavailable:`,
            error,
          );
        }
        const iconUrl = readSystemEntryIcon('providers', provider.name);
        const subscriptionAuth = provider.auth.find(
          (entry) => entry.method === 'subscription-key',
        );
        const subscriptionAccountIdVar =
          subscriptionAuth?.method === 'subscription-key'
            ? subscriptionAuth.accountIdVar
            : undefined;
        results.push({
          name: provider.name,
          displayName: provider.displayName,
          origin,
          ...(iconUrl !== undefined ? { iconUrl } : {}),
          apiFormat: provider.apiFormat,
          ...(subscriptionAccountIdVar !== undefined
            ? { subscriptionAccountIdVar }
            : {}),
          ...(provider.baseUrl !== undefined
            ? { baseUrl: provider.baseUrl }
            : {}),
          ...(provider.endpointMode !== undefined
            ? { endpointMode: provider.endpointMode }
            : {}),
          catalogSource: provider.catalog.source,
          authMethods: provider.auth.map((entry) => entry.method),
          models,
          ...(catalogError !== undefined ? { catalogError } : {}),
          ...(catalogErrorCode !== undefined ? { catalogErrorCode } : {}),
          ...(hash !== undefined ? { definitionHash: hash } : {}),
        });
      }
    return c.json({ catalogs: results });
  });

  app.post('/catalogs/refresh', async (c) => {
    const denied = requireDeveloper(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    return c.json({
      results: await refreshProviderCatalogs(deps.sql, {
        organizationId: c.get('orgId'),
        orgSlug,
      }),
    });
  });

  app.get('/harness-status', async (c) => {
    const denied = requireDeveloper(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const organizationId = c.get('orgId');
    const listing = await listComposerModels(deps.sql, {
      organizationId,
      userId: c.get('sessionBundle').user.id,
    });
    // The composer rows carry their credential facts (the reused walker's
    // shape); only api-key/env credentials back the managed direct lane.
    const directModels = listing.models
      .map((model) => {
        if (model === null || typeof model !== 'object') return null;
        const candidate = model as {
          id?: unknown;
          credential?: { authMethod?: unknown };
          toolCallingApi?: unknown;
          anthropicApi?: unknown;
        };
        if (
          typeof candidate.id !== 'string' ||
          (candidate.credential?.authMethod !== 'api-key' &&
            candidate.credential?.authMethod !== 'env')
        ) {
          return null;
        }
        // A model whose tools need the Responses API counts only for a
        // harness that speaks it, and a model served through Anthropic's
        // API only for a harness that runs one.
        const direct: {
          id: string;
          toolCallingApi?: 'responses';
          anthropicApi?: true;
        } = { id: candidate.id };
        if (candidate.toolCallingApi === 'responses') {
          direct.toolCallingApi = 'responses';
        }
        if (candidate.anthropicApi === true) {
          direct.anthropicApi = true;
        }
        return direct;
      })
      .filter(
        (
          entry,
        ): entry is {
          id: string;
          toolCallingApi?: 'responses';
          anthropicApi?: true;
        } => entry !== null,
      );
    const credentials = await listCredentials(deps.sql, {
      organizationId,
      userId: c.get('sessionBundle').user.id,
      email: c.get('sessionBundle').user.email,
      role: c.get('orgMember').role,
    });
    const providers = resolveProvidersForOrg(orgSlug);
    const providerByName = new Map(
      providers.map((provider) => [provider.name, provider] as const),
    );
    const knownMethods = new Set([
      'api-key',
      'env',
      'subscription-key',
      'subscription-broker',
    ]);
    const subscriptions = credentials
      .filter(
        (credential) =>
          credential.status === 'active' &&
          knownMethods.has(credential.authMethod),
      )
      .flatMap((credential): SubscriptionCredentialFact[] => {
        const provider = providerByName.get(credential.providerSlug);
        if (!provider) return [];
        const auth = credentialAuthFor(
          provider,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- membership checked against knownMethods just above
          credential.authMethod as
            | 'api-key'
            | 'env'
            | 'subscription-key'
            | 'subscription-broker',
        );
        return auth?.authMethod === 'subscription-key' ||
          auth?.authMethod === 'subscription-broker'
          ? [{ providerSlug: credential.providerSlug, credential: auth }]
          : [];
      });
    return c.json({
      statuses: deriveHarnessStatus({
        harnesses: loadHarnesses(),
        directModels,
        subscriptions,
      }),
    });
  });

  app.get('/transcription-model', async (c) => {
    const denied = requireDeveloper(c);
    if (denied) return denied;
    c.header('Cache-Control', 'no-store');
    const shim = createCtxShim({
      ...knowledgeShimHandlers(deps.sql),
      ...governanceShimHandlers(deps.sql),
    });
    return c.json(
      await inspectTranscriptionModels(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the shared resolver's provider and policy reads are covered by these handlers
        shim as unknown as Parameters<typeof inspectTranscriptionModels>[0],
        c.get('orgId'),
      ),
    );
  });

  app.get('/image-generation-model', async (c) => {
    const denied = requireDeveloper(c);
    if (denied) return denied;
    c.header('Cache-Control', 'no-store');
    // The same admission a turn's `generate_image` grant applies, answered
    // without a secret: the picker can never offer a model the tool could
    // not call, and the settings page never learns a key.
    const shim = createCtxShim({
      ...knowledgeShimHandlers(deps.sql),
      ...governanceShimHandlers(deps.sql),
    });
    return c.json(
      await inspectImageGenerationModels(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the shared resolver's provider and policy reads are covered by these handlers
        shim as unknown as Parameters<typeof inspectImageGenerationModels>[0],
        c.get('orgId'),
      ),
    );
  });

  app.get('/vision-model', async (c) => {
    const denied = requireDeveloper(c);
    if (denied) return denied;
    const organizationId = c.get('orgId');
    try {
      // The `vision_model` pin is read through the one governance seam every
      // ctx-shim host shares (the policy reader over the org config tree),
      // not a local copy of it.
      const shim = createCtxShim({
        ...knowledgeShimHandlers(deps.sql),
        ...governanceShimHandlers(deps.sql),
      });
      const pick = await resolveOrgVisionModel(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 module; ctx usage covered by the shim handlers
        shim as unknown as Parameters<typeof resolveOrgVisionModel>[0],
        organizationId,
      );
      return c.json({ pick });
    } catch (error) {
      // Best-effort like the 0.4 read: an unreachable catalog reads as "no
      // vision model" rather than failing the settings page.
      console.warn('[vision-model] resolved-pick lookup failed:', error);
      return c.json({ pick: null });
    }
  });

  return app;
}
