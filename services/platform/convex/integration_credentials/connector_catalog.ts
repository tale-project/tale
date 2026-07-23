'use node';

/**
 * The shipped connector catalog, as this domain uses it.
 *
 * A credential is only meaningful against a connector: the connector decides
 * which auth methods exist (`auth[]`), whether each credential carries its own
 * API origin (`endpointMode`), and which `Authorization` scheme a bearer token
 * is sent under. Both the write paths (`actions.ts`) and the resolution seam
 * (`resolve_credential.ts`) read those facts from here.
 *
 * The reader itself lives in `lib/integrations/catalog.ts` and is shared with
 * the engine registry, the OAuth routes, and the settings surface, so a
 * connector cannot look valid to one of them and invalid to another. This
 * module re-exports it under the names this domain calls, and hosts the ONE
 * public catalog listing the integrations settings page reads (`listConnectors`).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { type Infer, v } from 'convex/values';

import {
  connectorBearerScheme,
  findIntegrationConnector,
  loadIntegrationConnectors,
  resolveIntegrationsDir,
  type LoadConnectorCatalogOptions,
} from '../../lib/integrations/catalog';
import { action } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { integrationAuthMethodValidator } from './schema';

export {
  connectorBearerScheme,
  findIntegrationConnector,
  loadIntegrationConnectors,
};
export type { LoadConnectorCatalogOptions };

/** One shipped connector as the settings catalog lists it. Mirrors
 * `IntegrationConnectorSummary` in the app's `integrations/hooks/backend.ts`. */
const connectorSummaryValidator = v.object({
  slug: v.string(),
  displayName: v.string(),
  description: v.string(),
  tags: v.array(v.string()),
  endpointMode: v.union(v.literal('fixed'), v.literal('per-credential')),
  authMethods: v.array(integrationAuthMethodValidator),
  actionCount: v.number(),
  iconUrl: v.optional(v.string()),
});

type ConnectorSummary = Infer<typeof connectorSummaryValidator>;

/**
 * The connector's shipped `icon.svg` as an inline data URL, or `undefined`
 * when it ships none. Served inline rather than over a static route: the SVGs
 * are a few KB, identical for every organization, and read from the same
 * config tree the catalog itself resolves — so the listing needs no extra
 * HTTP surface and the UI falls back to a placeholder when a connector ships
 * no icon.
 */
function readConnectorIcon(
  integrationsDir: string,
  slug: string,
): string | undefined {
  const file = path.join(integrationsDir, slug, 'icon.svg');
  if (!existsSync(file)) return undefined;
  try {
    const svg = readFileSync(file, 'utf8');
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  } catch (err) {
    console.warn(
      `[integrations] icon.svg for connector "${slug}" is present but unreadable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return undefined;
  }
}

/**
 * The shipped connectors as the settings page lists them — slug, display copy,
 * grouping tags, endpoint mode, accepted auth methods (in declaration order),
 * action count, and an inline icon. Non-secret and identical across
 * organizations, but org-scoped and gated like the rest of the domain's action
 * surface: the integrations settings page fronting it is developer-gated.
 */
export const listConnectors = action({
  args: { organizationId: v.string() },
  returns: v.array(connectorSummaryValidator),
  handler: async (ctx, args) => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const integrationsDir = resolveIntegrationsDir();
    const summaries: ConnectorSummary[] = [];
    for (const connector of loadIntegrationConnectors()) {
      const summary: ConnectorSummary = {
        slug: connector.name,
        displayName: connector.displayName,
        description: connector.description,
        tags: connector.tags,
        endpointMode: connector.endpointMode,
        authMethods: connector.auth.map((method) => method.method),
        actionCount: connector.actions.length,
      };
      const iconUrl = readConnectorIcon(integrationsDir, connector.name);
      if (iconUrl !== undefined) summary.iconUrl = iconUrl;
      summaries.push(summary);
    }
    return summaries;
  },
});
