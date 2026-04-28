// Sentinel agentSlug for ledger rows produced by the OpenAI-compat
// direct-model API, which has no assistant context. The governance/usage
// aggregation buckets these rows under this key so the Top Assistants
// table can render a precise "Direct API" label instead of a fallback.
export const DIRECT_API_SLUG = '__direct_api__';

export function isDirectApiSlug(slug: string): boolean {
  return slug === DIRECT_API_SLUG;
}
