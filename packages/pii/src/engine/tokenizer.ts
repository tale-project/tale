/**
 * `createTokenizer` — reversible PII tokenization for round-trips.
 *
 * Distinct from the masker:
 *   - `maskPii` replaces every PII match with a fixed token like `[EMAIL]`.
 *     One-way; the original is lost. Right for `mode: 'mask'` storage.
 *   - The tokenizer replaces each match with a **stable, indexed token**
 *     (`[EMAIL_1]`, `[PHONE_3]`, …) and keeps a mapping so the original
 *     PII can be restored on the way back. Right for "send-to-AI then
 *     restore" round-trips where the user wants the final response to
 *     read naturally with their original details intact.
 *
 * Mapping shape
 *   - Per-token entry: `{ value, type, start, end }`.
 *   - Token format: `[<TYPE>_<index>]`. Index is per-type, starting at 1.
 *     Two distinct emails get `[EMAIL_1]` and `[EMAIL_2]`. The same email
 *     appearing twice gets `[EMAIL_1]` both times (deduplication preserves
 *     reference identity across the prompt).
 *
 * Detokenizer
 *   - `detokenize(text, mapping)` replaces every occurrence of every
 *     token with its original value. Tolerates the AI omitting tokens,
 *     re-ordering them, or wrapping them in markdown (`**[EMAIL_1]**` →
 *     `**alice@example.com**`).
 *
 * Memory + lifecycle
 *   - The mapping is the only state. Hold it for the duration of one
 *     round-trip and discard. Persisting it long-term is a security
 *     anti-pattern — the whole point of tokenization is to avoid having
 *     PII in long-term AI logs.
 */

import { normalizeForDetection } from '../core/normalize';
import { MAX_MESSAGE_BYTES, clampMessage } from '../core/regex-safety';
import type { LocaleCode, PiiMatch, PiiPattern } from '../core/types';
import { resolveLocales, type LocaleConfig } from '../locales';
import { detectPii } from './detector';
import { PatternRegistry } from './registry';
import { type ScrubberOptions } from './scrubber';

/** One entry in the tokenizer's restore map. */
export interface TokenEntry {
  /** Original PII text — exactly the bytes the detector found. */
  value: string;
  /** Stable, human-readable type (`email`, `phone`, `address`, `cvc`, …). */
  type: string;
  /**
   * Index within the type — first email seen gets 1, second gets 2.
   * Same value seen twice keeps its first-assigned index.
   */
  index: number;
}

/** Output of one `.tokenize()` call. */
export interface TokenizeResult {
  /** Input text with PII replaced by indexed tokens. Safe to forward to an LLM. */
  text: string;
  /**
   * `token -> original` mapping. Hold it for the round-trip, then drop it.
   * Keys are exactly the tokens that appear in `text`.
   */
  mapping: Record<string, TokenEntry>;
  /**
   * Per-replacement details for UI rendering — every span the tokenizer
   * touched, in the original text's coordinate space (offsets refer to
   * the NFC-normalized input). The UI uses these to draw the highlight
   * overlays and tooltips.
   */
  segments: TokenSegment[];
  /** True if the input was clamped (over the byte budget). */
  truncated: boolean;
}

/**
 * UI-rendering helper: one detected span in the **original** text plus
 * the token it was rewritten to. Includes the original byte offsets so
 * the UI can render `<mark>` overlays on top of the user's input
 * verbatim.
 */
export interface TokenSegment {
  /** Original byte offset (UTF-16 code units, NFC-normalized text). */
  start: number;
  /** Original end offset. */
  end: number;
  /** Pattern name (`email`, `phone`, …). */
  type: string;
  /** Token that appears in the tokenized output (e.g. `[EMAIL_1]`). */
  token: string;
  /** The original PII text — same as `mapping[token].value`. */
  value: string;
}

export interface Tokenizer {
  /**
   * Detect PII in `text`, replace each match with a typed indexed token,
   * and return both the tokenized text and the restore mapping. Pure;
   * never throws.
   */
  tokenize(text: string): TokenizeResult;
  /**
   * Replace tokens in `text` with their original values. Tokens not
   * present in `mapping` (or that don't appear in the text) are
   * silently ignored.
   */
  detokenize(text: string, mapping: Record<string, TokenEntry>): string;
}

