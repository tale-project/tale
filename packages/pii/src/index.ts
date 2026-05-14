/**
 * @tale/pii — public API surface.
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
 *      For embedders that need to swap a built-in (e.g. a stricter email
 *      matcher) or add a domain-specific pattern (e.g. an API-key
 *      shape) without forking the library.
 *
 * Subpath imports (`@tale/pii/engine`, `@tale/pii/patterns`, …) remain
 * available for callers that need internals.
 */

// Pre-compiled instance (recommended shape).
export {
  createScrubber,
  type Scrubber,
  type ScrubberOptions,
  type PatternToggle,
} from './engine/scrubber';

// Stateless functions.
export { detectPii, dedupOverlaps } from './engine/detector';
export { maskPii } from './engine/masker';

// Reversible tokenization — for send-to-AI-then-restore round-trips.
// Distinct from `maskPii`: every replacement gets a stable indexed token
// (`[EMAIL_1]`) and a restore mapping, so the original PII can be put
// back when the AI's response is processed.
export {
  createTokenizer,
  tokenizePii,
  detokenizePii,
  type Tokenizer,
  type TokenizeResult,
  type TokenEntry,
  type TokenSegment,
} from './engine/tokenizer';

// Regex-safety primitives — exposed for embedders that compose their own
// guardrails alongside PII (e.g. chat-filter word lists, custom
// content-policy regex) and need the same ReDoS / size defenses.
export {
  clampMessage,
  escapeRegExp,
  execWithBudget,
  MAX_MESSAGE_BYTES,
  REGEX_EXEC_BUDGET_MS,
  type BudgetedMatch,
  type ClampResult,
} from './core/regex-safety';

// NFC + bidi-mark normalization — exposed so embedders can apply the same
// normalization to text before passing it through their own pipelines.
export { normalizeForDetection } from './core/normalize';

// Plugin / extension points.
export { PatternRegistry } from './engine/registry';
export {
  BUILT_IN_PATTERNS,
  BUILT_IN_PATTERN_NAMES,
  getEnabledPatterns,
  type BuiltInPatternName,
} from './patterns';

// Public types.
export type {
  PiiPattern,
  PiiPatternFactory,
  PiiMatch,
  PiiMatchSpan,
  LocaleCode,
} from './core/types';

// Outcome helpers — mirror the FilterOutcome contract so consumers can
// interop with other guardrails (chat_filter, moderation_provider).
export {
  pass,
  blocked,
  flagged,
  modified,
  type FilterOutcome,
  type FilterName,
  type GuardrailsDirection,
  type FilterPassOutcome,
  type FilterModifiedOutcome,
  type FilterFlaggedOutcome,
  type FilterBlockedOutcome,
  type FilterStepErrorOutcome,
} from './core/outcome';

// Locale registry — for opt-in address / national-id detection.
export {
  loadLocale,
  listLocales,
  resolveLocales,
  composeKeywordAlternation,
  type LocaleConfig,
  type LocaleAddressConfig,
  type NationalIdSpec,
  type AddressFormShape,
  type PostcodeForm,
  type Script,
} from './locales';

// Zod schemas — shared client + server validation for runtime configs.
export {
  piiConfigSchema,
  piiCustomPatternSchema,
  type PiiConfig,
  type PiiCustomPattern,
} from './schemas/config';
