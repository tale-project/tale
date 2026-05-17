/**
 * Shared markdown-stripping pass used by:
 *  - the voice-output chunker (sentence-level segmentation before sending
 *    text to the TTS provider — the model should hear "Hello world", not
 *    "asterisk asterisk Hello world asterisk asterisk")
 *  - the paragraph-level spotlight matcher (compares the chunker's
 *    stripped chunk text against the user-visible paragraph text to
 *    decide which paragraph is "currently being read")
 *
 * Both call sites MUST normalise identically; any drift causes the
 * spotlight to fall off the active paragraph mid-playback. Centralising
 * here is the only way to keep them in lockstep as markdown handling
 * evolves.
 */

/**
 * Strip markdown decoration that should not be read aloud. Keeps the
 * underlying text content so the result is comparable against rendered
 * prose.
 *
 * Fenced code blocks: the input may split mid-fence (the chunker calls
 * this with incrementally-arriving stream slices). `fenceOpenRef.current`
 * tracks the open/close state across calls — the caller owns the ref and
 * resets it on message change. For single-shot callers (e.g. matching a
 * fully-formed paragraph) pass a fresh `{ current: false }` each call.
 */
/**
 * Matches a fenced-code-block opening/closing line. CommonMark allows
 * `` ``` ``-style fences (backticks) and `~~~`-style fences (tildes); 3+
 * of the chosen marker. We toggle a single boolean on every fence line so
 * a document mixing both styles still closes correctly even when the
 * exact marker doesn't match — TTS doesn't need lossless reconstruction,
 * just "don't read source code aloud."
 */
const FENCE_LINE = /^\s{0,3}(?:`{3,}|~{3,})\s*\S*\s*$/;

/**
 * Indented code blocks: 4+ leading spaces (or one tab) on a non-empty
 * line. CommonMark requires a preceding blank line for the indented
 * block to start, but for TTS purposes any 4-space prefix is enough —
 * over-stripping is preferable to reading "void main parens curly"
 * aloud.
 */
const INDENTED_CODE_LINE = /^(?: {4,}|\t)/;

/**
 * Bare-URL pattern. Captures the protocol-and-host plus optional path/
 * query/fragment so we can drop the whole URL token. Conservative on
 * trailing punctuation (a sentence-ending `.`, `,`, `;`, `:`, `)`, etc.
 * is excluded so the reader gets the natural pause).
 */
const BARE_URL = /https?:\/\/[^\s<>()"]+[^\s<>()"\\.,;:!?]/g;

/**
 * Autolink form `<https://example.com>` — CommonMark wrapper. The
 * generic HTML-tag stripper below removes the wrapper too, but doing it
 * here keeps the result whitespace-clean (the HTML stripper leaves a
 * single space).
 */
const AUTOLINK = /<(?:https?|mailto):[^>\s]+>/g;

/**
 * Minimal HTML entity table. Covers what realistically shows up in
 * streamed assistant prose; obscure entities (e.g. `&hellip;`) are left
 * verbatim — TTS will read them as "ampersand hellip semicolon" which is
 * a known limitation, not a regression.
 */
const HTML_ENTITY_REPLACEMENTS: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
};

function decodeHtmlEntities(input: string): string {
  let out = input;
  for (const [entity, replacement] of Object.entries(
    HTML_ENTITY_REPLACEMENTS,
  )) {
    out = out.replaceAll(entity, replacement);
  }
  // Numeric entities: &#NNN; (decimal) and &#xHH; (hex). Bounded ranges
  // so a malformed input can't trigger huge string allocations.
  out = out.replace(/&#(\d{1,7});/g, (_, dec: string) => {
    const cp = Number(dec);
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return '';
    return String.fromCodePoint(cp);
  });
  out = out.replace(/&#x([0-9a-fA-F]{1,6});/g, (_, hex: string) => {
    const cp = Number.parseInt(hex, 16);
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return '';
    return String.fromCodePoint(cp);
  });
  return out;
}

