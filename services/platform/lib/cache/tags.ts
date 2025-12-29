/**
 * Cache tag naming convention for consistent cache invalidation.
 *
 * Tags follow a hierarchical pattern:
 * - `org:{id}` - All data for an organization
 * - `org:{id}:{resource}` - Specific resource type (products, customers, etc.)
 * - `org:{id}:{resource}:exists` - Existence checks for two-phase loading
 * - `translations` / `translations:{namespace}` - Translation strings
 */
export const cacheTags = {
  /** All cached data for an organization */
  org: (orgId: string) => `org:${orgId}`,

  /** Specific resource type within an organization */
  orgResource: (orgId: string, resource: string) => `org:${orgId}:${resource}`,

  /** Existence check for a resource (used in two-phase loading) */
  orgResourceExists: (orgId: string, resource: string) =>
    `org:${orgId}:${resource}:exists`,

  /** Translation strings cache */
  translations: (namespace?: string) =>
    namespace ? `translations:${namespace}` : 'translations',
} as const;

/** Resource types for type-safe cache invalidation */
export type CacheResource =
  | 'products'
  | 'customers'
  | 'documents'
  | 'vendors'
  | 'websites'
  | 'tone-of-voice'
  | 'automations'
  | 'conversations'
  | 'approvals';
