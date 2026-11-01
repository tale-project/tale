'use node';

/**
 * The organization's own PII policy, applied to text before it is indexed.
 *
 * `'use node'` is load-bearing: `lib/pii` reaches `node:path`, and every file
 * under `convex/` is bundled for the V8 runtime unless it says otherwise —
 * regardless of who imports it. Without the directive the Convex deploy fails
 * with "Could not resolve node:path" and the whole app stops starting.
 *
 * ## Why the ingestion path needs this at all
 *
 * A document someone uploads was chosen: a person decided it belongs in the
 * system and knows what is in it. Content that arrives by email is the
 * opposite — a stranger decides what turns up, and a CV or a support message
 * is exactly where a national ID, a card number or a date of birth appears
 * unannounced. Indexing stores a processed derivative of that text and, unless
 * the organization runs a local embedding model, sends it to whichever provider
 * it configured.
 *
 * ## Why this is not a new judgement
 *
 * The policy is already the organization's, set in governance and applied today
 * to chat input: which patterns are enabled, which locales to load for the
 * address and national-ID composites, any custom patterns of their own, and
 * what happens on a match. This module reuses that policy rather than inventing
 * a second opinion about what counts as sensitive. An organization that has not
 * enabled it gets exactly today's behaviour.
 *
 * ## The modes, as they apply to indexing
 *
 * - `mask` — index the masked text. The stored chunks and the vectors never
 *   carry the identifier, and everything around it stays searchable.
 * - `block` — do not index. The file still appears in listings, which read
 *   `fileMetadata` rather than the index, so it stays visible as something that
 *   arrived; only its contents stay out.
 * - `tokenize` — treated as `mask`. Tokenizing keeps a per-message restore map
 *   so a reply can be detokenized back to real details; an indexed chunk
 *   outlives any such map, so restoring is meaningless here and keeping the
 *   indexed copy masked is the safe reading. The token indices (`[EMAIL_1]`)
 *   are numbered per scanned window, not per document — one address can be
 *   `[EMAIL_1]` in one window and `[EMAIL_2]` in the next — so they are
 *   placeholders, never a document-wide identity.
 *
 * ## A text the policy cannot scan is not indexed
 *
 * In every mode, under an enabled policy: when the policy's scrubber cannot
 * be built, and when a part of the text could not be scanned whole. Indexed
 * as it is, that text would carry what the policy exists to keep out —
 * the value `mask` should have masked, the document `block` should have
 * refused — to the embedding provider and into the index. The caller fails
 * the document with a cause of its own, apart from a detection, and saving
 * the policy queues it again.
 */

import { piiConfigSchema, type PiiConfig } from '@tale/shared/schemas/pii';

import {
  createScrubberFromConfig,
  scrubDocument,
  type Scrubber,
} from '../../../lib/pii';

/**
 * Why the policy could not scan a text: `unavailable` — its scrubber cannot
 * be built; `incomplete` — a part of the text could not be scanned whole.
 */
export type PiiScanFailure = 'unavailable' | 'incomplete';

export type PiiIngestDecision =
  | { readonly kind: 'index'; readonly text: string }
  | { readonly kind: 'refuse'; readonly categoryIds: readonly string[] }
  /** Not scanned, so not indexed — in every mode. */
  | { readonly kind: 'unscanned'; readonly cause: PiiScanFailure };

/**
 * Parse a stored policy record. A malformed or absent policy reads as "no
 * policy", which is today's behaviour — a bad governance row must not stop an
 * organization indexing its own documents.
 */
