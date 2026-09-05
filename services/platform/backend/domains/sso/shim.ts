import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  buildSamlAuthnRedirectImpl,
  validateSamlResponseImpl,
} from '../../core/enterprise_sso/saml/validate_assertion.ts';
import type { ShimHandlers } from '../../lib/ctx-shim.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  readSsoSecrets,
  resolveSamlConfig,
  resolveSignInConfig,
} from './config.ts';
import { createSamlRequestCache } from './saml-request-cache.ts';
import { handleSsoLogin } from './service.ts';

/** The identity every protocol hands to provisioning (`HandleSsoLoginArgs`);
 * `accessToken` may be empty — SAML carries none. */
const handleSsoLoginArgs = z.object({
  email: z.string().min(1),
  name: z.string(),
  externalId: z.string().min(1),
  providerId: z.string().min(1),
  jobTitle: z.string().optional(),
  appRoles: z.array(z.string()).optional(),
  groups: z.array(z.string()).optional(),
  rawClaims: z.record(z.string(), z.unknown()).optional(),
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  accessTokenExpiresAt: z.number().optional(),
  scope: z.string().optional(),
  organizationId: z.string().min(1),
});

/**
 * Shim handlers for the REUSED 0.4 SSO protocol handlers (OIDC authorize/
 * callback, SAML login/ACS/metadata): every `ctx.run*` those
 * handlers make, answered from the 0.5 config files + PG services. The
 * fail-loud shim guarantees any new ctx dependency surfaces in integration.
 */
export function ssoShimHandlers(sql: Sql): ShimHandlers {
  // Issued AuthnRequest IDs, shared across instances through PG — the seam
  // that makes a SAMLResponse's InResponseTo verifiable (and one-time-use)
  // wherever it lands.
  const samlRequestCache = createSamlRequestCache(sql);
  return {
    'enterprise_sso/internal_queries:resolveSignInConfig': async (raw) => {
      const args = z
        .object({ organizationId: z.string().optional() })
        .parse(raw);
      return resolveSignInConfig(sql, args.organizationId);
    },
    'enterprise_sso/internal_queries:resolveSamlConfig': async (raw) => {
      const args = z
        .object({ organizationId: z.string().optional() })
        .parse(raw);
      return resolveSamlConfig(sql, args.organizationId);
    },
    'enterprise_sso/config/file_actions:getConnectionSecrets': async (raw) => {
      const args = z.object({ organizationId: z.string() }).parse(raw);
      return readSsoSecrets(sql, args.organizationId);
    },
    'enterprise_sso/internal_actions:handleSsoLogin': async (raw) => {
      // The protocol handlers assemble this from IdP output; 0.4's Convex
      // validator rejected a bad shape at this boundary and the 0.5 port
      // must too — an undefined email otherwise reaches `.toLowerCase()`
      // and the raw TypeError lands on the login page and in the audit row.
      const parsed = handleSsoLoginArgs.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `SSO identity payload rejected: ${z.prettifyError(parsed.error)}`,
        );
      }
      return handleSsoLogin(sql, parsed.data);
    },
    'enterprise_sso/saml/validate_assertion:validateSamlResponse': async (
      raw,
    ) => {
      const args =
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reused ACS handler assembles exactly this arg shape
        raw as Parameters<typeof validateSamlResponseImpl>[0];
      return validateSamlResponseImpl(args, {
        cacheProvider: samlRequestCache,
      });
    },
    'enterprise_sso/saml/validate_assertion:buildSamlAuthnRedirect': async (
      raw,
    ) => {
      const args =
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reused login handler assembles exactly this arg shape
        raw as Parameters<typeof buildSamlAuthnRedirectImpl>[0];
      return buildSamlAuthnRedirectImpl(args, {
        cacheProvider: samlRequestCache,
      });
    },
    'audit_logs/internal_mutations:createAuditLog': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the 0.4 audit writer arg shape matches the 0.5 service input
      const args = raw as Parameters<typeof createAuditLog>[1];
      await sql.begin((tx) => createAuditLog(tx, args));
      return null;
    },
  };
}
