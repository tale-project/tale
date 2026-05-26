/**
 * Mask passes for the scanner.
 *
 * Each mask is a pure function from string → string of EQUAL length. The
 * equal-length contract means column indices in the masked text correspond
 * 1:1 with columns in the original source — a check's `match.index` is a
 * valid column in the file the reviewer opens.
 *
 * Two pipelines:
 *
 *   - `applyMarkdownMasks(line)`     — inline code, link URLs, ICU.
 *     Called per-line, post-frontmatter parse + fence strip.
 *   - `applyJsonMasks(value)`        — ICU, backtick spans, template literals.
 *     Called per JSON string value.
 *
 * Frontmatter and fenced-code masks are not per-line — they live in the
 * markdown walker (`scanner/markdown.ts`) because they operate on the file
 * as a whole.
 */

const SPACES = (n: number): string => ' '.repeat(n);

/** Inline-code mask: `` `…` `` → spaces of equal length. */
export function maskInlineCode(line: string): string {
  // Match backtick spans non-greedily; ignore double-backtick code spans.
  return line.replace(/`[^`\n]*`/g, (m) => SPACES(m.length));
}

/** Link-URL mask: `[label](url)` keeps `[label]`; `(url)` → spaces. */
export function maskLinkUrls(line: string): string {
  return line.replace(
    /(\[[^\]]*\])\(([^)]*)\)/g,
    (_full, label: string, url: string) => {
      return `${label}(${SPACES(url.length)})`;
    },
  );
}

/**
 * ICU placeholder mask. Replaces every `{…}` region (including nested
 * plural/select forms) with spaces. Uses a depth counter so nested
 * `{count, plural, one {…}}` mask correctly.
 */
export function maskIcuPlaceholders(text: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{') {
      const start = i;
      let depth = 1;
      i++;
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        i++;
      }
      out.push(SPACES(i - start));
    } else {
      out.push(text[i]);
      i++;
    }
  }
  return out.join('');
}

/** Backtick-span mask inside JSON values: `` `npm install` `` → spaces. */
export function maskBacktickSpans(value: string): string {
  return value.replace(/`[^`\n]*`/g, (m) => SPACES(m.length));
}

/** Template-literal placeholder mask: `${...}` → spaces (rare in JSON). */
export function maskTemplateLiterals(value: string): string {
  return value.replace(/\$\{[^}]*\}/g, (m) => SPACES(m.length));
}

/** Markdown per-line mask pipeline. */
export function applyMarkdownMasks(line: string): string {
  let masked = maskInlineCode(line);
  masked = maskLinkUrls(masked);
  masked = maskIcuPlaceholders(masked);
  return masked;
}

/** JSON per-value mask pipeline. */
export function applyJsonMasks(value: string): string {
  let masked = maskIcuPlaceholders(value);
  masked = maskBacktickSpans(masked);
  masked = maskTemplateLiterals(masked);
  return masked;
}

/**
 * Strip fenced code blocks from a multi-line markdown source.
 * Replaces fenced regions with blank lines so 1-based line numbers stay
 * accurate.
 */
export function stripFences(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceChar = '';
  for (const line of lines) {
    const m = /^(\s*)(`{3,}|~{3,})/.exec(line);
    if (m && !inFence) {
      inFence = true;
      fenceChar = m[2][0];
      out.push('');
      continue;
    }
    if (m && inFence && m[2][0] === fenceChar) {
      inFence = false;
      fenceChar = '';
      out.push('');
      continue;
    }
    out.push(inFence ? '' : line);
  }
  return out.join('\n');
}

/** Strip YAML frontmatter; returns `{ frontmatter, body }`. Body preserves line numbers. */
export function stripFrontmatter(source: string): {
  frontmatter: string;
  body: string;
} {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!m) return { frontmatter: '', body: source };
  const yaml = m[1];
  const yamlLineCount = m[0].split('\n').length - 1;
  return {
    frontmatter: yaml,
    body: '\n'.repeat(yamlLineCount) + source.slice(m[0].length),
  };
}
