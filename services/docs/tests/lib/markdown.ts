/**
 * Markdown parsing helpers. Everything the test suite needs to look at a doc
 * page lives here — frontmatter splitting, fenced-code-block stripping,
 * inline-code masking, URL masking, heading extraction, and the
 * opening/closing slicers.
 *
 * Design notes:
 *
 *   - Every helper takes a string and returns a string or a typed structure;
 *     no I/O.
 *   - The "strip" helpers (`stripFences`, `stripFrontmatter`) replace the
 *     stripped region with blank lines so line numbers stay stable for error
 *     reporting. Callers can `.split('\n')` and still cite real line indices.
 *   - The "mask" helpers (`maskInlineCode`, `maskUrls`) replace the matched
 *     region with spaces of equal length on a per-line basis — same
 *     line-number-preserving rationale.
 *   - Fence handling honours the CommonMark closing rule: the closing fence
 *     must use the same character (` or ~) as the opener AND be at least as
 *     long. A 3-backtick fence inside a 4-backtick block is content, not a
 *     close.
 */

const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})\s*(\S+)?/;
const FENCE_OPEN_OR_CLOSE = /^(\s*)(`{3,}|~{3,})/;

export interface CodeFence {
  /** Language identifier following the opening fence (`bash`, `typescript`,
   *  `json`), or `null` if the fence opened with no language tag. */
  lang: string | null;
  /** 1-based line number of the opening fence. */
  line: number;
  /** Body of the fence (excluding the opening/closing fence lines). */
  content: string;
}

export interface Heading {
  /** Heading depth — 1 for `#`, 2 for `##`, etc. */
  depth: number;
  /** Raw heading text after the `#` markers, trimmed. */
  text: string;
  /** 1-based line number where the heading sits. */
  line: number;
}

/**
 * Split frontmatter off the page body. Returns the raw frontmatter (between
 * the `---` delimiters, no trailing newline) and the body (everything after
 * the closing delimiter line).
 *
 * If the page has no frontmatter or the frontmatter is unterminated, returns
 * an empty `frontmatter` and the original content as `body` — callers that
 * care about that distinction should also call `hasFrontmatter`.
 */
export function parseFrontmatter(content: string): {
  frontmatter: string;
  body: string;
} {
  if (!content.startsWith('---\n')) return { frontmatter: '', body: content };
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return { frontmatter: '', body: content };
  return {
    frontmatter: content.slice(4, end),
    body: content.slice(end + 5),
  };
}

/** Return only the body half of a page. Convenience around `parseFrontmatter`. */
export function stripFrontmatter(content: string): string {
  return parseFrontmatter(content).body;
}

/** Does the content start with a well-formed frontmatter block? */
export function hasFrontmatter(content: string): boolean {
  if (!content.startsWith('---\n')) return false;
  return content.indexOf('\n---\n', 4) !== -1;
}

/**
 * Strip every fenced code block from `text`, replacing each fence line and
 * each line inside it with a blank line. Line indices are preserved so
 * findings can still cite line numbers.
 *
 * Respects the CommonMark rule that the closing fence must be the same
 * character as the opener and at least as long. This matters for blocks that
 * embed shorter fences as syntax samples.
 */
export function stripFences(text: string): string {
  const out: string[] = [];
  let openMarker: string | null = null;
  for (const line of text.split('\n')) {
    const m = FENCE_OPEN_OR_CLOSE.exec(line);
    if (m) {
      const marker = m[2];
      if (openMarker === null) {
        openMarker = marker;
        out.push('');
        continue;
      }
      if (marker[0] === openMarker[0] && marker.length >= openMarker.length) {
        openMarker = null;
        out.push('');
        continue;
      }
      // Shorter inner fence inside a longer outer fence — still content.
      out.push('');
      continue;
    }
    out.push(openMarker !== null ? '' : line);
  }
  return out.join('\n');
}

/**
 * Mask every inline-code span (` `…` `) in a single line, replacing the entire
 * span (including the backticks) with spaces of equal length. Keeps the line
 * length identical so a regex match's index can still be reported as a column.
 *
 * Operates on a per-line basis because inline code is single-line by spec; if
 * a backtick crosses a newline it's a syntax error in the source.
 */
export function maskInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
}

/**
 * Mask URLs and Markdown link targets in a single line. Replaces with spaces
 * to preserve line length.
 *
 *   - Bare URLs:     `https://example.com/…` → all spaces.
 *   - Link targets:  `[label](/foo)` → keeps `[label]`, replaces `(/foo)` with
 *                    spaces. The label remains visible to the term scanner so
 *                    a translated label like `[Speichern](…)` is still
 *                    checked.
 */
export function maskUrls(line: string): string {
  return line
    .replace(/\bhttps?:\/\/\S+/g, (m) => ' '.repeat(m.length))
    .replace(/\(\/[^)\s]+\)/g, (m) => ' '.repeat(m.length));
}

