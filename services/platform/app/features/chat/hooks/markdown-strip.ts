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
export function stripMarkdown(
  slice: string,
  fenceOpenRef: { current: boolean },
): string {
  let working = slice;
  // Drop fenced code blocks. Track open/close across calls because a
  // single emitted slice can contain only the opening fence with the
  // body arriving in a later chunk.
  const lines = working.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      fenceOpenRef.current = !fenceOpenRef.current;
      continue;
    }
    if (fenceOpenRef.current) continue;
    kept.push(line);
  }
  working = kept.join('\n');
  return (
    working
      // images first (longer pattern) so the alt-text remains
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // links: keep the visible label
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // headings — drop leading hashes
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      // bold/italic markers (greedy enough to handle nested **_x_**)
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(\*|_)(.+?)\1/g, '$2')
      // inline code — keep the contents
      .replace(/`([^`]+)`/g, '$1')
      // blockquote prefix
      .replace(/^\s{0,3}>\s?/gm, '')
      // horizontal rules
      .replace(/^\s*(?:-\s*){3,}$/gm, '')
      // emoji / pictographs — gpt-4o-mini-tts can pronounce isolated
      // emoji as random syllables (the "z dot" artifact users hear at
      // the end of short replies). The Unicode property escape covers
      // every emoji-shaped glyph including transport and supplemental
      // symbols — the previous hand-rolled \u{1F300}-\u{1FAFF}\u{2600}-
      // \u{27BF} ranges missed common pictographs like ⚓ / ⏰. Regional
      // indicators (flag pairs like 🇺🇸), zero-width joiners, and
      // variation selectors are stripped in separate passes because the
      // lint rule rejects combining sequences inside one character class.
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
