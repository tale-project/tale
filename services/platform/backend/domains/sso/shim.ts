import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  buildSamlAuthnRedirectImpl,
  validateSamlResponseImpl,
} from '../../core/enterprise_sso/saml/validate_assertion.ts';
import type { ShimHandlers } from '../../lib/ctx-shim.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  discoverByEmail,
  readSsoSecrets,
  resolveProvisioning,
  resolveSamlConfig,
  resolveSignInConfig,
} from './config.ts';
import { createSamlRequestCache } from './saml-request-cache.ts';
import { handleSsoLogin } from './service.ts';

/**
 * Shim handlers for the REUSED 0.4 SSO protocol handlers (OIDC authorize/
 * callback, SAML login/ACS/metadata, discover): every `ctx.run*` those
 * handlers make, answered from the 0.5 config files + PG services. The
 * fail-loud shim guarantees any new ctx dependency surfaces in integration.
 */
export function ssoShimHandlers(sql: Sql): ShimHandlers {
  // Issued AuthnRequest IDs, shared across instances through PG — the seam
  // that makes a SAMLResponse's InResponseTo verifiable (and one-time-use)
  // wherever it lands.
  const samlRequestCache = createSamlRequestCache(sql);
  return {
    'enterprise_sso/internal_queries:discoverByEmail': async (raw) => {
      const args = z.object({ email: z.string() }).parse(raw);
      return discoverByEmail(sql, args.email);
    },
    'enterprise_sso/internal_queries:resolveSignInConfig': async (raw) => {
      const args = z
        .object({ organizationId: z.string().optional() })
        .parse(raw);
      return resolveSignInConfig(sql, args.organizationId);
    },
    'enterprise_sso/internal_queries:resolveProvisioning': async (raw) => {
      const args = z.object({ organizationId: z.string() }).parse(raw);
      return resolveProvisioning(sql, args.organizationId);
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
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reused handlers assemble exactly this arg shape
      return handleSsoLogin(sql, raw as Parameters<typeof handleSsoLogin>[1]);
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
