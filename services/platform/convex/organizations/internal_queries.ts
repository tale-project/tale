/**
 * Internal queries for organization metadata.
 */

import { v } from 'convex/values';

import { defaultLocale as appDefaultLocale } from '../../lib/i18n/config';
import { clampToSupportedLocale } from '../../lib/shared/utils/get-organization-default-locale';
import { isRecord } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { internalQuery } from '../_generated/server';

/**
 * Reads the org's `defaultLocale` metadata field and clamps it to a
 * supported agent locale. Falls back to the app-level default when unset
 * or stale. Used by the chat pipeline to resolve locale-specific agent
 * content (systemInstructions + delegation scaffold) at invocation time.
 */
export const getOrganizationDefaultLocale = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'organization',
      where: [{ field: '_id', value: args.organizationId, operator: 'eq' }],
    });
    if (!org || !isRecord(org)) return appDefaultLocale;

    let metadata = org.metadata;
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch {
        return appDefaultLocale;
      }
    }
    if (!isRecord(metadata)) return appDefaultLocale;
    return clampToSupportedLocale(metadata.defaultLocale);
  },
});
