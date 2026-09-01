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
 * The reader itself lives in `lib/connectors/catalog.ts` and is shared with
 * the engine registry, the OAuth routes, and the settings surface, so a
 * connector cannot look valid to one of them and invalid to another. This
 * module re-exports it under the names this domain calls, and hosts the ONE
 * public catalog listing the connectors settings page reads (`listConnectors`).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  connectorBearerScheme,
  findConnector,
  loadConnectorDefinitions,
  resolveConnectorsDir,
  type LoadConnectorCatalogOptions,
} from '../../lib/connectors/catalog';
import type { ConnectorAuthMethod } from './types';

export { connectorBearerScheme, findConnector, loadConnectorDefinitions };
export type { LoadConnectorCatalogOptions };

/** One shipped connector as the settings catalog lists it. Mirrors
 * `ConnectorSummary` in the app's `connectors/hooks/backend.ts`. */
interface ConnectorSummary {
  slug: string;
  displayName: string;
  description: string;
  tags: string[];
  endpointMode: 'fixed' | 'per-credential';
  authMethods: ConnectorAuthMethod[];
  /**
   * The connector's non-secret per-credential settings, as declared. The create
   * form has to RENDER these: `createCredential` validates the submitted config
   * against them and refuses a missing required field, so a form that cannot
   * collect them cannot author a credential for any connector declaring one.
   * Not secret — labels, types and defaults from the shipped connector.
   */
  configFields: Array<{
    key: string;
    label: string;
    type: 'string' | 'number' | 'boolean';
    description?: string;
    required: boolean;
    enum?: string[];
    default?: string | number | boolean;
  }>;
  actionCount: number;
  iconUrl?: string;
}

/**
 * The connector's shipped `icon.svg` as an inline data URL, or `undefined`
 * when it ships none. Served inline rather than over a static route: the SVGs
 * are a few KB, identical for every organization, and read from the same
 * config tree the catalog itself resolves — so the listing needs no extra
 * HTTP surface and the UI falls back to a placeholder when a connector ships
 * no icon.
 */
function readConnectorIcon(
  connectorsDir: string,
  slug: string,
): string | undefined {
  const file = path.join(connectorsDir, slug, 'icon.svg');
  if (!existsSync(file)) return undefined;
  try {
    const svg = readFileSync(file, 'utf8');
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  } catch (err) {
    console.warn(
      `[connectors] icon.svg for connector "${slug}" is present but unreadable: ${
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
 * surface: the connectors settings page fronting it is developer-gated.
 */
/** The settings-page catalog rows — pure file read, shared with the 0.5
 * backend's route (which owns its own auth gate). */
export function listConnectorSummaries(): ConnectorSummary[] {
  const connectorsDir = resolveConnectorsDir();
  const summaries: ConnectorSummary[] = [];
  for (const connector of loadConnectorDefinitions()) {
    // Platform-auth connectors are the platform's own capabilities — there
    // is nothing to connect, so the settings list never offers them.
    if (connector.auth.some((method) => method.method === 'platform')) {
      continue;
    }
    const summary: ConnectorSummary = {
      slug: connector.name,
      displayName: connector.displayName,
      description: connector.description,
      tags: connector.tags,
      endpointMode: connector.endpointMode,
      // `platform` was excluded above, so the storable-method narrowing is
      // a fact, not a hope.
      authMethods: connector.auth
        .map((method) => method.method)
        .filter((method) => method !== 'platform'),
      configFields: connector.configFields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        ...(field.description !== undefined && {
          description: field.description,
        }),
        ...(field.enum !== undefined && { enum: field.enum }),
        ...(field.default !== undefined && { default: field.default }),
      })),
      actionCount: connector.actions.length,
    };
    const iconUrl = readConnectorIcon(connectorsDir, connector.name);
    if (iconUrl !== undefined) summary.iconUrl = iconUrl;
    summaries.push(summary);
  }
  return summaries;
}
