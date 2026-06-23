import { v } from 'convex/values';

import {
  SSO_CONFIG_DOMAIN,
  SSO_CONNECTION_KEY,
  ssoConnectionFileSchema,
} from '../../lib/shared/schemas/enterprise_sso';
import { query } from '../_generated/server';

/**
 * Public login-page query: is sign-in SSO configured + enabled for this
 * deployment? Runs pre-auth (no identity), so it returns only the minimal,
 * non-sensitive shape the login screen needs to show the SSO entry point. The
 * connection config is file-based; this reads the first enabled connection from
 * the `configCache` mirror (domain `sso`, key `connection`).
 */
export const isConfigured = query({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    providerType: v.optional(v.string()),
    seamlessSsoEnabled: v.optional(v.boolean()),
  }),
  handler: async (ctx) => {
    for await (const row of ctx.db
      .query('configCache')
      .withIndex('by_domain_key', (q) =>
        q.eq('domain', SSO_CONFIG_DOMAIN).eq('key', SSO_CONNECTION_KEY),
      )) {
      if (row.enabled !== true) continue;
      const parsed = ssoConnectionFileSchema.safeParse(row.config);
      if (!parsed.success || !parsed.data.enabled) continue;
      return {
        enabled: true,
        providerType: parsed.data.oidc?.providerId ?? parsed.data.protocol,
        // Seamless (silent) SSO is now driven by a query param, not stored config.
        seamlessSsoEnabled: false,
      };
    }
    return { enabled: false };
  },
});
