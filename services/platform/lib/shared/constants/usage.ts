// Synthetic agentSlug sentinels for ledger rows that have no real assistant
// owning the call. The governance/usage aggregation buckets each kind under
// its own sentinel so the Top Assistants table renders precise labels
// instead of collapsing everything into a single fallback.
const DIRECT_API_SLUG = '__direct_api__';
export const INTEGRATION_SLUG = '__integration__';
export const TRANSCRIPTION_SLUG = '__transcription__';

type UsageRowKind = 'llm' | 'integration' | 'transcription';

// Subset of usageLedger fields needed to classify a row by kind. Kept
// intentionally narrow so client and server code can share the helper without
// pulling in Convex schema types.
interface UsageLedgerDiscriminators {
  agentSlug?: string;
  model?: string;
  provider?: string;
  integrationName?: string;
  audioDurationSec?: number;
}

// Classify a usageLedger row by precedence over its natural discriminators.
// Order matters: integrationName beats audioDurationSec because a hypothetical
// audio-bearing integration is still an integration row first.
export function classifyUsageRow(row: UsageLedgerDiscriminators): UsageRowKind {
  if (row.integrationName !== undefined) return 'integration';
  if (row.audioDurationSec !== undefined) return 'transcription';
  return 'llm';
}

// Resolve the bucket key for Top Assistants. Returns the real agentSlug when
// present, else the kind-appropriate sentinel so legacy rows (and any future
// edge case) still get attributed to the right category instead of collapsing
// into a generic fallback.
export function bucketAgentSlug(
  row: UsageLedgerDiscriminators,
  kind: UsageRowKind = classifyUsageRow(row),
): string {
  if (row.agentSlug !== undefined && row.agentSlug !== '') return row.agentSlug;
  switch (kind) {
    case 'integration':
      return INTEGRATION_SLUG;
    case 'transcription':
      return TRANSCRIPTION_SLUG;
    case 'llm':
      return DIRECT_API_SLUG;
  }
}

export function isDirectApiSlug(slug: string): boolean {
  return slug === DIRECT_API_SLUG;
}

export function isIntegrationSlug(slug: string): boolean {
  return slug === INTEGRATION_SLUG;
}

export function isTranscriptionSlug(slug: string): boolean {
  return slug === TRANSCRIPTION_SLUG;
}

// True for any sentinel slug — used by the UI to suppress drilldown click
// affordance on rows that don't represent a real agent.
export function isSyntheticAgentSlug(slug: string): boolean {
  return (
    isDirectApiSlug(slug) ||
    isIntegrationSlug(slug) ||
    isTranscriptionSlug(slug)
  );
}
