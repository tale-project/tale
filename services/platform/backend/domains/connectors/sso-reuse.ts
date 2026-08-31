import type { Sql } from 'postgres';

import {
  EntraIssuerError,
  extractTenantId,
} from '../../../convex/enterprise_sso/entra_id/constants.ts';
import { readSsoConnection, readSsoSecrets } from '../sso/config.ts';

/**
 * The Enterprise-SSO side of "reuse the Entra app registration for Microsoft
 * 365 import". An org whose sign-in is Microsoft Entra ID already gave tale a
 * vendor app (client id + secret in the SSO secrets sidecar, tenant embedded
 * in the issuer) — this resolves that registration so an admin can copy it
 * into the `onedrive` cloud-import OAuth app row with one deliberate click.
 *
 * Deliberately NOT a resolve-time fallback in `resolveCloudImportApp`: the
 * SSO registration only works for import once the admin has added the
 * cloud-import redirect URI and the Graph file permissions in Entra, so a
 * silent reuse would fail mid-consent with AADSTS50011 instead of failing
 * here as configuration. Copy semantics, not a live link — the OAuth app row
 * stays the single truth, and rotating the SSO secret means re-copying.
 */

export type EntraSsoUnavailableReason =
  | 'no_sso'
  | 'not_entra'
  | 'missing_credentials'
  | 'bad_issuer';

export type EntraSsoSource =
  | { ok: true; clientId: string; clientSecret: string; tenantId: string }
  | { ok: false; reason: EntraSsoUnavailableReason };

/**
 * The org's active Entra ID sign-in registration, or the reason there is
 * none to reuse. `clientSecret` is for the server-side copy only — a route
 * serving the probe must project it away.
 */
export async function resolveEntraSsoSource(
  sql: Sql,
  organizationId: string,
): Promise<EntraSsoSource> {
  const conn = await readSsoConnection(sql, organizationId);
  // `protocol` guards against a stale `oidc` block left behind by an org
  // that later moved its sign-in to SAML.
  if (
    !conn ||
    !conn.config.enabled ||
    !conn.config.oidc ||
    conn.config.protocol !== 'oidc'
  ) {
    return { ok: false, reason: 'no_sso' };
  }
  if (conn.config.oidc.providerId !== 'entra-id') {
    return { ok: false, reason: 'not_entra' };
  }
  let tenantId: string;
  try {
    tenantId = extractTenantId(conn.config.oidc.issuer);
  } catch (error) {
    if (error instanceof EntraIssuerError) {
      console.warn(
        `[connectors:sso-reuse] org ${organizationId} Entra issuer is not usable as a tenant: ${error.message}`,
      );
      return { ok: false, reason: 'bad_issuer' };
    }
    throw error;
  }
  const secrets = await readSsoSecrets(sql, organizationId);
  const clientId = secrets.clientId?.trim();
  const clientSecret = secrets.clientSecret?.trim();
  if (!clientId || !clientSecret) {
    return { ok: false, reason: 'missing_credentials' };
  }
  return { ok: true, clientId, clientSecret, tenantId };
}
