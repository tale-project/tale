/**
 * Reversible tokenization — the round-trip counterpart to the one-way
 * masker.
 *
 * Where `maskPii` splices a fixed token (`[EMAIL]`) and discards the
 * original, the tokenizer splices STABLE INDEXED tokens (`[EMAIL_1]`,
 * `[PHONE_3]`) and returns a restore mapping, so the model's reply can be
 * detokenized back to the user's original details. The same value seen
 * twice keeps its first token — reference identity survives across the
 * prompt.
 *
 * The token format `[TYPE_N]` is chosen to be distinct from every real
 * PII shape the detector matches, robust against models paraphrasing
 * punctuation, and greppable when debugging. `applyTokenization` is the
 * single source of truth for it — the scrubber's `mode: 'tokenize'`
 * branch runs through the same function, so the two paths cannot drift.
 *
 * The mapping is the only state: hold it for one round-trip, then drop
 * it. Persisting it defeats the purpose — the point of tokenizing is
 * keeping PII out of long-term AI logs.
 */

import { normalizeForDetection } from '../core/normalize';
import { MAX_MESSAGE_BYTES, clampMessage } from '../core/regex-safety';
import type { PiiMatch } from '../core/types';
import { detectPii } from './detector';
import { materializePatterns } from './materialize';
import type { ScrubberOptions } from './options';

/** One entry in the restore map. */
export interface TokenEntry {
  /** Original PII text — exactly what the detector matched. */
  value: string;
  /** Pattern name (`email`, `phone`, `de-steuer-id`, …). */
  type: string;
  /** Per-type index; the first email seen is 1, the second 2. */
  index: number;
}

/**
 * One rewritten span in the ORIGINAL (normalized) coordinate space — what
 * a UI needs to draw highlight overlays over the user's input.
 */
export interface TokenSegment {
  start: number;
  end: number;
  type: string;
  token: string;
  value: string;
}

export interface TokenizeResult {
  /** Input with PII replaced by indexed tokens. Safe to forward to a model. */
  text: string;
  /** `token -> entry` restore map; keys are exactly the tokens in `text`. */
  mapping: Record<string, TokenEntry>;
  /** Per-replacement details for UI rendering. */
  segments: TokenSegment[];
  /** True when the input was clamped before scanning. */
  truncated: boolean;
}

export interface Tokenizer {
  /** Detect, splice indexed tokens, return text + restore map. Never throws. */
  tokenize(text: string): TokenizeResult;
  /**
   * Replace every mapped token with its original value. Tokens missing
   * from the text (or mapping) are ignored — models may drop, reorder,
   * duplicate, or wrap tokens in markup, and all of that survives a
   * literal replace.
   */
  detokenize(text: string, mapping: Record<string, TokenEntry>): string;
}

function makeToken(type: string, index: number): string {
  return `[${type.toUpperCase()}_${index}]`;
}

interface ApplyTokenizationResult {
  text: string;
  mapping: Record<string, TokenEntry>;
  segments: TokenSegment[];
}

/**
 * The shared tokenization core. Matches must be ascending and
 * non-overlapping (the `detectPii` contract). Dedup is a two-level
 * `Map<patternName, Map<matchedText, token>>` — keying by the raw matched
 * string avoids allocating long composite keys per match. The rewritten
 * text is assembled in one forward pass, like the masker.
 */
export function applyTokenization(
  text: string,
  matches: ReadonlyArray<PiiMatch>,
): ApplyTokenizationResult {
  const mapping: Record<string, TokenEntry> = {};
  const byType = new Map<string, Map<string, string>>();
  const perTypeCounter = new Map<string, number>();
  const segments: TokenSegment[] = [];

  // Ascending walk assigns token ids in detection order: [EMAIL_1] is the
  // first email seen.
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

  const parts: string[] = [];
  let cursor = 0;
  for (const m of matches) {
    const token = byType.get(m.patternName)?.get(m.matchedText);
    if (!token) continue;
    parts.push(text.slice(cursor, m.start), token);
    cursor = m.end;
  }
  parts.push(text.slice(cursor));

  return { text: parts.join(''), mapping, segments };
}

export function createTokenizer(options: ScrubberOptions): Tokenizer {
  // The same resolution the scrubber runs — one pattern list for both
  // entry points, custom patterns included.
  const { patterns } = materializePatterns(options);
  const maxBytes = options.maxBytes ?? MAX_MESSAGE_BYTES;

  function tokenize(text: string): TokenizeResult {
    if (patterns.length === 0) {
      return { text, mapping: {}, segments: [], truncated: false };
    }
    const normalized = normalizeForDetection(text);
    const { text: clamped, truncated } = clampMessage(normalized, maxBytes);
    const matches = detectPii(clamped, patterns, options.perPatternBudgetMs);
    if (matches.length === 0) {
      return { text: clamped, mapping: {}, segments: [], truncated };
    }

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
    let out = text;
    for (const [token, entry] of Object.entries(mapping)) {
      // split+join is the portable global literal replace — no regex
      // escaping concerns for token strings containing brackets.
      out = out.split(token).join(entry.value);
    }
    return out;
  }

  return { tokenize, detokenize };
}
