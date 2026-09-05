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
 *   indexed copy masked is the safe reading.
 */

import {
  createScrubberFromConfig,
  scrubDocument,
  type Scrubber,
} from '../../../lib/pii';
import {
  piiConfigSchema,
  type PiiConfig,
} from '../../../lib/shared/schemas/pii';

export type PiiIngestDecision =
  | { readonly kind: 'index'; readonly text: string }
  | { readonly kind: 'refuse'; readonly categoryIds: readonly string[] };

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
/** Policies whose construction failure was already reported this process. */
const reportedFailures = new Set<string>();

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
 * The scrubber for a policy — cached per distinct policy — or null when the
 * policy is disabled or its scrubber cannot be built. A failure is not
 * cached: it is reported once per policy at error level (a missing data
 * tree is a packaging defect, not a per-document event) and construction is
 * retried on the next document, so a repaired tree heals without a restart.
 */
export function scrubberForPolicy(config: PiiConfig): Scrubber | null {
  const key = policyKey(config);
  const cached = scrubberCache.get(key);
  if (cached !== undefined) return cached;

  let scrubber: Scrubber | null;
  try {
    scrubber = createScrubberFromConfig(config);
  } catch (error) {
    // `createScrubber` throws only on a programmer error or a missing data
    // tree, and the governance resolver filters the usual trigger (an
    // unknown locale code) before it gets here. Failing the index would take
    // an organization's whole corpus offline over a governance typo, so it
    // degrades to today's behaviour and says so — once.
    if (!reportedFailures.has(key)) {
      reportedFailures.add(key);
      console.error(
        `[pii-gate] scrubber construction failed, indexing unscrubbed until it succeeds: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return null;
  }
  reportedFailures.delete(key);

  if (scrubberCache.size >= SCRUBBER_CACHE_LIMIT) {
    const oldest = scrubberCache.keys().next().value;
    if (oldest !== undefined) scrubberCache.delete(oldest);
  }
  scrubberCache.set(key, scrubber);
  return scrubber;
}

/**
 * Apply a policy to text bound for the index.
 *
 * Returns the text to index, masked where the policy says so, or a refusal
 * carrying the categories that matched. No policy, a disabled policy, or a
 * clean scan all return the text unchanged.
 */
export function applyPiiPolicyForIndexing(
  text: string,
  config: PiiConfig | null,
): PiiIngestDecision {
  if (config === null) return { kind: 'index', text };

  const scrubber = scrubberForPolicy(config);
  if (scrubber === null) return { kind: 'index', text };

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
      // A step error. The scan is fail-open by design, so this indexes as it
      // would have before the policy existed — and says so, because a
      // document indexed unscanned is a governance fact, not a quiet default.
      console.warn(
        `[pii-gate] scan failed (${outcome.reason}); indexing unscrubbed`,
      );
      return { kind: 'index', text };
  }
}
