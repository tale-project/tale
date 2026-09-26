import { parseRunStarter } from '../run-starter.ts';

// Synthetic agentSlug sentinels for ledger rows that have no real assistant
// owning the call. The governance/usage aggregation buckets each kind under
// its own sentinel so the Top Assistants table renders precise labels
// instead of collapsing everything into a single fallback.
const DIRECT_API_SLUG = '__direct_api__';
const CONNECTOR_SLUG = '__connector__';
export const TRANSCRIPTION_SLUG = '__transcription__';
export const TTS_SLUG = '__tts__';
// The feedback / chat-health ranking key for a row with no agent attribution
// (arena rows, legacy pre-attribution rows). Distinct from the usage-page
// sentinels above so the tables can label it differently; the backend
// reducers and the analytics pages share this one declaration.
export const UNATTRIBUTED_AGENT_SLUG = '__unattributed__';

// The ledger's `user_id` for spend that no PERSON is responsible for: a
// managed agent turn of an automation run that a trigger (schedule, webhook,
// event) started. Every other row names a member by bare user id. The read
// sides treat this subject as a bucket, never as a user: the usage page
// labels its row, the active-user count skips it, and the budget gate binds
// only the organization's caps (and a key's, were one involved) to it.
export const AUTOMATION_SUBJECT_ID = '__automation__';

export function isAutomationSubject(userId: string): boolean {
  return userId === AUTOMATION_SUBJECT_ID;
}

/**
 * The subject a ledger row's `user_id` names. Every lane books a bare user id
 * (or the automation sentinel) today, but rows the workflow lane wrote before
 * it derived the person from the run's starter carry the door forms verbatim
 * (`user:<id>`, `api-key:<id>`, `trigger:<id>`). History is not rewritten;
 * every reader folds those rows onto the person (or the sentinel for a
 * trigger) so one member is one row and one cap, whichever door booked it.
 * An unknown form stays as booked.
 */
export function usageLedgerSubject(userId: string): string {
  const starter = parseRunStarter(userId);
  switch (starter.kind) {
    case 'user':
    case 'api-key':
      return starter.userId;
    case 'trigger':
      return AUTOMATION_SUBJECT_ID;
    case 'unknown':
      return userId;
  }
}

/** Every `user_id` value a person's spend may be booked under — the bare id
 * and the legacy door forms — for a SQL `= ANY(...)` over the ledger. */
export function usageLedgerSubjectForms(userId: string): string[] {
  return [userId, `user:${userId}`, `api-key:${userId}`];
}

type UsageRowKind = 'llm' | 'connector' | 'transcription' | 'tts';

// Subset of usageLedger fields needed to classify a row by kind. Kept
// intentionally narrow so client and server code can share the helper without
// pulling in Convex schema types.
interface UsageLedgerDiscriminators {
  agentSlug?: string;
  model?: string;
  provider?: string;
  connectorName?: string;
  audioDurationSec?: number;
  characterCount?: number;
}

// Classify a usageLedger row by precedence over its natural discriminators.
// Order matters: connectorName beats audioDurationSec because a hypothetical
// audio-bearing connector is still a connector row first. TTS rows are
// identified by `characterCount` alone — character-billing is unique to TTS
// in the current schema, so the discriminator works regardless of whether
// the row carries the synthetic `TTS_SLUG` (legacy) or a real assistant
// `agentSlug` (post per-assistant-attribution).
//
// A discriminator counts only when it is a positive quantity: the ledger's
// upsert used to stamp `0` (never NULL) on `audio_duration_sec` and
// `character_count` the moment a bucket took its second request, so nearly
// every LLM bucket carries `0` seconds and `0` characters. A row with no
// audio is not a transcription; a row with no characters is not speech.
export function classifyUsageRow(row: UsageLedgerDiscriminators): UsageRowKind {
  if (row.connectorName !== undefined) return 'connector';
  if (row.audioDurationSec !== undefined && row.audioDurationSec > 0) {
    return 'transcription';
  }
  if (row.characterCount !== undefined && row.characterCount > 0) return 'tts';
  return 'llm';
}

// Resolve the bucket key for Top Assistants. TTS rows always bucket under
// the `TTS_SLUG` sentinel regardless of any stored `agentSlug` so voice
// cost surfaces as its own Top Assistants row instead of silently folding
// into the calling agent's row (this also routes pre-change historical
// TTS rows correctly without a backfill). For other kinds, prefer the
// real `agentSlug` when present and fall back to the kind sentinel.
export function bucketAgentSlug(
  row: UsageLedgerDiscriminators,
  kind: UsageRowKind = classifyUsageRow(row),
): string {
  if (kind === 'tts') return TTS_SLUG;
  if (row.agentSlug !== undefined && row.agentSlug !== '') return row.agentSlug;
  switch (kind) {
    case 'connector':
      return CONNECTOR_SLUG;
    case 'transcription':
      return TRANSCRIPTION_SLUG;
    case 'llm':
      return DIRECT_API_SLUG;
  }
}

export function isDirectApiSlug(slug: string): boolean {
  return slug === DIRECT_API_SLUG;
}

export function isConnectorSlug(slug: string): boolean {
  return slug === CONNECTOR_SLUG;
}

export function isTranscriptionSlug(slug: string): boolean {
  return slug === TRANSCRIPTION_SLUG;
}

export function isTtsSlug(slug: string): boolean {
  return slug === TTS_SLUG;
}

// True for any sentinel slug — used by the UI to suppress drilldown click
// affordance on rows that don't represent a real agent.
export function isSyntheticAgentSlug(slug: string): boolean {
  return (
    isDirectApiSlug(slug) ||
    isConnectorSlug(slug) ||
    isTranscriptionSlug(slug) ||
    isTtsSlug(slug)
  );
}
