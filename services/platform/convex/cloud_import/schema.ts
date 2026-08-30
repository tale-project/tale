import { v } from 'convex/values';
/**
 * Cloud providers a member may authorize for Knowledge import/sync.
 * Distinct from org connectors (shared credentials) and from login identity.
 */
export const cloudImportProviderValidator = v.union(
  v.literal('onedrive'),
  v.literal('google-drive'),
);

export type CloudImportProvider = 'onedrive' | 'google-drive';