/**
 * Build a token for `(type, index)`. Format chosen to be:
 *   - Distinct from real PII shapes the detector matches (no plain
 *     square brackets in PII patterns).
 *   - Robust against LLMs that paraphrase punctuation (`[EMAIL_1]` is
 *     less likely to be rewritten than `<email>1</email>`).
 *   - Sortable + greppable when debugging.
 */
function makeToken(type: string, index: number): string {
  return `[${type.toUpperCase()}_${index}]`;
}

/**
 * Shared "iterate matches, dedup, splice indexed tokens" core used by
 * `createTokenizer().tokenize()` and the scrubber's `mode: 'tokenize'`
 * branch. Single source of truth for the `[TYPE_N]` token format so the
 * two paths can never drift apart.
 *
 * Dedup uses a two-level `Map<patternName, Map<matchedText, token>>`. The
 * previous flat `${patternName} ${matchedText}` key allocated hundreds of
 * bytes per match (matchedText can be a long IBAN / address); the nested
 * shape reuses the per-pattern inner map and keys it by the raw matched
 * string directly — smaller keys, fewer string allocations.
 *
 * Matches are expected start-ascending (the contract `detectPii` returns
 * after `dedupOverlaps`). We splice end-to-start by walking the array in
 * reverse — no sort needed.
 *
 * Returns the rewritten text, the `token -> entry` mapping, and the
 * per-match segments (in original coordinate space) for UI overlay
 * rendering. Callers that only need the text discard the rest.
 */
interface ApplyTokenizationResult {
  text: string;
  mapping: Record<string, TokenEntry>;
  segments: TokenSegment[];
}

export function applyTokenization(
  text: string,
  matches: ReadonlyArray<PiiMatch>,
): ApplyTokenizationResult {
  const mapping: Record<string, TokenEntry> = {};
  // Two-level dedup: per-pattern -> per-matched-text -> token. Avoids the
  // long composite-string key allocation the flat Map shape forced.
  const byType = new Map<string, Map<string, string>>();
  const perTypeCounter = new Map<string, number>();
  const segments: TokenSegment[] = [];

  // Walk ascending so token IDs are assigned in detection order:
  // `[EMAIL_1]` is the first email seen, `[EMAIL_2]` the second, etc.
  for (const m of matches) {
    let inner = byType.get(m.patternName);
    if (!inner) {
      inner = new Map<string, string>();
      byType.set(m.patternName, inner);
    }
    let token = inner.get(m.matchedText);
    if (!token) {
      const nextIndex = (perTypeCounter.get(m.patternName) ?? 0) + 1;
      perTypeCounter.set(m.patternName, nextIndex);
      token = makeToken(m.patternName, nextIndex);
      inner.set(m.matchedText, token);
      mapping[token] = {
        value: m.matchedText,
        type: m.patternName,
        index: nextIndex,
      };
    }
    segments.push({
      start: m.start,
      end: m.end,
      type: m.patternName,
      token,
      value: m.matchedText,
    });
  }

  // Single-pass O(n) forward build — same approach as `maskPii`. Walk
  // matches ascending (the order `detectPii` guarantees after dedup),
  // push interleaved text slices and tokens into `parts`, then join once.
  // The previous end-to-start splice loop allocated a new string per
  // match — O(matches * text_length).
  const parts: string[] = [];
  let cursor = 0;
  for (const m of matches) {
    const token = byType.get(m.patternName)?.get(m.matchedText);
    if (!token) continue;
    parts.push(text.slice(cursor, m.start), token);
    cursor = m.end;
  }
  parts.push(text.slice(cursor));
  const out = parts.join('');

  return { text: out, mapping, segments };
}

/**
 * Materialize the pattern factories enabled in `options` against the
 * given locale set. Mirrors the scrubber's logic — kept here so the
 * tokenizer is a peer of `createScrubber`, not a wrapper. The result is
 * a `PiiMatch[]`-producing function the tokenizer calls per `tokenize`.
 */
