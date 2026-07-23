'use node';

/**
 * The one place the OAuth2 routes learn a vendor's endpoints: the shipped
 * connector file, read at request time.
 *
 * `configs/platform/system/integrations/<slug>/connector.yml` declares the
 * `oauth2` auth entry (`authorizeUrl`, `tokenUrl`, `scopes`), and that file is
 * the only truth for it. Copying a vendor URL into TypeScript would create a
 * second source that silently disagrees with the catalog the settings UI and
 * the engine read — so nothing here hardcodes an endpoint, a scope, or a
 * connector name; the roster of OAuth2 connectors is whatever the catalog says
 * it is.
 *
 * The filesystem is unreachable from the V8 HTTP-action runtime, so this is a
 * `'use node'` action the handlers call through the scheduler seam. Root
 * resolution follows the convention the provider system-config loader
 * established: an explicit root wins, otherwise walk up from the working
 * directory to the checkout's `configs/platform/system`.
 */

import { v } from 'convex/values';

import { findIntegrationConnector } from '../../lib/integrations/catalog';
import { internalAction } from '../_generated/server';

/**
 * Connector slugs are directory names, so the shape is checked before any
 * lookup — the catalog's own slug rule (lower-case kebab), which admits no
 * separator, no dot, and no NUL.
 */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface Oauth2Endpoints {
  /** The connector's catalog display name — the credential's human label. */
  readonly displayName: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scopes: readonly string[];
}

/**
 * The connector's declared OAuth2 endpoints, or `null` when the slug is not a
 * shipped connector or the connector offers no `oauth2` auth method. `root`
 * overrides the system-config tree (tests point it at a fixture).
 */
export function readOauth2Endpoints(
  connectorSlug: string,
  options: { root?: string } = {},
): Oauth2Endpoints | null {
  if (!SLUG_RE.test(connectorSlug)) return null;

  const connector = findIntegrationConnector(connectorSlug, options);
  if (!connector) return null;

  const oauth2 = connector.auth.find((entry) => entry.method === 'oauth2');
  if (!oauth2) return null;
  return {
    displayName: connector.displayName,
    authorizeUrl: oauth2.authorizeUrl,
    tokenUrl: oauth2.tokenUrl,
    scopes: oauth2.scopes,
  };
}

/**
 * Node-side seam for the V8 HTTP actions. Returns `null` for an unknown
 * connector or one without an `oauth2` method — the handlers turn that into a
 * "this connector cannot be connected with OAuth" refusal rather than a 500.
 */
export const getOauth2Endpoints = internalAction({
  args: { connectorSlug: v.string() },
  returns: v.union(
    v.object({
      displayName: v.string(),
      authorizeUrl: v.string(),
      tokenUrl: v.string(),
      scopes: v.array(v.string()),
    }),
    v.null(),
  ),
  handler: async (_ctx, args) => {
    const endpoints = readOauth2Endpoints(args.connectorSlug);
    if (!endpoints) return null;
    return {
      displayName: endpoints.displayName,
      authorizeUrl: endpoints.authorizeUrl,
      tokenUrl: endpoints.tokenUrl,
      scopes: [...endpoints.scopes],
    };
  },
});
