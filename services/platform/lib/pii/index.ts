/**
 * The pii library — public surface.
 *
 * Pattern and locale DEFINITIONS live as data in
 * `configs/platform/system/pii/{patterns,locales}/`; which of them an org
 * enables is the `pii_config` governance policy
 * (`lib/shared/schemas/pii.ts`). This library is the engine between the
 * two:
 *
 *  1. Hot path — `createScrubber(options).scrub(text)`: patterns resolve
 *     and compile once at construction; per-message work is regex
 *     execution only. `scrubDocument(scrubber, text)` runs the same
 *     scrubber over text of any length in clamp-sized windows.
 *  2. Round-trips — `createTokenizer(options)`: indexed tokens
 *     (`[EMAIL_1]`) with a restore mapping, so model output detokenizes
 *     back to the user's original details.
 *  3. Stateless helpers — `detectPii` / `maskPii` for tests and one-off
 *     calls.
 *  4. Extension — `PatternRegistry.fromDefaults().override(…).add(…)` for
 *     swapping a built-in or adding embedder patterns.
 *  5. Governance — `resolveScrubberOptions` / `createScrubberFromConfig`
 *     turn a validated org policy into a running scrubber.
 */

export { normalizeForDetection } from './core/normalize';
export {
  blocked,
  flagged,
  modified,
  pass,
  type FilterOutcome,
  type GuardrailsDirection,
} from './core/outcome';
export {
  MAX_MESSAGE_BYTES,
  REGEX_EXEC_BUDGET_MS,
  clampMessage,
} from './core/regex-safety';
export type {
  LocaleCode,
  PiiMatch,
  PiiPattern,
  PiiPatternFactory,
} from './core/types';
export { loadPiiData, type PiiData } from './data/loader';
export { detectPii } from './engine/detector';
export {
  scrubDocument,
  splitIntoWindows,
  type ScrubDocumentOptions,
} from './engine/document';
export { maskPii } from './engine/masker';
export type { PatternToggle, ScrubberOptions } from './engine/options';
export { PatternRegistry } from './engine/registry';
export { createScrubber, type Scrubber } from './engine/scrubber';
export {
  applyTokenization,
  createTokenizer,
  type TokenEntry,
  type TokenizeResult,
  type Tokenizer,
} from './engine/tokenizer';
export {
  createScrubberFromConfig,
  resolveScrubberOptions,
} from './resolve-config';
export {
  localeConfigSchema,
  piiPatternFileSchema,
  type LocaleConfig,
  type NationalIdSpec,
  type PiiPatternFile,
} from './schema';
