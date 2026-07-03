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
    multiple: v.optional(v.boolean()),
  }),
  handler: async (ctx) => {
    let first: { providerType?: string } | null = null;
    let enabledCount = 0;
    for await (const row of ctx.db
      .query('configCache')
      .withIndex('by_domain_key', (q) =>
        q.eq('domain', SSO_CONFIG_DOMAIN).eq('key', SSO_CONNECTION_KEY),
      )) {
      if (row.enabled !== true) continue;
      const parsed = ssoConnectionFileSchema.safeParse(row.config);
      if (!parsed.success || !parsed.data.enabled) continue;
      enabledCount += 1;
      first ??= {
        providerType: parsed.data.oidc?.providerId ?? parsed.data.protocol,
      };
      if (enabledCount > 1) break;
    }
    if (!first) return { enabled: false };
    return {
      enabled: true,
      providerType: first.providerType,
      // Seamless (silent) SSO is now driven by a query param, not stored config.
      seamlessSsoEnabled: false,
      // With several orgs' connections enabled, sign-in must be routed by the
      // organization email — the login page asks for it before redirecting.
      multiple: enabledCount > 1,
    };
  },
});

/** Practical cap for the login-page picker — also bounds what an anonymous
 *  visitor can enumerate in one query. */
const MAX_SELECTABLE_CONNECTIONS = 20;

/**
 * Public login-page query: the enabled connections WITHOUT an email domain.
 * Email routing can never reach them (matching is by exact domain), so the SSO
 * step lists them for manual selection instead of dead-ending. Deliberate
 * disclosure: their display names are visible pre-auth — setting a domain on a
 * connection removes it from this list, so the operator controls the exposure.
 */
export const listSelectable = query({
  args: {},
  returns: v.array(
    v.object({
      organizationId: v.string(),
      displayName: v.string(),
      protocol: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const selectable: {
      organizationId: string;
      displayName: string;
      protocol: string;
    }[] = [];
    for await (const row of ctx.db
      .query('configCache')
      .withIndex('by_domain_key', (q) =>
        q.eq('domain', SSO_CONFIG_DOMAIN).eq('key', SSO_CONNECTION_KEY),
      )) {
      if (row.enabled !== true) continue;
      const parsed = ssoConnectionFileSchema.safeParse(row.config);
      if (!parsed.success || !parsed.data.enabled || !parsed.data.protocol) {
        continue;
      }
      if (parsed.data.domain) continue;
      selectable.push({
        organizationId: row.organizationId,
        displayName: parsed.data.displayName,
        protocol: parsed.data.protocol,
      });
      if (selectable.length >= MAX_SELECTABLE_CONNECTIONS) break;
    }
    return selectable;
  },
});