export function stripMarkdown(
  slice: string,
  fenceOpenRef: { current: boolean },
): string {
  let working = slice;
  // Drop fenced code blocks. Track open/close across calls because a
  // single emitted slice can contain only the opening fence with the
  // body arriving in a later chunk. Also drop 4-space indented code
  // blocks — they're not fenced so the per-line check stands.
  const lines = working.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    if (FENCE_LINE.test(line)) {
      fenceOpenRef.current = !fenceOpenRef.current;
      continue;
    }
    if (fenceOpenRef.current) continue;
    if (INDENTED_CODE_LINE.test(line)) continue;
    kept.push(line);
  }
  working = kept.join('\n');

  working = decodeHtmlEntities(working);

  return (
    working
      // images first (longer pattern) so the alt-text remains
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // links: keep the visible label, drop URL
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // autolinks `<https://...>` — drop entirely (URLs are unreadable)
      .replace(AUTOLINK, '')
      // bare URLs — drop entirely. Reads like "https colon slash slash..."
      // are uniformly worse than silence for TTS.
      .replace(BARE_URL, '')
      // HTML tags — drop the markup but keep the inner text. Greedy on
      // attributes; safe for streaming because incomplete `<foo` runs
      // remain as-is until the closing `>` arrives.
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')
      // headings — drop leading hashes
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      // task-list markers `- [ ]` / `- [x]` — drop the bracket, keep prose
      .replace(/^(\s*)[-*+]\s+\[[xX ]\]\s+/gm, '$1')
      // list bullets at line start — `- foo` / `* foo` / `1. foo`. TTS
      // reads bullets as "dash dash dash" otherwise.
      .replace(/^(\s*)(?:[-*+]|\d+\.)\s+/gm, '$1')
      // bold/italic markers. The non-anchored `_..._` form misclassifies
      // intra-word underscores (`snake_case_var` → `snakecasevar`); only
      // match `_` when both delimiters sit at a word boundary, matching
      // CommonMark's left/right-flanking rule. `*` does allow intra-word
      // emphasis per CommonMark so its rule stays unanchored.
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/\*([^\s*][^*]*?[^\s*]|[^\s*])\*/g, '$1')
      .replace(/(?<=^|\W)_([^\s_][^_]*?[^\s_]|[^\s_])_(?=\W|$)/g, '$1')
      // strikethrough — keep content
      .replace(/~~([^~]+)~~/g, '$1')
      // math: `$$block$$` and `$inline$` — drop contents entirely; TTS
      // reads LaTeX commands as random syllables.
      .replace(/\$\$[\s\S]*?\$\$/g, '')
      .replace(/(?<!\\)\$[^$\n]+\$/g, '')
      // table separator rows `|---|---|` — drop entirely
      .replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-*:?\s*\|?\s*$/gm, '')
      // table data rows `|cell|cell|` — collapse pipes to spaces
      .replace(/^\s*\|(.+)\|\s*$/gm, (_, inner: string) =>
        inner.replace(/\|/g, ' '),
      )
      // inline code — keep the contents
      .replace(/`([^`]+)`/g, '$1')
      // blockquote prefix
      .replace(/^\s{0,3}>\s?/gm, '')
      // horizontal rules: `---`, `***`, `___` (3+ of one marker)
      .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, '')
      // footnote refs `[^1]` — drop
      .replace(/\[\^[^\]]+\]/g, '')
      // emoji / pictographs — gpt-4o-mini-tts can pronounce isolated
      // emoji as random syllables (the "z dot" artifact users hear at
      // the end of short replies). The Unicode property escape covers
      // every emoji-shaped glyph including transport and supplemental
      // symbols.
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
      .replace(/‍/g, '')
      .replace(/️/g, '')
      // collapse runs of whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Single-shot convenience wrapper for non-streaming callers (e.g. the
 * paragraph-level spotlight matcher) that don't need fence-state
 * continuity across calls. Each invocation gets a fresh fence tracker.
 */
export function stripMarkdownOnce(text: string): string {
  return stripMarkdown(text, { current: false });
}

/**
 * Compare two strings for substring containment after whitespace
 * normalisation. Used by the spotlight matcher: the chunker's stored
 * chunk text was produced with the same `stripMarkdown` pass, so a
 * substring match against a paragraph's stripped text is correct iff
 * whitespace differences (markdown re-flow, trailing spaces) don't
 * trip us up.
 */
export function containsNormalized(haystack: string, needle: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  const h = normalize(haystack);
  const n = normalize(needle);
  if (n.length === 0) return false;
  return h.includes(n);
}
