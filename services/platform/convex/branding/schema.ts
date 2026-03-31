import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/** @deprecated Images now stored on filesystem. Retained for backward compatibility with existing data. */
export const brandingBindingsTable = defineTable({
  organizationId: v.string(),
  logoStorageId: v.optional(v.id('_storage')),
  faviconLightStorageId: v.optional(v.id('_storage')),
  faviconDarkStorageId: v.optional(v.id('_storage')),
}).index('by_organizationId', ['organizationId']);

/** @deprecated Retained for backward compatibility with existing data. */
export const brandingSettingsLegacyTable = defineTable({
  organizationId: v.string(),
  appName: v.optional(v.string()),
  textLogo: v.optional(v.string()),
  logoStorageId: v.optional(v.id('_storage')),
  faviconLightStorageId: v.optional(v.id('_storage')),
  faviconDarkStorageId: v.optional(v.id('_storage')),
  brandColor: v.optional(v.string()),
  accentColor: v.optional(v.string()),
  updatedAt: v.number(),
}).index('by_organizationId', ['organizationId']);
