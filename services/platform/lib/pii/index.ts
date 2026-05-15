/**
 * PII detection library — public surface (`@/lib/pii`).
 *
 * Internal platform library used by the chat guardrails dispatcher
 * (`convex/governance/*`) and the admin PII configuration panel.
 *
 * Three entry shapes are exposed:
 *
 *   1. Pre-compiled instance — `createScrubber({...}).scrub(text)`.
 *      Pattern set is resolved once at instance creation; subsequent
 *      calls skip pattern compilation. Use this on hot paths
 *      (per-message guardrails) — it is the recommended shape for
 *      production.
 *
 *   2. Stateless functions — `detectPii`, `maskPii`. For tests,
 *      debugging, and one-off uses where a long-lived instance is
 *      overkill.
 *
 *   3. Plugin extension — `PatternRegistry.fromDefaults().override(...).add(...)`.
 *      Lets callers swap a built-in (e.g. a stricter email matcher) or
 *      add a domain-specific pattern (e.g. an API-key shape) without
 *      forking the engine.
 *
 * Sub-module imports (`@/lib/pii/engine`, `@/lib/pii/patterns/names`,
 * `@/lib/pii/schemas/config`, …) remain available for callers that want
 * to skip the barrel and pay only the cost of the slice they use.
 */

// Pre-compiled scrubber instance — recommended for hot paths.
export { createScrubber, type Scrubber } from './engine/scrubber';

// Stateless helpers — kept for tests and one-off detection calls.
export { detectPii } from './engine/detector';
export { maskPii } from './engine/masker';

// Reversible tokenization — for send-to-AI-then-restore round-trips.
// Distinct from `maskPii`: every replacement gets a stable indexed
// token (`[EMAIL_1]`) and a restore mapping, so the original PII can be
// put back when the AI's response is processed.
export {
  createTokenizer,
  type TokenEntry,
  type TokenizeResult,
  type Tokenizer,
} from './engine/tokenizer';

// Regex-safety primitive — used by `chat_filter` to clamp inputs before
// scanning. The rest of the regex-safety module is consumed via the
// dedicated `./core/regex-safety` subpath import.
export { clampMessage } from './core/regex-safety';

// Plugin / extension point. Used by tests and any embedder that needs
// to layer custom patterns over the built-ins.
export { PatternRegistry } from './engine/registry';

// Outcome helpers — mirror the FilterOutcome contract so consumers can
// interop with other guardrails (chat_filter, moderation_provider).
export {
  blocked,
  flagged,
  modified,
  pass,
  type FilterOutcome,
  type GuardrailsDirection,
} from './core/outcome';

// Locale registry — for opt-in address / national-id detection.
export { listLocales, loadLocale } from './locales';

// Zod config schema — shared validator for runtime PII configs.
export { piiConfigSchema, type PiiConfig } from './schemas/config';