function buildPatterns(options: ScrubberOptions): {
  patterns: PiiPattern[];
  locales: LocaleConfig[];
} {
  const registry = options.registry ?? PatternRegistry.fromDefaults();
  const localeSelector = collectLocaleSelector(options);
  const locales = resolveLocales(localeSelector);

  const patterns: PiiPattern[] = [];
  for (const [name, toggle] of Object.entries(options.patterns)) {
    if (!toggle) continue;
    const factory = registry.get(name);
    if (!factory) continue;
    try {
      patterns.push(...factory(locales));
    } catch (err) {
      console.warn(
        `[pii] tokenizer factory "${name}" threw: ${
          err instanceof Error ? err.name : 'unknown'
        }`,
      );
    }
  }
  return { patterns, locales };
}

/**
 * Resolve the locale selector by unioning every locale-aware pattern's
 * `{ locales }` setting.
 *
 * INTENTIONAL DUPLICATION: This is a copy of the identically-named
 * function in `scrubber.ts`. The tokenizer is a peer of the scrubber,
 * not a wrapper. Sharing the helper would force an import from
 * `scrubber.ts` that couples the two modules and risks a circular
 * dependency once the scrubber imports `applyTokenization` from here.
 * If the logic changes, update both copies.
 */
function collectLocaleSelector(options: ScrubberOptions): LocaleCode[] | '*' {
  const seen = new Set<string>();
  let wildcard = false;
  for (const toggle of Object.values(options.patterns)) {
    if (!toggle) continue;
    if (toggle === true) {
      wildcard = true;
      break;
    }
    if (typeof toggle === 'object') {
      if (toggle.locales === '*') {
        wildcard = true;
        break;
      }
      for (const code of toggle.locales) seen.add(code);
    }
  }
  if (wildcard) return '*';
  return [...seen];
}

export function createTokenizer(options: ScrubberOptions): Tokenizer {
  const { patterns } = buildPatterns(options);
  const maxBytes = options.maxBytes ?? MAX_MESSAGE_BYTES;

  function tokenize(text: string): TokenizeResult {
    if (patterns.length === 0) {
      return { text, mapping: {}, segments: [], truncated: false };
    }
    const normalized = normalizeForDetection(text);
    const { text: clamped, truncated } = clampMessage(normalized, maxBytes);
    const matches = detectPii(clamped, patterns);
    if (matches.length === 0) {
      return { text: clamped, mapping: {}, segments: [], truncated };
    }

    // Delegate to the shared core so the scrubber `mode: 'tokenize'`
    // path and this tokenizer cannot drift apart on token format.
    const {
      text: out,
      mapping,
      segments,
    } = applyTokenization(clamped, matches);
    return { text: out, mapping, segments, truncated };
  }

  function detokenize(
    text: string,
    mapping: Record<string, TokenEntry>,
  ): string {
    // Fast empty check without allocating a keys array.
    let hasKeys = false;
    for (const _ in mapping) {
      hasKeys = true;
      break;
    }
    if (!hasKeys) return text;
    // Replace each token globally. The AI may have moved tokens around,
    // duplicated them, or wrapped them in markup; that all survives a
    // pure literal-string replace.
    let out = text;
    for (const [token, entry] of Object.entries(mapping)) {
      // `split + join` is the fastest cross-platform global literal
      // replace; `replaceAll` is identical in semantics but slightly
      // slower on V8 for short keys.
      out = out.split(token).join(entry.value);
    }
    return out;
  }

  return { tokenize, detokenize };
}

/**
 * Utility for callers that don't want to spin up a tokenizer instance.
 * One-shot detect-and-tokenize using the default pattern registry + the
 * passed `patterns` toggle map.
 */
export function tokenizePii(
  text: string,
  options: ScrubberOptions,
): TokenizeResult {
  return createTokenizer(options).tokenize(text);
}

/**
 * Inverse of `tokenizePii` — one-shot detokenize. Symmetric API for
 * callers using the stateless form.
 */
export function detokenizePii(
  text: string,
  mapping: Record<string, TokenEntry>,
): string {
  // Inline body so this doesn't allocate a Tokenizer just to call
  // `detokenize` (memory-conscious).
  // Fast empty check without allocating a keys array.
  let hasKeys = false;
  for (const _ in mapping) {
    hasKeys = true;
    break;
  }
  if (!hasKeys) return text;
  let out = text;
  for (const [token, entry] of Object.entries(mapping)) {
    out = out.split(token).join(entry.value);
  }
  return out;
}
