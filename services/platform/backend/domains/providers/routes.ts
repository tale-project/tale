import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';

import type { Auth } from '../../auth/auth.ts';
import { isAdminOrDeveloperRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { getProviderCatalog } from '../../core/lib/providers/catalog_fetch.ts';
import { credentialAuthFor } from '../../core/lib/providers/credential_auth.ts';
import {
  deriveHarnessStatus,
  type SubscriptionCredentialFact,
} from '../../core/lib/providers/harness_status.ts';
import {
  loadHarnesses,
  readSystemEntryIcon,
} from '../../core/lib/providers/load_system_config.ts';
import { resolveProvidersForOrg } from '../../core/lib/providers/org_providers.ts';
import { resolveOrgVisionModel } from '../../core/lib/providers/resolve_vision_model.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { listComposerModels } from '../chat/composer.ts';
import { governanceShimHandlers } from '../governance/shim.ts';
import { knowledgeShimHandlers } from '../knowledge/service.ts';
import { listCredentials } from '../provider_credentials/service.ts';

/**
 * /api/app/providers — the AI-providers SETTINGS surface (the 0.4
 * `lib/providers/*` actions): the per-provider model catalogs (live sources
 * read-through), a force refresh, the managed-harness status matrix, and the
 * resolved vision-model pick. Non-secret capability metadata throughout —
 * credential SHAPES and counts, never material. Admin/developer-gated like
 * the credentials pages it sits beside.
 */

export function createProviderSettingRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const requireDeveloper = (c: Context<OrgEnv>): Response | null =>
    isAdminOrDeveloperRole(c.get('orgMember').role)
      ? null
      : c.json({ error: 'FORBIDDEN' }, 403);

  const orgSlugOf = async (c: Context<OrgEnv>): Promise<string | null> =>
    resolveOrgSlug(deps.sql, c.get('orgId'));

  app.get('/catalogs', async (c) => {
    const denied = requireDeveloper(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const results = [];
    for (const provider of resolveProvidersForOrg(orgSlug)) {
      let models: unknown[] = [];
      let catalogError: string | undefined;
      try {
        models = [...(await getProviderCatalog(provider))];
      } catch (error) {
        catalogError = error instanceof Error ? error.message : String(error);
        console.warn(
          `[catalog] listing for ${provider.name} unavailable:`,
          error,
        );
      }
      const iconUrl = readSystemEntryIcon('providers', provider.name);
      results.push({
        name: provider.name,
        displayName: provider.displayName,
        ...(iconUrl !== undefined ? { iconUrl } : {}),
        apiFormat: provider.apiFormat,
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
      });
    }
    return c.json({ catalogs: results });
  });

  app.post('/catalogs/refresh', async (c) => {
    const denied = requireDeveloper(c);
    if (denied) return denied;
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const results = [];
    for (const provider of resolveProvidersForOrg(orgSlug)) {
      if (
        provider.catalog.source === 'static' ||
        provider.catalog.source === 'none'
      ) {
        continue;
      }
      try {
        const entries = await getProviderCatalog(provider, {
          forceRefresh: true,
        });
        results.push({ name: provider.name, modelCount: entries.length });
      } catch (error) {
        results.push({
          name: provider.name,
          modelCount: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return c.json({ results });
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
        };
        return typeof candidate.id === 'string' &&
          (candidate.credential?.authMethod === 'api-key' ||
            candidate.credential?.authMethod === 'env')
          ? { id: candidate.id }
          : null;
      })
      .filter((entry): entry is { id: string } => entry !== null);
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