/**
 * Yield every prose line of `body` (frontmatter-free) with fences stripped,
 * inline code masked, and URLs masked. 1-based line numbers refer back to
 * the original body, NOT to the frontmatter+body whole, so callers must add
 * the frontmatter line count themselves when reporting findings against the
 * raw page.
 */
export function* iterProseLines(
  body: string,
): Iterable<{ line: number; text: string }> {
  const stripped = stripFences(body);
  const lines = stripped.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const masked = maskUrls(maskInlineCode(lines[i]));
    yield { line: i + 1, text: masked };
  }
}

/**
 * Walk every fenced code block in `body` (frontmatter-free) and return them
 * with their language tag and 1-based line number of the opening fence.
 *
 * Used by the code-fence-language test (every block must declare a language)
 * and by anyone who wants to peek inside fenced regions without re-scanning
 * the whole body.
 */
export function extractCodeFences(body: string): CodeFence[] {
  const fences: CodeFence[] = [];
  const lines = body.split('\n');
  let openLine = -1;
  let openLang: string | null = null;
  let openMarker: string | null = null;
  let buffer: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (openMarker === null) {
      const m = FENCE_OPEN.exec(line);
      if (!m) continue;
      openMarker = m[2];
      openLine = i + 1;
      openLang = m[3] ?? null;
      buffer = [];
      continue;
    }
    const close = FENCE_OPEN_OR_CLOSE.exec(line);
    if (
      close &&
      close[2][0] === openMarker[0] &&
      close[2].length >= openMarker.length
    ) {
      fences.push({
        lang: openLang,
        line: openLine,
        content: buffer.join('\n'),
      });
      openMarker = null;
      openLang = null;
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  // Unterminated fence at EOF — still emit so the test catches it.
  if (openMarker !== null) {
    fences.push({ lang: openLang, line: openLine, content: buffer.join('\n') });
  }
  return fences;
}

/**
 * Extract every heading in `body` outside of fenced code blocks. Includes line
 * numbers so structural tests can cite them.
 */
export function extractHeadings(body: string): Heading[] {
  const stripped = stripFences(body);
  const headings: Heading[] = [];
  const lines = stripped.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (m)
      headings.push({ depth: m[1].length, text: m[2].trim(), line: i + 1 });
  }
  return headings;
}

/** Just the heading-depth sequence (`[1, 2, 2, 3, 2]`), used for locale
 *  outline parity checks. */
export function extractOutline(body: string): number[] {
  return extractHeadings(body).map((h) => h.depth);
}

/**
 * The prose between the frontmatter and the first heading/list/table/code
 * block. Used by the opening-paragraph test.
 *
 *   - A leading H1 (rare but legal in some templates) is skipped — the
 *     opening is what follows.
 *   - Returns the empty string if no opening prose exists (page that jumps
 *     straight into a sub-heading).
 */
export function extractOpeningProse(body: string): string {
  const lines = body.split('\n');
  let i = 0;
  // Skip leading blanks.
  while (i < lines.length && lines[i].trim() === '') i++;
  // Skip a body H1 (rare; the page is supposed to inherit H1 from frontmatter,
  // but tolerate the legacy case so the opening rule still applies).
  if (i < lines.length && /^#\s+\S/.test(lines[i])) {
    i++;
    while (i < lines.length && lines[i].trim() === '') i++;
  }
  const prose: string[] = [];
  while (i < lines.length) {
    if (isStructuralLine(lines[i])) break;
    prose.push(lines[i]);
    i++;
  }
  return prose.join('\n').trim();
}

/**
 * The last heading on the page plus every non-blank line of its body. Used by
 * the closing-paragraph test.
 *
 *   - Returns `null` when the page has no headings (e.g. a `kind: index` page
 *     that's just a frontmatter and a curated grid).
 *   - "Body" stops at end of file; we don't try to detect a "next" heading
 *     because there is none.
 */
export function extractClosingSection(
  body: string,
): { heading: Heading; bodyLines: string[] } | null {
  const headings = extractHeadings(body);
  if (headings.length === 0) return null;
  const last = headings[headings.length - 1];
  const stripped = stripFences(body);
  const lines = stripped.split('\n');
  const bodyLines = lines.slice(last.line).filter((l) => l.trim().length > 0);
  return { heading: last, bodyLines };
}

/** Internal: a line is "structural" (terminates the opening) when it's a
 *  heading, bullet, numbered item, table row, or fence. Blockquotes count as
 *  prose. */
function isStructuralLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return false;
  if (trimmed.startsWith('#')) return true;
  if (/^[-*+]\s+/.test(trimmed)) return true;
  if (/^\d+\.\s+/.test(trimmed)) return true;
  if (trimmed.startsWith('|')) return true;
  if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) return true;
  return false;
}
