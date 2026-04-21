import type { ChatFilterCategory } from '../../../lib/shared/schemas/governance';
import {
  clampMessage,
  escapeRegExp,
  execWithBudget,
  MAX_MESSAGE_BYTES,
} from '../regex_safety';

export interface ChatFilterMatch {
  categoryId: string;
  kind: 'word' | 'pattern';
  patternName?: string;
  start: number;
  end: number;
  matchedText: string;
}

export interface ChatFilterDetection {
  matches: ChatFilterMatch[];
  truncated: boolean;
}

/**
 * Unicode-script detection for word-boundary strategy. In scripts without
 * inter-word spacing (Han, Hiragana, Katakana, Hangul, Thai, Lao) JS's `\b`
 * fails completely because `\b` only anchors on ASCII word chars. For these
 * we fall back to substring matching. Latin-script words use a Unicode-aware
 * lookaround that treats any `\p{L}` as a "word" character.
 */
const CJK_THAI_LAO_REGEX =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}]/u;

function needsSubstringStrategy(word: string): boolean {
  return CJK_THAI_LAO_REGEX.test(word);
}

interface CompiledCategory {
  category: ChatFilterCategory;
  // One combined regex per strategy to minimize scan passes. `null` when the
  // category has no words of that shape.
  wordBoundaryRegex: RegExp | null;
  substringRegex: RegExp | null;
  customPatterns: Array<{ name: string; regex: RegExp }>;
}

interface CacheEntry {
  policyKey: string;
  compiled: CompiledCategory[];
}

// Module-level LRU. Convex Node isolates reuse across invocations, so caching
// per `(policyDocId, updatedAt)` lets repeated messages skip regex compilation.
// Capacity 16 is enough for the handful of orgs a single worker handles.
const LRU_CAPACITY = 16;
const compilationCache = new Map<string, CacheEntry>();

function cacheGet(key: string): CompiledCategory[] | null {
  const entry = compilationCache.get(key);
  if (!entry) return null;
  // Refresh LRU ordering
  compilationCache.delete(key);
  compilationCache.set(key, entry);
  return entry.compiled;
}

function cacheSet(key: string, compiled: CompiledCategory[]): void {
  if (compilationCache.size >= LRU_CAPACITY) {
    const oldest = compilationCache.keys().next().value;
    if (oldest !== undefined) compilationCache.delete(oldest);
  }
  compilationCache.set(key, { policyKey: key, compiled });
}

function compileCategory(category: ChatFilterCategory): CompiledCategory {
  if (!category.enabled) {
    return {
      category,
      wordBoundaryRegex: null,
      substringRegex: null,
      customPatterns: [],
    };
  }

  // NFC-normalize admin-authored words so they match NFC-normalized input.
  const normalizedWords = category.words.map((w) => w.normalize('NFC'));

  const boundaryWords: string[] = [];
  const substringWords: string[] = [];
  for (const word of normalizedWords) {
    if (word.length === 0) continue;
    if (needsSubstringStrategy(word)) {
      substringWords.push(escapeRegExp(word));
    } else {
      boundaryWords.push(escapeRegExp(word));
    }
  }

  const wordBoundaryRegex =
    boundaryWords.length > 0
      ? new RegExp(
          `(?<=^|\\P{L})(${boundaryWords.join('|')})(?=\\P{L}|$)`,
          'giu',
        )
      : null;

  const substringRegex =
    substringWords.length > 0
      ? new RegExp(`(${substringWords.join('|')})`, 'giu')
      : null;

  const customPatterns = category.patterns.map((p) => {
    // Patterns pre-validated by Zod refine, but guard anyway — invalid at
    // runtime (e.g. legacy row) is console.warn no-match, not throw.
    try {
      return { name: p.name, regex: new RegExp(p.regex, 'giu') };
    } catch (error) {
      console.warn(
        `[chat_filter] invalid regex in category ${category.id} pattern ${p.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  });

  return {
    category,
    wordBoundaryRegex,
    substringRegex,
    customPatterns: customPatterns.filter(
      (p): p is { name: string; regex: RegExp } => p !== null,
    ),
  };
}

interface CompileInput {
  policyDocId: string;
  updatedAt: number;
  categories: readonly ChatFilterCategory[];
}

function getCompiled(input: CompileInput): CompiledCategory[] {
  const key = `${input.policyDocId}:${input.updatedAt}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const compiled = input.categories.map(compileCategory);
  cacheSet(key, compiled);
  return compiled;
}

function scanRegex(
  regex: RegExp,
  text: string,
  categoryId: string,
  kind: 'word' | 'pattern',
  patternName: string | undefined,
): ChatFilterMatch[] {
  const budgeted = execWithBudget(regex, text);
  return budgeted.map((m) => ({
    categoryId,
    kind,
    patternName,
    start: m.index,
    end: m.index + m.length,
    matchedText: m.matchedText,
  }));
}

export function detectViolations(
  rawText: string,
  input: CompileInput,
): ChatFilterDetection {
  const clamp = clampMessage(rawText, MAX_MESSAGE_BYTES);
  const text = clamp.text.normalize('NFC');

  const compiled = getCompiled(input);
  const matches: ChatFilterMatch[] = [];

  for (const c of compiled) {
    if (!c.category.enabled) continue;
    if (c.wordBoundaryRegex) {
      matches.push(
        ...scanRegex(
          c.wordBoundaryRegex,
          text,
          c.category.id,
          'word',
          undefined,
        ),
      );
    }
    if (c.substringRegex) {
      matches.push(
        ...scanRegex(c.substringRegex, text, c.category.id, 'word', undefined),
      );
    }
    for (const p of c.customPatterns) {
      matches.push(
        ...scanRegex(p.regex, text, c.category.id, 'pattern', p.name),
      );
    }
  }

  matches.sort((a, b) => a.start - b.start || a.end - b.end);
  return { matches, truncated: clamp.truncated };
}

/** Test-only: reset the LRU between test cases. */
export function resetCompilationCacheForTesting(): void {
  compilationCache.clear();
}