export function parsePiiConfig(raw: unknown): PiiConfig | null {
  if (raw === null || raw === undefined) return null;
  const value =
    typeof raw === 'object' && raw !== null && 'value' in raw ? raw.value : raw;
  const parsed = piiConfigSchema.safeParse(value);
  if (!parsed.success) {
    console.warn(
      `[pii-gate] ignoring unparseable pii_config: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
    );
    return null;
  }
  return parsed.data;
}

/**
 * One scrubber per distinct policy per process. Building one loads and
 * vets the data tree and compiles every enabled pattern — work the engine's
 * own contract says to pay once per config, not once per document as the
 * indexing worker otherwise would on every sync backlog. The key is the
 * policy's content, so an admin saving a change gets a fresh scrubber on
 * the next document; the data tree itself is baked into the image, so a
 * process never needs to notice it changing. Bounded so a stream of
 * distinct policies cannot grow it without limit.
 */
const scrubberCache = new Map<string, Scrubber | null>();
const SCRUBBER_CACHE_LIMIT = 32;
/**
 * Policies whose construction failure was already reported this process —
 * bounded like the cache, so a stream of distinct failing policies cannot
 * grow it without limit; an evicted policy simply reports once more.
 */
const reportedFailures = new Set<string>();

/** Drop the oldest entry once `entries` has reached the cache limit. */
function evictToLimit(entries: Map<string, unknown> | Set<string>): void {
  if (entries.size < SCRUBBER_CACHE_LIMIT) return;
  const oldest = entries.keys().next().value;
  if (oldest !== undefined) entries.delete(oldest);
}

function policyKey(config: PiiConfig): string {
  return JSON.stringify([
    config.enabled,
    config.mode,
    config.enabledPatterns,
    config.locales ?? null,
    config.customPatterns ?? null,
  ]);
}

/**
 * The scrubber for a policy — cached per distinct policy — null when the
 * policy is disabled, or `'unavailable'` when its scrubber cannot be built.
 * A failure is not cached: it is reported once per policy at error level (a
 * missing data tree is a packaging defect, not a per-document event) and
 * construction is retried on the next document, so a repaired tree heals
 * without a restart.
 */
export function scrubberForPolicy(
  config: PiiConfig,
): Scrubber | null | 'unavailable' {
  const key = policyKey(config);
  const cached = scrubberCache.get(key);
  if (cached !== undefined) return cached;

  let scrubber: Scrubber | null;
  try {
    scrubber = createScrubberFromConfig(config);
  } catch (error) {
    // `createScrubber` throws only on a programmer error or a missing data
    // tree, and the governance resolver filters the usual trigger (an
    // unknown locale code) before it gets here. Indexing unscrubbed would
    // hand what the policy keeps out to the embedding provider and the
    // index, so every document under this policy is refused until the
    // scrubber builds — and the fault is said once per policy, not once per
    // document.
    if (!reportedFailures.has(key)) {
      evictToLimit(reportedFailures);
      reportedFailures.add(key);
      console.error(
        `[pii-gate] scrubber construction failed, refusing to index under this policy until it succeeds: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return 'unavailable';
  }
  reportedFailures.delete(key);

  evictToLimit(scrubberCache);
  scrubberCache.set(key, scrubber);
  return scrubber;
}

/**
 * Apply a policy to text bound for the index.
 *
 * Returns the text to index, masked where the policy says so; a refusal
 * carrying the categories that matched; or `unscanned` when the policy could
 * not scan the text, whatever its mode. No policy, a disabled policy, or a
 * clean scan all return the text unchanged.
 */
export function applyPiiPolicyForIndexing(
  text: string,
  config: PiiConfig | null,
): PiiIngestDecision {
  if (config === null) return { kind: 'index', text };

  const scrubber = scrubberForPolicy(config);
  if (scrubber === null) return { kind: 'index', text };
  if (scrubber === 'unavailable') {
    return { kind: 'unscanned', cause: 'unavailable' };
  }

  // The scrubber is built WITH the policy's mode, so it answers `blocked` under
  // `block` and `modified` under `mask`/`tokenize`. Re-reading `config.mode`
  // here would be a second opinion about a decision the engine already made.
  //
  // Scanned as a document, not a message: `scrub` alone clamps its input to
  // the chat-sized byte cap, and an extracted document routinely runs past
  // it — indexing that output would drop the tail of the file and never look
  // at an identifier past the cap. `scrubDocument` windows the text under the
  // same clamp and joins the verdicts, so what is indexed is the whole text.
  const outcome = scrubDocument(scrubber, text);
  switch (outcome.kind) {
    case 'pass':
      return { kind: 'index', text };
    case 'modified':
      return { kind: 'index', text: outcome.text };
    case 'flagged':
      // Detected, deliberately not rewritten: the policy asked to be told, not
      // to change anything. There is no masked text, so the original indexes.
      return { kind: 'index', text };
    case 'blocked':
      return { kind: 'refuse', categoryIds: outcome.categoryIds };
    default:
      // A step error: a part of the text was not scanned whole, and what it
      // holds is unknown — even when every other part was masked, the
      // masked text would present that part as scanned. Not indexed in any
      // mode, and said per text with the engine's log-safe reason, never
      // the text.
      console.warn(`[pii-gate] scan failed (${outcome.reason}); not indexed`);
      return { kind: 'unscanned', cause: 'incomplete' };
  }
}
