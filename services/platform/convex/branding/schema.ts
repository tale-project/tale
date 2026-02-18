import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const brandingSettingsTable = defineTable({
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
